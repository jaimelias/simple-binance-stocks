const prefix = '/sapi/v1/equity/'
const endpoint = (path, method, security, allowEmpty = false, validateResponse) =>
  Object.freeze({ path: prefix + path, method, security, allowEmpty, validateResponse })
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0
const orderAck = value => object(value) && ['S', 'F'].includes(value.status) &&
  (value.status === 'F' || nonEmpty(value.orderId))
const conversionAck = value => object(value) && ['P', 'S', 'F'].includes(value.status) &&
  (value.status === 'F' || nonEmpty(value.issuerRequestId))
const successAck = value => object(value) && typeof value.success === 'boolean'
const listenAck = value => object(value) && nonEmpty(value.listenKey)
const fundingWallet = Object.freeze({
  path: '/sapi/v1/asset/get-funding-asset',
  method: 'POST',
  security: 'USER_DATA',
  readOnly: true,
  validateResponse: Array.isArray
})

export const endpoints = Object.freeze({
  exchangeInfo: endpoint('market/exchangeInfo', 'GET', 'MARKET_DATA'),
  tokenizedAssets: endpoint('market/tokenized-assets', 'GET', 'MARKET_DATA'),
  quote: endpoint('market/quote', 'GET', 'MARKET_DATA', true),
  placeOrder: endpoint('order/place', 'POST', 'TRADE', false, orderAck),
  cancelOrder: endpoint('order/cancel', 'POST', 'TRADE', false, orderAck),
  cancelAllOrders: endpoint('order/cancel-all', 'POST', 'TRADE', false, successAck),
  openOrders: endpoint('order/open-orders', 'GET', 'USER_DATA'),
  orderHistory: endpoint('order/history', 'GET', 'USER_DATA'),
  orderDetail: endpoint('order/detail', 'GET', 'USER_DATA'),
  tradeHistory: endpoint('trade/history', 'GET', 'USER_DATA'),
  mint: endpoint('tokenized/mint', 'POST', 'TRADE', false, conversionAck),
  redeem: endpoint('tokenized/redeem', 'POST', 'TRADE', false, conversionAck),
  conversionStatus: endpoint('tokenized/convert-status', 'GET', 'USER_DATA'),
  conversionHistory: endpoint('tokenized/history', 'GET', 'USER_DATA'),
  disclaimer: endpoint('account/disclaimer', 'POST', 'TRADE', false, successAck),
  listenKey: endpoint('listenKey', 'POST', 'USER_STREAM', false, listenAck),
  fundingWallet
})
