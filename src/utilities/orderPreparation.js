import * as endpointAsserts from './endpointAsserts.js'
import { decimalValue, normalizeSymbol, publicOptions, validateMaxSpreadPercent } from './publicInputs.js'
import { logError } from './logError.js'

const guardedOrders = new WeakMap()

/** Let an adapter consume a single submission authorized by the shared order guard. */
export const consumeOrderGuard = (main, payload) => {
  if (guardedOrders.get(payload) !== main) return false
  guardedOrders.delete(payload)
  return true
}

export const placementFields = [
  'symbol', 'side', 'timeInForce', 'walletType', 'tokenize', 'clientOrderId', 'recvWindow', 'quoteAsset'
]

/** Build a Binance payload with public defaults and decimal strings. */
export const placementPayload = (params) => {
  const payload = publicOptions(params, [...placementFields, 'orderType', 'price', 'quantity', 'notional', 'tradingSession'])
  payload.symbol = normalizeSymbol(payload.symbol)
  if (payload.side == null) payload.side = 'BUY'
  if (payload.timeInForce == null) payload.timeInForce = 'DAY'
  if (payload.quoteAsset == null) payload.quoteAsset = 'USDC'
  // Explicit nulls are invalid inputs, not omitted defaults.
  for (const field of ['side', 'timeInForce', 'quoteAsset']) {
    if (params[field] === null) throw new TypeError(`${field} cannot be null`)
  }
  for (const field of ['price', 'quantity', 'notional']) {
    if (payload[field] === undefined) continue
    const decimal = decimalValue(payload[field], field)
    if (field === 'price' && (decimal.decimalPlaces() > 2 ||
        (typeof payload.price === 'string' && (payload.price.split('.')[1] || '').length > 2))) {
      throw new TypeError('price must have at most 2 decimal places')
    }
    if (typeof payload[field] === 'number') payload[field] = decimal.toString()
  }
  return payload
}

/** Fetch and validate one fresh rule snapshot for a logical placement. */
export const loadOrderRules = async (main, symbol) => {
  const rules = await main.getSymbolInfo(symbol)
  if (!rules || rules.symbol !== symbol || !['BUY_SELL', 'BUY', 'SELL', 'NONE'].includes(rules.tradability)) {
    throw new TypeError(`Missing or malformed symbol rules for ${symbol}`)
  }
  const parsed = { ...rules }
  for (const field of ['stepSize', 'minQty', 'maxQty', 'minNotional', 'maxNotional']) {
    if (field === 'minQty' && rules[field] === undefined) continue
    parsed[field] = decimalValue(rules[field], `symbol.${field}`, {
      positive: field !== 'minQty' && field !== 'minNotional', stringOnly: true
    })
  }
  if ((parsed.minQty !== undefined && parsed.minQty.gt(parsed.maxQty)) || parsed.minNotional.gt(parsed.maxNotional)) {
    throw new TypeError('Symbol minimum exceeds maximum')
  }
  return parsed
}

/** Reject sizes and sessions that violate the fetched symbol rules. */
export const validateOrderRules = (payload, rules, estimatedNotional) => {
  if (rules.tradability !== 'BUY_SELL' && rules.tradability !== payload.side) {
    throw new RangeError(`${payload.symbol} does not allow ${payload.side} orders`)
  }
  let quantity
  if (payload.quantity !== undefined) {
    quantity = decimalValue(payload.quantity, 'quantity')
    if (!quantity.mod(rules.stepSize).isZero()) throw new RangeError('quantity must be an exact stepSize increment')
    if ((rules.minQty !== undefined && quantity.lt(rules.minQty)) || quantity.gt(rules.maxQty)) {
      throw new RangeError('quantity is outside symbol bounds')
    }
  }
  if (payload.orderType === 'LIMIT') {
    const requireFlag = field => {
      if (typeof rules[field] !== 'boolean') throw new TypeError(`Missing or malformed symbol.${field}`)
      if (!rules[field]) throw new RangeError(`${payload.symbol} does not support ${field}`)
    }
    if (payload.tradingSession !== 'RTH') requireFlag('extendedSession')
    if (payload.tradingSession === '24H') requireFlag('overnightSupported')
    if (!quantity.isInteger()) {
      requireFlag(payload.tradingSession === 'RTH' ? 'fractionable' : 'fractionableEh')
    }
  }
  const notional = payload.notional !== undefined ? decimalValue(payload.notional, 'notional')
    : payload.price !== undefined ? quantity.times(payload.price) : estimatedNotional
  if (notional && (notional.lt(rules.minNotional) || notional.gt(rules.maxNotional))) {
    throw new RangeError('notional is outside symbol bounds')
  }
}

/** Check the opposing quote with exact decimals; this cannot guarantee a resting order. */
const assertNonMarketable = (payload, quote) => {
  const field = payload.side === 'BUY' ? 'askPrice' : 'bidPrice'
  const reference = decimalValue(quote?.[field], `quote.${field}`)
  const price = decimalValue(payload.price, 'price')
  const marketable = payload.side === 'BUY' ? price.gte(reference) : price.lte(reference)
  if (marketable) {
    throw new RangeError(`rejectMarketable: ${payload.side} limit price ${payload.price} is marketable against ${field} ${reference}`)
  }
}

/** Compare midpoint spread percentages without rounding or division. */
const assertMaxSpread = (quote, maxSpreadPercent) => {
  const bid = decimalValue(quote?.bidPrice, 'quote.bidPrice')
  const ask = decimalValue(quote?.askPrice, 'quote.askPrice')
  if (ask.lt(bid)) throw new RangeError('quote.askPrice must be greater than or equal to quote.bidPrice')
  if (ask.minus(bid).times(200).gt(ask.plus(bid).times(maxSpreadPercent))) {
    throw new RangeError(`maxSpreadPercent: quote spread exceeds ${maxSpreadPercent}% (bid ${bid}, ask ${ask})`)
  }
}

/** Validate, check the spread against one quote, and submit once with a reconciliation ID. */
export const submitOrder = async (main, payload, rules,
  { estimatedNotional, rejectMarketable = false, maxSpreadPercent = 2, quote } = {}) => {
  validateMaxSpreadPercent(maxSpreadPercent)
  endpointAsserts.placeOrder(payload)
  validateOrderRules(payload, rules, estimatedNotional)
  if (quote === undefined) quote = await main.getQuote(payload.symbol)
  try {
    if (quote?.symbol !== undefined && normalizeSymbol(quote.symbol) !== payload.symbol) {
      throw new TypeError('quote.symbol does not match the order symbol')
    }
    assertMaxSpread(quote, maxSpreadPercent)
    if (rejectMarketable) assertNonMarketable(payload, quote)
  } catch (error) {
    await logError(main, error)
    throw error
  }
  if (payload.clientOrderId === undefined) payload.clientOrderId = main.createClientOrderId()
  endpointAsserts.placeOrder(payload)
  guardedOrders.set(payload, main)
  try {
    return await main.apiClient('placeOrder', payload)
  } finally {
    guardedOrders.delete(payload)
  }
}
