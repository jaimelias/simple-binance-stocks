import { getSignature } from './nodeCrypto.js';

/**
 * Executes a Binance REST request using the Node.js Fetch API.
 * Secure endpoints receive the API key, timestamp, and HMAC signature.
 *
 * @param {Object} main Binance API configuration.
 * @param {Object} endpoint Endpoint configuration.
 * @param {Object} payload Request parameters.
 * @returns {Promise<Object|Array>} Parsed Binance JSON response.
 * @throws {Error} When Binance returns a non-2xx HTTP status.
 */
export const nodeFetch = async (main, endpoint, payload = {}) => {
    const {
        path,
        method,
        security,
        allowEmpty,
        validateResponse,
        readOnly
    } = endpoint;

    let finalUrl = `${main.baseUrl}/${path}`;

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
        method,
        headers,
    };

  if (['GET', 'DELETE'].includes(method)) {
    if (requestData) {
      finalUrl = `${finalUrl}?${requestData}`;
    }
  } else if (requestData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    options.body = requestData;
  }

  const response = await fetch(finalUrl, options);

  const {
    status,
    statusText,
  } = response;

  const responseText = await response.text();

  if (status >= 200 && status < 300) {
    if (allowEmpty && !responseText.trim()) return null;
    return JSON.parse(responseText);
  }

  const statusMess = statusText
    ? `${status} (${statusText})`
    : status;

  throw new Error(
    `Request failed with status ${statusMess}. ` +
    `Body: ${responseText}`
  );
};
