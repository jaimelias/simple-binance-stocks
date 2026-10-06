import { publicOptions, orderAmount, decimalValue } from '../utilities/publicInputs.js'
import { placeOrder as assertOrder } from '../utilities/endpointAsserts.js'
import { placementFields, placementPayload, loadOrderRules, submitOrder } from '../utilities/orderPreparation.js'

/** Size a LIMIT order, optionally rejecting prices marketable against the latest quote. */
export const createLimitOrder = async (main, options) => {
  const { amountInUSD, entryPrice, rejectMarketable = false, ...params } = publicOptions(options,
    [...placementFields, 'amountInUSD', 'entryPrice', 'tradingSession', 'rejectMarketable'])
  if (typeof rejectMarketable !== 'boolean') throw new TypeError('rejectMarketable must be a boolean')
  const amount = orderAmount(amountInUSD)
  const payload = placementPayload({ ...params, orderType: 'LIMIT', price: entryPrice, quantity: '1' })
  assertOrder(payload)
  const price = decimalValue(payload.price, 'entryPrice')
  const rules = await loadOrderRules(main, payload.symbol)
  payload.quantity = amount.divToInt(price.times(rules.stepSize)).times(rules.stepSize).toString()
  return submitOrder(main, payload, rules, { rejectMarketable })
}
