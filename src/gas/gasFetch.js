import { getSignature } from './gasCrypto.js';

const statusTextMap = {
  200: 'OK',
  201: 'Created',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  418: 'IP Banned',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/**
 * Executes a Binance REST request; only TRADE/USER_DATA receive a signature.
 *
 * @param {Object} main Binance API configuration.
 * @param {Object} endpoint Endpoint configuration.
 * @param {Object} payload Request parameters.
 * @returns {Object|Array} Parsed Binance JSON response.
 * @throws {Error} When Binance returns a non-2xx HTTP status.
 */
export const gasFetch = (main, endpoint, payload = {}) => {
  const {
    path,
    method,
    security,
    allowEmpty,
    validateResponse
  } = endpoint;

  let url = `${main.baseUrl}${path}`;

  const signed = security === 'TRADE' || security === 'USER_DATA';
  const params = { ...payload };
  if (signed) {
    params.timestamp = Date.now();
    params.recvWindow = payload.recvWindow ?? 5000;
  } else {
    delete params.timestamp;
    delete params.recvWindow;
  }


  const headers = {
    'X-MBX-APIKEY': main.API_KEY
  };


  const queryString = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => (
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    ))
    .join('&');

  const requestData = signed
    ? `${queryString}&signature=${getSignature(queryString, main.API_SECRET)}`
    : queryString;

  const options = {
    method: method.toLowerCase(),
    headers,
    muteHttpExceptions: true,
    escaping: false,
  };

  if (['GET', 'DELETE'].includes(method)) {
    if (requestData) {
      url = `${url}?${requestData}`;
    }
  } else if (requestData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.payload = requestData;
  }

  const response = UrlFetchApp.fetch(url, options);

  const status = response.getResponseCode();
  const responseText = response.getContentText();

  if (status >= 200 && status < 300) {
    if (!responseText.trim()) {
      if (allowEmpty) return null

      throw new Error(
        `Request succeeded with status ${status}, but returned an empty body`
      )
    }

    const data = JSON.parse(responseText)

    if (validateResponse && !validateResponse(data)) {
      throw new Error('Binance returned an invalid response')
    }

    return data
  }

  const statusText = statusTextMap[status] || 'Unknown Status';

  throw new Error(
    `Request failed with status ${status} (${statusText}). ` +
    `Body: ${responseText}`
  );
};
