import { publicOptions, orderAmount, decimalValue } from '../utilities/publicInputs.js'
import { placeOrder as assertOrder } from '../utilities/endpointAsserts.js'
import { placementFields, placementPayload, loadOrderRules, submitOrder } from '../utilities/orderPreparation.js'

/** Buy by notional, or size a market sell down using one current bid quote. */
export const createMarketOrder = async (main, options) => {
  const { amountInUSD, ...params } = publicOptions(options, [...placementFields, 'amountInUSD'])
  const amount = orderAmount(amountInUSD)
  const payload = placementPayload({ ...params, orderType: 'MARKET',
    ...(params.side === 'SELL' ? { quantity: '1' } : { notional: amount.toString() }) })
  assertOrder(payload)
  const rules = await loadOrderRules(main, payload.symbol)
  let estimatedNotional
  if (payload.side === 'SELL') {
    const quote = await main.getQuote(payload.symbol)
    const bid = decimalValue(quote?.bidPrice, 'quote.bidPrice')
    const quantity = amount.divToInt(bid.times(rules.stepSize)).times(rules.stepSize)
    payload.quantity = quantity.toString()
    estimatedNotional = quantity.times(bid)
  }
  return submitOrder(main, payload, rules, { estimatedNotional })
}
