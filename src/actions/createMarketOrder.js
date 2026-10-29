import { publicOptions, orderAmount, decimalValue, normalizeSymbol, validateMaxSpreadPercent } from '../utilities/publicInputs.js'
import { placeOrder as assertOrder } from '../utilities/endpointAsserts.js'
import { placementFields, placementPayload, loadOrderRules, submitOrder } from '../utilities/orderPreparation.js'
import { logError } from '../utilities/logError.js'

/** Buy by notional or size a sell using one bid quote, always guarding the spread. */
export const createMarketOrder = async (main, options) => {
  const { amountInUSD, maxSpreadPercent = 2, ...params } = publicOptions(options,
    [...placementFields, 'amountInUSD', 'maxSpreadPercent'])
  validateMaxSpreadPercent(maxSpreadPercent)
  const amount = orderAmount(amountInUSD)
  const payload = placementPayload({ ...params, orderType: 'MARKET',
    ...(params.side === 'SELL' ? { quantity: '1' } : { notional: amount.toString() }) })
  assertOrder(payload)
  const rules = await loadOrderRules(main, payload.symbol)
  let estimatedNotional
  let quote
  if (payload.side === 'SELL') {
    quote = await main.getQuote(payload.symbol)
    let bid
    try {
      if (quote?.symbol !== undefined && normalizeSymbol(quote.symbol) !== payload.symbol) {
        throw new TypeError('quote.symbol does not match the order symbol')
      }
      bid = decimalValue(quote?.bidPrice, 'quote.bidPrice')
    } catch (error) {
      await logError(main, error)
      throw error
    }
    const quantity = amount.divToInt(bid.times(rules.stepSize)).times(rules.stepSize)
    payload.quantity = quantity.toString()
    estimatedNotional = quantity.times(bid)
  }
  return submitOrder(main, payload, rules, { estimatedNotional, maxSpreadPercent, quote })
}
