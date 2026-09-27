/**
 * Payload assertions named exactly like the keys in endpointsMaster.js.
 * Use: import * as endpointAsserts from './endpointAsserts.js'.
 * Each assertion returns the original payload or throws TypeError, without mutation.
 * Validate before signing: headers/signature are transport-owned; timestamp and
 * recvWindow are optional here because the transports add them, but checked if supplied.
 * Decimal API fields are strings. Convert public amountInUSD sizing to the required
 * Binance fields first; symbol rules (stepSize, notional limits, etc.) need separate data.
 */

const assert = (condition, message) => {
  if (!condition) throw new TypeError(message)
}

const string = [
  value => typeof value === 'string' && value.trim().length > 0,
  'must be a non-empty string'
]
const boolean = [value => typeof value === 'boolean', 'must be a boolean']
const oneOf = (...values) => [
  value => values.includes(value),
  `must be one of: ${values.join(', ')}`
]
const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => [
  value => Number.isSafeInteger(value) && value >= min && value <= max,
  `must be a safe integer between ${min} and ${max}`
]
const positiveDecimal = value => typeof value === 'string' &&
  value.trim() === value && /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value)
const decimal = [positiveDecimal, 'must be a positive decimal string']
const price = [
  value => positiveDecimal(value) && /^\d+(?:\.\d{1,2})?$/.test(value),
  'must be a positive decimal string with at most 2 decimal places'
]
const clientOrderId = [
  value => typeof value === 'string' && value.trim() === value && /^[a-zA-Z0-9_-]{32,36}$/.test(value),
  'must contain 32 to 36 letters, digits, underscores, or hyphens'
]
const side = oneOf('BUY', 'SELL')
const orderType = oneOf('MARKET', 'LIMIT')
const transportFields = { timestamp: integer(), recvWindow: integer(1, 60000) }
const historyFields = {
  startTime: integer(),
  endTime: integer(),
  current: integer(1),
  size: integer(1, 100)
}
const orderStatuses = ['FILLED', 'PARTIALLY_FILLED', 'CANCELED', 'EXPIRED', 'REJECTED']

const validate = (endpoint, payload, fields = {}, required = []) => {
  assert(payload !== null && typeof payload === 'object' &&
    (Object.getPrototypeOf(payload) === Object.prototype || Object.getPrototypeOf(payload) === null),
  `${endpoint}: payload must be a plain object`)

  const rules = { ...transportFields, ...fields }
  for (const field of required) {
    assert(payload[field] !== undefined, `${endpoint}.${field} is required`)
  }
  for (const [field, value] of Object.entries(payload)) {
    // The transports omit undefined parameters.
    if (value === undefined) continue
    assert(Object.prototype.hasOwnProperty.call(rules, field), `${endpoint}.${field} is not allowed`)
    const [check, message] = rules[field]
    assert(check(value), `${endpoint}.${field} ${message}`)
  }
  return payload
}

const forbid = (endpoint, payload, fields) => {
  for (const field of fields) {
    assert(payload[field] === undefined, `${endpoint}.${field} is forbidden for this order type and side`)
  }
}

const timeRange = (endpoint, payload) => {
  if (payload.startTime !== undefined && payload.endTime !== undefined) {
    assert(payload.startTime <= payload.endTime, `${endpoint}.startTime must not exceed endTime`)
  }
  return payload
}

export function exchangeInfo(payload = {}) {
  return validate('exchangeInfo', payload, { symbol: string })
}

export function tokenizedAssets(payload = {}) {
  return validate('tokenizedAssets', payload)
}

export function quote(payload = {}) {
  return validate('quote', payload, { symbol: string }, ['symbol'])
}

