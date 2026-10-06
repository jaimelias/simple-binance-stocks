import { getSignature } from './nodeCrypto.js';

/**
 * Executes a Binance REST request using the Node.js Fetch API.
 * All endpoints receive the API key; TRADE/USER_DATA also receive a timestamp and signature.
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
        validateResponse
    } = endpoint;

    let finalUrl = `${main.baseUrl}${path}`;

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
        ? `${queryString}&signature=${await getSignature(queryString, main.API_SECRET)}`
        : queryString;

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

  const statusMess = statusText
    ? `${status} (${statusText})`
    : status;

  throw new Error(
    `Request failed with status ${statusMess}. ` +
    `Body: ${responseText}`
  );
};
