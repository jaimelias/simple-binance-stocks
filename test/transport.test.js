import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import Transport from '../src/transport.js';
import { BinanceAPIError, RateLimitError, UnknownExecutionError, ResponseError, ValidationError } from '../src/errors.js';

const API_KEY = 'dummy-api-key';
const API_SECRET = 'dummy-api-secret';
const NOW = 1800000000000;
const PATH = '/sapi/v1/equity/order/place';
const CLIENT_ORDER_ID = 'test_12345678901234567890123456789';

function http(body, status = 200, headers = {}) {
  return { status, headers, text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
}

function create(options = {}) {
  return new Transport({ apiKey: API_KEY, apiSecret: API_SECRET, crypto: webcrypto, now: () => NOW, ...options });
}

test('HMAC signs exactly the sorted, encoded query sent to Node fetch', async () => {
  let sent;
  const transport = create({ fetch: async (url, options) => { sent = { url, options }; return http({ status: 'S' }); } });
  const params = { symbol: 'AAPL', side: 'BUY', orderType: 'MARKET', notional: '10.50', quoteAsset: 'USDC', clientOrderId: 'with spaces/é+&=!' };
  await transport.request({ path: PATH, method: 'POST', security: 'TRADE', params });
  const payload = 'clientOrderId=with%20spaces%2F%C3%A9%2B%26%3D%21&notional=10.50&orderType=MARKET&quoteAsset=USDC&recvWindow=5000&side=BUY&symbol=AAPL&timestamp=1800000000000';
  const expectedSignature = createHmac('sha256', API_SECRET).update(payload).digest('hex');
  assert.equal(sent.url, `https://api.binance.com${PATH}?${payload}&signature=${expectedSignature}`);
  assert.deepEqual(sent.options, { method: 'POST', headers: { 'X-MBX-APIKEY': API_KEY }, redirect: 'error' });
  assert.equal(params.timestamp, undefined);
  assert.equal(params.signature, undefined);
});

test('market data needs an API key but sends no signature or timing fields', async () => {
  let sent;
  const transport = create({ apiSecret: undefined, fetch: async (url, options) => { sent = { url, options }; return http({ symbols: [] }); } });
  assert.deepEqual(await transport.request({ path: '/sapi/v1/equity/market/exchangeInfo', security: 'MARKET_DATA', params: { symbol: 'SPY' } }), { symbols: [] });
  assert.equal(sent.url, 'https://api.binance.com/sapi/v1/equity/market/exchangeInfo?symbol=SPY');
  assert.equal(sent.options.headers['X-MBX-APIKEY'], API_KEY);
  await assert.rejects(create({ apiKey: undefined }).request({ path: PATH, security: 'MARKET_DATA' }), ValidationError);
});

test('USER_STREAM includes milliseconds and recvWindow without a signature', async () => {
  let url;
  const transport = create({ apiSecret: undefined, fetch: async (value) => { url = value; return http({ listenKey: 'session' }); } });
  assert.deepEqual(await transport.request({ path: '/sapi/v1/equity/listenKey', method: 'POST', security: 'USER_STREAM' }), { listenKey: 'session' });
  assert.equal(url, 'https://api.binance.com/sapi/v1/equity/listenKey?recvWindow=5000&timestamp=1800000000000');
});

test('custom signer supports encoded Ed25519-style signatures without an HMAC secret', async () => {
  let payload;
  let url;
  const transport = create({ apiSecret: undefined, sign: (input) => { payload = input; return 'signature+/='; }, fetch: async (input) => { url = input; return http([]); } });
  await transport.request({ path: '/sapi/v1/equity/order/open-orders' });
  assert.equal(payload, 'recvWindow=5000&timestamp=1800000000000');
  assert.equal(url, `https://api.binance.com/sapi/v1/equity/order/open-orders?${payload}&signature=signature%2B%2F%3D`);
});

test('per-request recvWindow overrides the configured default', async () => {
  let url;
  const transport = create({ fetch: async (input) => { url = input; return http([]); } });
  await transport.request({ path: '/sapi/v1/equity/order/open-orders', params: { recvWindow: 12000 } });
  assert.equal(new URL(url).searchParams.get('recvWindow'), '12000');
  await assert.rejects(transport.request({ path: '/sapi/v1/equity/market/exchangeInfo', security: 'MARKET_DATA', params: { recvWindow: 5000 } }), ValidationError);
});

test('unsafe int64 response cursors survive without losing precision', async () => {
  const transport = create({ fetch: async () => http('{"lastId":9223372036854775807,"small":123,"text":"9223372036854775807, \\"quoted\\"","negative":-9223372036854775808}') });
  const response = await transport.request({ path: '/sapi/v1/equity/tokenized/history' });
  assert.equal(response.lastId, '9223372036854775807');
  assert.equal(response.negative, '-9223372036854775808');
  assert.equal(response.small, 123);
  assert.equal(response.text, '9223372036854775807, "quoted"');
});

test('integer preservation rejects invalid numeric keys and unsafe exponent notation', async () => {
  for (const body of ['{12345678901234567890:"x"}', '{"lastId":9.007199254740993e15}']) {
    const transport = create({ fetch: async () => http(body) });
    await assert.rejects(transport.request({ path: '/sapi/v1/equity/tokenized/history' }), ResponseError);
  }
});

test('empty quotes return null only when explicitly allowed', async () => {
  const transport = create({ fetch: async () => http('') });
  assert.equal(await transport.request({ path: '/sapi/v1/equity/market/quote', security: 'MARKET_DATA', allowEmpty: true }), null);
  await assert.rejects(transport.request({ path: '/sapi/v1/equity/market/exchangeInfo', security: 'MARKET_DATA' }), ResponseError);
});

test('preserves positive and negative Binance errors and HTTP metadata', async () => {
  for (const [code, status] of [[486410, 200], [-1022, 400]]) {
    const transport = create({ fetch: async () => http({ code, msg: 'Request rejected' }, status, { 'X-SAPI-USED-IP-WEIGHT-1M': '9' }) });
    await assert.rejects(transport.request({ path: PATH }), (error) => {
      assert.ok(error instanceof BinanceAPIError);
      assert.equal(error.code, code);
      assert.equal(error.msg, 'Request rejected');
      assert.equal(error.status, status);
      assert.equal(error.headers['x-sapi-used-ip-weight-1m'], '9');
      assert.deepEqual(error.response, { code, msg: 'Request rejected' });
      return true;
    });
  }
});

test('preserves S/F acknowledgement bodies for the order helper', async () => {
  for (const status of ['S', 'F']) {
    const acknowledgement = { status, orderId: 'id' };
    const transport = create({ fetch: async () => http(acknowledgement) });
    assert.deepEqual(await transport.request({ path: PATH, method: 'POST', security: 'TRADE' }), acknowledgement);
  }
});

test('malformed mutation acknowledgements preserve the pre-submission reconciliation ID', async () => {
  const validateResponse = (response) => ['S', 'F'].includes(response.status);
  for (const response of [{}, [], { status: 'UNEXPECTED' }]) {
    const transport = create({ fetch: async () => http(response, 200, { 'X-Request-Id': 'request-1' }) });
    await assert.rejects(transport.request({ path: PATH, method: 'POST', params: { clientOrderId: CLIENT_ORDER_ID }, validateResponse }), (error) => {
      assert.ok(error instanceof UnknownExecutionError);
      assert.equal(error.clientOrderId, CLIENT_ORDER_ID);
      assert.equal(error.status, 200);
      assert.equal(error.headers['x-request-id'], 'request-1');
      assert.deepEqual(error.response, response);
      return true;
    });
  }
  const failed = create({ fetch: async () => http({ status: 'F' }) });
  assert.deepEqual(await failed.request({ path: PATH, method: 'POST', validateResponse }), { status: 'F' });
});

test('API error codes take precedence over S/F acknowledgement statuses', async () => {
  for (const status of ['S', 'F']) {
    const transport = create({ fetch: async () => http({ status, code: 486410, msg: 'Disclaimer required' }) });
    await assert.rejects(transport.request({ path: PATH, method: 'POST', validateResponse: () => true }), (error) => error instanceof BinanceAPIError && error.code === 486410);
  }
});

test('throwing endpoint validators remain sanitized typed response errors', async () => {
  const transport = create({ fetch: async () => http({}) });
  const validateResponse = () => { throw new Error(API_SECRET); };
  await assert.rejects(transport.request({ path: PATH, validateResponse }), (error) => error instanceof ResponseError && !error.stack.includes(API_SECRET));
  await assert.rejects(transport.request({ path: PATH, method: 'POST', params: { clientOrderId: CLIENT_ORDER_ID }, validateResponse }), (error) => error instanceof UnknownExecutionError && error.clientOrderId === CLIENT_ORDER_ID && !error.stack.includes(API_SECRET));
});

test('429 enforces cooldown, tracks usage, and resumes only after Retry-After', async () => {
  let now = NOW;
  let calls = 0;
  const transport = create({ now: () => now, fetch: async () => {
    calls += 1;
    return calls === 1 ? http({ code: -1003, msg: 'Slow down' }, 429, { 'Retry-After': '2', 'X-SAPI-USED-UID-WEIGHT-1M': '180001' }) : http([]);
  } });
  await assert.rejects(transport.request({ path: PATH }), (error) => error instanceof RateLimitError && error.retryAfterMs === 2000 && error.lockedUntil === NOW + 2000 && error.local === false);
  assert.deepEqual(transport.getRateLimitState(), { lockedUntil: NOW + 2000, retryAfterMs: 2000, usage: { 'x-sapi-used-uid-weight-1m': '180001' } });
  now += 1000;
  await assert.rejects(transport.request({ path: PATH }), (error) => error instanceof RateLimitError && error.retryAfterMs === 1000 && error.local === true);
  assert.equal(calls, 1);
  now += 1000;
  assert.deepEqual(await transport.request({ path: PATH }), []);
  assert.equal(calls, 2);
});

test('418 and absent Retry-After use a configurable cooldown', async () => {
  const transport = create({ rateLimitFallbackMs: 7000, fetch: async () => http('blocked', 418) });
  await assert.rejects(transport.request({ path: PATH }), (error) => error instanceof RateLimitError && error.retryAfterMs === 7000 && error.status === 418);
});

test('rate-limit headers still enforce cooldown if the response body cannot be read', async () => {
  const transport = create({ fetch: async () => ({ status: 429, headers: { 'Retry-After': '3' }, text: async () => { throw new Error('socket closed'); } }) });
  await assert.rejects(transport.request({ path: PATH, method: 'POST' }), (error) => error instanceof RateLimitError && error.retryAfterMs === 3000);
  assert.equal(transport.getRateLimitState().lockedUntil, NOW + 3000);
});

test('Retry-After HTTP dates are respected', async () => {
  const transport = create({ fetch: async () => http({}, 429, { 'Retry-After': new Date(NOW + 12000).toUTCString() }) });
  await assert.rejects(transport.request({ path: PATH }), (error) => error instanceof RateLimitError && error.retryAfterMs === 12000);
});

test('mutation timeouts and server errors retain reconciliation IDs and never retry', async () => {
  for (const kind of ['network', 'http', 'unknown', 'timeout', 'unexpected', 'malformed']) {
    let calls = 0;
    const transport = create({ fetch: async () => {
      calls += 1;
      if (kind === 'network') throw new Error('socket timed out');
      if (kind === 'http') return http({ code: -1000, msg: 'Internal failure' }, 503);
      if (kind === 'unknown') return http({ code: -1000, msg: 'Unknown execution' });
      if (kind === 'timeout') return http({ code: -1007, msg: 'Execution status unknown' });
      if (kind === 'unexpected') return http({ code: -1006, msg: 'Execution status unknown' });
      return http('<not-json>');
    } });
    await assert.rejects(transport.request({ path: PATH, method: 'POST', security: 'TRADE', params: { clientOrderId: CLIENT_ORDER_ID, orderId: 'original-order' } }), (error) => {
      assert.ok(error instanceof UnknownExecutionError);
      assert.equal(error.executionUnknown, true);
      assert.equal(error.clientOrderId, CLIENT_ORDER_ID);
      assert.equal(error.orderId, 'original-order');
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('malformed JSON, invalid status, and non-string bodies remain typed errors', async () => {
  for (const invalid of [
    http('{"lastId":012345678901234567890}'),
    http('{"value":1e400}'),
    http('null'),
    http('{"code":null}'),
    { status: 200, headers: {}, text: async () => undefined },
    { status: undefined, headers: {}, text: async () => '{}' },
  ]) {
    const transport = create({ fetch: async () => invalid });
    await assert.rejects(transport.request({ path: PATH }), ResponseError);
    await assert.rejects(transport.request({ path: PATH, method: 'POST' }), UnknownExecutionError);
  }
});

test('unfamiliar nonzero error codes cannot become successful responses', async () => {
  for (const code of ['UNRECOGNIZED', '486999', 486999]) {
    const transport = create({ fetch: async () => http({ code, msg: 'Request rejected' }) });
    await assert.rejects(transport.request({ path: PATH }), (error) => error instanceof BinanceAPIError && String(error.code) === String(code));
  }
});

test('read network errors stay distinct from uncertain mutations and never retry', async () => {
  let calls = 0;
  const transport = create({ fetch: async () => { calls += 1; throw new Error('failure'); } });
  await assert.rejects(transport.request({ path: PATH }), (error) => error instanceof ResponseError && !(error instanceof UnknownExecutionError));
  assert.equal(calls, 1);
});

test('errors redact credentials, signatures, signed URLs, and unsafe adapter errors', async () => {
  let signature;
  const transport = create({ fetch: async (url) => {
    signature = new URL(url).searchParams.get('signature');
    return http({ code: -1022, msg: `${API_KEY} ${API_SECRET} ${signature} ${url}`, nested: { apiKey: API_KEY, signature } }, 400, { 'X-Request-Id': 'request-1', Location: url, 'X-MBX-APIKEY': API_KEY });
  } });
  await assert.rejects(transport.request({ path: PATH }), (error) => {
    const serialized = `${JSON.stringify(error)} ${error.stack}`;
    for (const secret of [API_KEY, API_SECRET, signature]) assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes('https://api.binance.com/sapi/'), false);
    assert.equal(error.headers['x-request-id'], 'request-1');
    return true;
  });
  const failing = create({ fetch: async (url) => { throw new Error(`${API_SECRET} ${url}`); } });
  await assert.rejects(failing.request({ path: PATH }), (error) => !JSON.stringify(error).includes(API_SECRET) && !error.stack.includes('signature='));
  const badSigner = create({ sign: () => { throw new Error(API_SECRET); } });
  await assert.rejects(badSigner.request({ path: PATH }), (error) => error instanceof ValidationError && !error.stack.includes(API_SECRET));
  assert.equal(JSON.stringify(transport).includes(API_SECRET), false);
  assert.deepEqual(Object.getOwnPropertyNames(transport), []);
});

test('validates request configuration and reserved parameters before transport', async () => {
  for (const recvWindow of [0, -1, 60001, 1.5, NaN, Infinity, '5000']) assert.throws(() => create({ recvWindow }), ValidationError);
  for (const baseUrl of ['http://api.binance.com', 'https://key@api.binance.com', 'https://api.binance.com/path', 'https://api.binance.com?key=secret']) assert.throws(() => create({ baseUrl }), ValidationError);
  const transport = create({ fetch: async () => { assert.fail('must validate before sending'); } });
  for (const params of [{ signature: 'wrong' }, { timestamp: 1 }, { recvWindow: 60001 }, { amount: Infinity }, { value: {} }, { value: null }]) await assert.rejects(transport.request({ path: PATH, params }), ValidationError);
  await assert.rejects(transport.request({ path: `${PATH}?signature=wrong` }), ValidationError);
  await assert.rejects(transport.request({ path: PATH, security: 'NONE' }), ValidationError);
});

test('Apps Script uses native services with identical HMAC bytes and handles errors', async (context) => {
  let sent;
  let responseStatus = 200;
  let responseBody = '{"status":"S"}';
  context.mock.method(globalThis, 'fetch', () => assert.fail('Apps Script must use UrlFetchApp'));
  globalThis.UrlFetchApp = { fetch(url, options) {
    sent = { url, options };
    return { getResponseCode: () => responseStatus, getContentText: () => responseBody, getAllHeaders: () => ({ 'X-SAPI-USED-IP-WEIGHT-1M': 7 }) };
  } };
  globalThis.Utilities = { Charset: { UTF_8: 'UTF-8' }, computeHmacSha256Signature(payload, secret, charset) {
    assert.equal(charset, 'UTF-8');
    return Array.from(createHmac('sha256', secret).update(payload).digest(), (value) => value > 127 ? value - 256 : value);
  } };
  context.after(() => { delete globalThis.UrlFetchApp; delete globalThis.Utilities; });
  const transport = create();
  await transport.request({ path: PATH, method: 'POST', security: 'TRADE', params: { symbol: 'AAPL' } });
  const payload = 'recvWindow=5000&symbol=AAPL&timestamp=1800000000000';
  assert.equal(sent.url, `https://api.binance.com${PATH}?${payload}&signature=${createHmac('sha256', API_SECRET).update(payload).digest('hex')}`);
  assert.deepEqual(sent.options, { method: 'post', headers: { 'X-MBX-APIKEY': API_KEY }, muteHttpExceptions: true, followRedirects: false });
  assert.equal(transport.getLastResponse().headers['x-sapi-used-ip-weight-1m'], '7');
  responseStatus = 400;
  responseBody = '{"code":486410,"msg":"Accept disclaimer first"}';
  await assert.rejects(transport.request({ path: PATH, method: 'POST', security: 'TRADE' }), (error) => error instanceof BinanceAPIError && error.code === 486410 && error.status === 400);
});