export function placeOrder(payload = {}) {
  validate('placeOrder', payload, {
    symbol: string,
    quoteAsset: oneOf('USDC'),
    side,
    orderType,
    price,
    quantity: decimal,
    notional: decimal,
    timeInForce: oneOf('DAY', 'GTC'),
    tradingSession: oneOf('RTH', 'EXTENDED', '24H'),
    walletType: oneOf('CARD', 'MAIN'),
    clientOrderId,
    tokenize: boolean
  }, ['symbol', 'side', 'orderType'])

  if (payload.orderType === 'LIMIT') {
    for (const field of ['price', 'quantity', 'tradingSession']) {
      assert(payload[field] !== undefined, `placeOrder.${field} is required for LIMIT orders`)
    }
    forbid('placeOrder', payload, ['notional'])
    // Inspect the decimal digits directly so tiny fractions never round to integers.
    const fractional = /[1-9]/.test(payload.quantity.split('.')[1] || '')
    if (fractional && payload.timeInForce === 'GTC') {
      assert(['EXTENDED', '24H'].includes(payload.tradingSession),
        'placeOrder: fractional GTC orders require tradingSession EXTENDED or 24H')
    }
  } else {
    forbid('placeOrder', payload, ['price', 'tradingSession'])
    assert(payload.timeInForce !== 'GTC', 'placeOrder: GTC requires a LIMIT order')
    const required = payload.side === 'BUY' ? 'notional' : 'quantity'
    const forbidden = payload.side === 'BUY' ? 'quantity' : 'notional'
    assert(payload[required] !== undefined, `placeOrder.${required} is required for ${payload.side} MARKET orders`)
    forbid('placeOrder', payload, [forbidden])
  }
  return payload
}

export function cancelOrder(payload = {}) {
  return validate('cancelOrder', payload, { orderId: string }, ['orderId'])
}

export function cancelAllOrders(payload = {}) {
  return validate('cancelAllOrders', payload)
}

export function openOrders(payload = {}) {
  return validate('openOrders', payload)
}

export function orderHistory(payload = {}) {
  validate('orderHistory', payload, {
    ...historyFields,
    symbol: string,
    orderType,
    side,
    orderStatus: [
      value => typeof value === 'string' && value.split(',').every(status => orderStatuses.includes(status)),
      `must be a comma-separated list of: ${orderStatuses.join(', ')}`
    ]
  }, ['startTime', 'endTime'])
  return timeRange('orderHistory', payload)
}

export function orderDetail(payload = {}) {
  validate('orderDetail', payload, { orderId: string, clientOrderId: string })
  assert(payload.orderId !== undefined || payload.clientOrderId !== undefined,
    'orderDetail: orderId or clientOrderId is required')
  return payload
}

export function tradeHistory(payload = {}) {
  validate('tradeHistory', payload, {
    ...historyFields,
    symbol: string,
    side,
    orderId: string
  }, ['startTime', 'endTime'])
  return timeRange('tradeHistory', payload)
}

export function mint(payload = {}) {
  return validate('mint', payload, {
    underlyingAsset: string,
    underlyingAssetAmount: decimal,
    clientOrderId
  }, ['underlyingAsset', 'underlyingAssetAmount'])
}

export function redeem(payload = {}) {
  return validate('redeem', payload, {
    tokenizedAsset: string,
    tokenizedAssetAmount: decimal,
    clientOrderId
  }, ['tokenizedAsset', 'tokenizedAssetAmount'])
}

export function conversionStatus(payload = {}) {
  return validate('conversionStatus', payload, {
    issuerRequestId: string,
    convertType: oneOf('MINT', 'REDEEM')
  }, ['issuerRequestId', 'convertType'])
}

export function conversionHistory(payload = {}) {
  validate('conversionHistory', payload, {
    startTime: integer(),
    endTime: integer(),
    lastId: integer(),
    size: integer(1, 100)
  })
  return timeRange('conversionHistory', payload)
}

export function disclaimer(payload = {}) {
  return validate('disclaimer', payload)
}

export function listenKey(payload = {}) {
  return validate('listenKey', payload)
}

// Not in the Stocks schema; source: Binance Wallet REST API, Asset / Funding Wallet.
// https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/asset#funding-wallet
export function fundingWallet(payload = {}) {
  return validate('fundingWallet', payload, { asset: string, needBtcValuation: boolean })
}
