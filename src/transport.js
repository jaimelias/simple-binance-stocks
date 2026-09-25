import { BinanceAPIError, RateLimitError, UnknownExecutionError, ResponseError, ValidationError } from './errors.js';

const SECURITIES = new Set(['MARKET_DATA', 'USER_STREAM', 'USER_DATA', 'TRADE']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']);
const SENSITIVE_KEY = /^(?:api[-_]?key|api[-_]?secret|secret|secret[-_]?key|signature|x-mbx-apikey|authorization|cookie|set-cookie)$/i;

function encode(value) {
  // RFC 3986 encoding is shared by signing and the wire payload in both runtimes.
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function serialize(params) {
  try {
    return Object.keys(params).sort().map((key) => `${encode(key)}=${encode(params[key])}`).join('&');
  } catch {
    throw new ValidationError('Request parameters must contain valid Unicode text.');
  }
}

function headersObject(headers) {
  const result = {};
  if (headers && typeof headers.forEach === 'function') {
    headers.forEach((value, key) => { result[String(key).toLowerCase()] = String(value); });
  } else if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      result[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }
  return result;
}

function sanitizer(secrets) {
  const values = secrets.filter((value) => typeof value === 'string' && value.length > 0);
  const tokens = [...new Set(values.flatMap((value) => [value, encode(value)]))].sort((a, b) => b.length - a.length);
  function clean(value) {
    if (typeof value === 'string') {
      let result = value.replace(/https?:\/\/[^\s<>"']*\?[^\s<>"']*/gi, '[redacted request URL]');
      for (const token of tokens) result = result.split(token).join('[redacted]');
      return result.replace(/((?:signature|api[-_]?key|api[-_]?secret|secret)\s*[=:]\s*)[^\s&,;]+/gi, '$1[redacted]');
    }
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[redacted]' : clean(item)]));
    }
    return value;
  }
  return clean;
}

function utf8(value) {
  // Avoid TextEncoder, which is unavailable in Apps Script.
  const encoded = encodeURIComponent(value);
  const bytes = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === '%') {
      bytes.push(parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return new Uint8Array(bytes);
}

function hex(bytes) {
  return Array.from(bytes, (byte) => (byte & 255).toString(16).padStart(2, '0')).join('');
}

function parseResponse(body) {
  // Validate the original grammar before quoting numbers: an invalid unquoted numeric
  // object key must not become valid JSON through integer preservation.
  const original = JSON.parse(body, (key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite JSON number');
    return value;
  });
  // JSON.parse would otherwise round documented int64 cursors before callers can reuse them.
  // Match whole JSON strings first so digit sequences inside text remain untouched.
  let changed = false;
  const protectedIntegers = body.replace(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (token, number) => {
    if (number !== undefined && Number.isInteger(Number(number)) && !Number.isSafeInteger(Number(number))) {
      if (!/^-?\d+$/.test(number)) throw new Error('Unsafe integer must use plain integer notation');
      changed = true;
      return JSON.stringify(number);
    }
    return token;
  });
  return changed ? JSON.parse(protectedIntegers) : original;
}

const transportStates = new WeakMap();

async function createSignature(state, payload) {
  if (!state.sign && (typeof state.apiSecret !== 'string' || state.apiSecret.length === 0)) {
    throw new ValidationError('apiSecret or a sign adapter is required for signed requests.');
  }
  let result;
  try {
    if (state.sign) {
      result = await state.sign(payload);
    } else if (state.gas && typeof globalThis.Utilities?.computeHmacSha256Signature === 'function') {
      result = hex(globalThis.Utilities.computeHmacSha256Signature(payload, state.apiSecret, globalThis.Utilities.Charset.UTF_8));
    } else if (state.crypto?.subtle) {
      const key = await state.crypto.subtle.importKey('raw', utf8(state.apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      result = hex(new Uint8Array(await state.crypto.subtle.sign('HMAC', key, utf8(payload))));
    } else {
      throw new Error('No signing adapter');
    }
  } catch {
    // Adapter errors can include credentials, payloads, or complete request URLs.
    throw new ValidationError('Request signing failed. Configure a working HMAC or custom sign adapter.');
  }
  if (typeof result !== 'string' || result.length === 0) throw new ValidationError('The sign adapter must return a nonempty signature string.');
  return result;
}

/** Shared Binance request boundary with native Node.js and Apps Script adapters. */
export default class Transport {
  constructor({ apiKey, apiSecret, baseUrl = 'https://api.binance.com', recvWindow = 5000, fetch, crypto, sign, now = Date.now, rateLimitFallbackMs = 60000 } = {}) {
    if (typeof baseUrl !== 'string' || !/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/?$/.test(baseUrl)) {
      throw new ValidationError('baseUrl must be an HTTPS origin without credentials, query parameters, or a path.');
    }
    if (!Number.isInteger(recvWindow) || recvWindow <= 0 || recvWindow > 60000) {
      throw new ValidationError('recvWindow must be an integer from 1 to 60000 milliseconds.');
    }
    if (!Number.isFinite(rateLimitFallbackMs) || rateLimitFallbackMs <= 0) {
      throw new ValidationError('rateLimitFallbackMs must be a positive finite number.');
    }
    if (typeof now !== 'function' || (fetch !== undefined && typeof fetch !== 'function') || (sign !== undefined && typeof sign !== 'function')) {
      throw new ValidationError('now, fetch, and sign adapters must be functions when supplied.');
    }
    const state = { lockedUntil: 0, rateLimitStatus: null, usage: {}, lastResponse: null };
    transportStates.set(this, state);
    state.apiKey = apiKey;
    state.apiSecret = apiSecret;
    state.baseUrl = baseUrl.replace(/\/$/, '');
    state.recvWindow = recvWindow;
    state.gas = fetch === undefined && typeof globalThis.UrlFetchApp !== 'undefined';
    state.fetch = fetch ?? globalThis.fetch;
    state.crypto = crypto ?? globalThis.crypto;
    state.sign = sign;
    state.now = now;
    state.rateLimitFallbackMs = rateLimitFallbackMs;
  }

  getRateLimitState() {
    const state = transportStates.get(this);
    return { lockedUntil: state.lockedUntil, retryAfterMs: Math.max(0, state.lockedUntil - state.now()), usage: { ...state.usage } };
  }

  getLastResponse() {
    const state = transportStates.get(this);
    return state.lastResponse ? { ...state.lastResponse, headers: { ...state.lastResponse.headers } } : null;
  }

  assertApiKey() {
    const state = transportStates.get(this);
    if (typeof state.apiKey !== 'string' || state.apiKey.length === 0) {
      throw new ValidationError('apiKey is required for Binance Stocks requests.');
    }
  }

  async request({ path, method = 'GET', security = 'USER_DATA', params = {}, allowEmpty = false, validateResponse, readOnly = false } = {}) {
    const state = transportStates.get(this);
    if (typeof path !== 'string' || !/^\/sapi\/[A-Za-z0-9/_-]+$/.test(path) || path.includes('//')) {
      throw new ValidationError('path must be an absolute SAPI endpoint without query parameters.');
    }
    if (!METHODS.has(method)) throw new ValidationError('Unsupported HTTP method.');
    if (!SECURITIES.has(security)) throw new ValidationError('Unsupported endpoint security type.');
    if (validateResponse !== undefined && typeof validateResponse !== 'function') throw new ValidationError('validateResponse must be a function.');
    if (typeof readOnly !== 'boolean') throw new ValidationError('readOnly must be a boolean.');
    this.assertApiKey();
    if ((!state.gas && typeof state.fetch !== 'function') || (state.gas && typeof globalThis.UrlFetchApp.fetch !== 'function')) {
      throw new ValidationError('Configure a fetch adapter or run inside a supported Node.js or Apps Script environment.');
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new ValidationError('params must be an object.');
    const query = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (SENSITIVE_KEY.test(key) || key === 'timestamp') {
        throw new ValidationError('Credentials, signature, and timestamp are managed by the transport.');
      }
      if (key === 'recvWindow' && (security === 'MARKET_DATA' || !Number.isInteger(value) || value <= 0 || value > 60000)) {
        throw new ValidationError('recvWindow must be an integer from 1 to 60000 and is unavailable for MARKET_DATA.');
      }
      if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
        throw new ValidationError('Request parameters must be strings, finite numbers, or booleans.');
      }
      query[key] = value;
    }
    const now = state.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new ValidationError('now must return a valid millisecond timestamp.');
    if (now < state.lockedUntil) {
      throw new RateLimitError('Requests are paused until the Binance rate-limit cooldown expires.', {
        status: state.rateLimitStatus, path, method, retryAfterMs: state.lockedUntil - now, lockedUntil: state.lockedUntil, local: true,
      });
    }
    const signed = security === 'USER_DATA' || security === 'TRADE';
    if (signed || security === 'USER_STREAM') {
      query.recvWindow = query.recvWindow ?? state.recvWindow;
      query.timestamp = now;
    }
    const payload = serialize(query);
    const signature = signed ? await createSignature(state, payload) : undefined;
    // Another concurrent request can establish a cooldown while signing awaits an adapter.
    const currentTime = state.now();
    if (currentTime < state.lockedUntil) {
      throw new RateLimitError('Requests are paused until the Binance rate-limit cooldown expires.', {
        status: state.rateLimitStatus, path, method, retryAfterMs: state.lockedUntil - currentTime, lockedUntil: state.lockedUntil, local: true,
      });
    }
    const encoded = signature === undefined ? payload : `${payload}&signature=${encode(signature)}`;
    const url = `${state.baseUrl}${path}${encoded ? `?${encoded}` : ''}`;
    const clean = sanitizer([state.apiKey, state.apiSecret, signature]);
    const mutation = method !== 'GET' && !readOnly;
    const identifiers = clean({ clientOrderId: params.clientOrderId, orderId: params.orderId, issuerRequestId: params.issuerRequestId });
    const context = { path, method, ...identifiers };
    let status = null;
    let headers = {};
    let body;
    try {
      if (state.gas) {
        const response = globalThis.UrlFetchApp.fetch(url, {
          method: method.toLowerCase(), headers: { 'X-MBX-APIKEY': state.apiKey }, muteHttpExceptions: true, followRedirects: false,
        });
        status = response.getResponseCode();
        headers = headersObject(response.getAllHeaders());
        try { body = response.getContentText(); } catch { body = undefined; }
      } else {
        const response = await state.fetch(url, { method, headers: { 'X-MBX-APIKEY': state.apiKey }, redirect: 'error' });
        status = response.status;
        headers = headersObject(response.headers);
        try { body = await response.text(); } catch { body = undefined; }
      }
    } catch {
      const ErrorType = mutation ? UnknownExecutionError : ResponseError;
      throw new ErrorType(mutation ? 'No reliable response was received; mutation execution status is unknown. Check its status before retrying.' : 'The request failed before a complete response was received.', {
        ...context, status, headers: clean(headers),
      });
    }
    headers = clean(headers);
    state.lastResponse = { status, headers, path, method };
    for (const [key, value] of Object.entries(headers)) {
      if (/^x-(?:sapi-used-(?:ip|uid)-weight|mbx-used-weight|mbx-order-count)/.test(key)) state.usage[key] = value;
    }
    let response = null;
    let validJson = false;
    try {
      response = parseResponse(body);
      validJson = response !== null && typeof response === 'object';
    } catch { /* Handle parse failures according to method and HTTP status below. */ }
    const hasCode = response !== null && typeof response === 'object' && Object.prototype.hasOwnProperty.call(response, 'code');
    const rawCode = hasCode ? response.code : null;
    let code = null;
    if (typeof rawCode === 'number' && Number.isSafeInteger(rawCode)) code = rawCode;
    else if (typeof rawCode === 'string' && rawCode.length > 0) {
      code = /^-?\d+$/.test(rawCode) && Number.isSafeInteger(Number(rawCode)) ? Number(rawCode) : clean(rawCode);
    } else if (hasCode) validJson = false;
    const msg = response && typeof response.msg === 'string' ? clean(response.msg) : null;
    const details = { ...context, status, headers, code, msg, response: clean(response) };
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      const ErrorType = mutation ? UnknownExecutionError : ResponseError;
      throw new ErrorType('The HTTP adapter returned an invalid response status.', details);
    }
    if (status === 429 || status === 418) {
      const retryAfter = headers['retry-after'];
      let delay = state.rateLimitFallbackMs;
      if (typeof retryAfter === 'string' && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) delay = Number(retryAfter) * 1000;
      else if (retryAfter && Number.isFinite(Date.parse(retryAfter))) delay = Math.max(0, Date.parse(retryAfter) - state.now());
      if (!Number.isFinite(delay)) delay = state.rateLimitFallbackMs;
      state.lockedUntil = Math.max(state.lockedUntil, state.now() + delay);
      state.rateLimitStatus = status;
      throw new RateLimitError(msg ?? 'Binance rate limit exceeded.', { ...details, lockedUntil: state.lockedUntil, retryAfterMs: Math.max(0, state.lockedUntil - state.now()) });
    }
    if (mutation && (status >= 500 || code === -1000 || code === -1006 || code === -1007)) {
      throw new UnknownExecutionError(msg ?? 'Mutation execution status is unknown. Check its status before retrying.', details);
    }
    if (status < 200 || status >= 300) throw new BinanceAPIError(msg ?? `Binance returned HTTP ${status}.`, details);
    if (typeof body === 'string' && body.trim() === '' && allowEmpty) return null;
    if (!validJson) {
      const ErrorType = mutation ? UnknownExecutionError : ResponseError;
      throw new ErrorType(mutation ? 'The mutation response was empty or invalid; check its status before retrying.' : 'Binance returned an empty or invalid JSON response.', details);
    }
    if (code !== null && code !== 0) throw new BinanceAPIError(msg ?? `Binance returned error ${code}.`, details);
    if (validateResponse !== undefined) {
      let validResponse = false;
      try { validResponse = validateResponse(response) === true; } catch { /* Invalid endpoint response. */ }
      if (!validResponse) {
        const ErrorType = mutation ? UnknownExecutionError : ResponseError;
        throw new ErrorType(mutation ? 'The mutation acknowledgement was invalid; check its status before retrying.' : 'Binance returned an invalid endpoint response.', details);
      }
    }
    // S/F acknowledge the endpoint result; they do not establish an order lifecycle state.
    if (response.status === 'S' || response.status === 'F') return clean(response);
    return response;
  }
}
