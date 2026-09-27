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
 * Executes a Binance REST request using Google Apps Script UrlFetchApp.
 *
 * @param {Object} main Binance API configuration.
 * @param {Object} endpoint Endpoint configuration.
 * @param {Object} payload Request parameters.
 * @returns {Object|Array} Parsed Binance JSON response.
 * @throws {Error} When Binance returns a non-2xx HTTP status.
 */
export const handleGasFetch = (main, endpoint, payload = {}) => {
  const {
    path,
    method,
    security,
    validateResponse,
    readOnly
  } = endpoint;

  let url = `${main.baseUrl}/${path}`;

  const params = {
    ...payload,
    timestamp: Date.now(),
    recvWindow: 5000
  };


  const headers = {
    'X-MBX-APIKEY': main.API_KEY
  };


  const queryString = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => (
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    ))
    .join('&');

  const requestData = `${queryString}&signature=${getSignature(queryString, main.API_SECRET)}`

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
    return JSON.parse(responseText);
  }

  const statusText = statusTextMap[status] || 'Unknown Status';

  throw new Error(
    `Request failed with status ${status} (${statusText}). ` +
    `Body: ${responseText}`
  );
};