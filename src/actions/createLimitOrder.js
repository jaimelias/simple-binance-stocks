import { publicOptions, orderAmount, decimalValue, validateMaxSpreadPercent } from '../utilities/publicInputs.js'
import { placeOrder as assertOrder } from '../utilities/endpointAsserts.js'
import { placementFields, placementPayload, loadOrderRules, validatePlacementOptions, applySellSizing, submitOrder } from '../utilities/orderPreparation.js'

/** Size a LIMIT order with a required spread check and optional marketability guard. */
export const createLimitOrder = async (main, options) => {
  const { amountInUSD, entryPrice, rejectMarketable = false, maxSpreadPercent = 2,
    bufferSteps, maxSellQuantity, beforeSubmit, ...params } = publicOptions(options,
    [...placementFields, 'amountInUSD', 'entryPrice', 'tradingSession', 'rejectMarketable', 'maxSpreadPercent',
      'bufferSteps', 'maxSellQuantity', 'beforeSubmit'])
  if (typeof rejectMarketable !== 'boolean') throw new TypeError('rejectMarketable must be a boolean')
  validateMaxSpreadPercent(maxSpreadPercent)
  const amount = orderAmount(amountInUSD)
  const payload = placementPayload({ ...params, orderType: 'LIMIT', price: entryPrice, quantity: '1' })
  const sizing = { bufferSteps, maxSellQuantity, beforeSubmit }
  validatePlacementOptions(payload.side, sizing)
  assertOrder(payload)
  const price = decimalValue(payload.price, 'entryPrice')
  const rules = await loadOrderRules(main, payload.symbol)
  payload.quantity = amount.divToInt(price.times(rules.stepSize)).times(rules.stepSize).toString()
  applySellSizing(main, payload, rules, sizing)
  return submitOrder(main, payload, rules, { rejectMarketable, maxSpreadPercent, beforeSubmit })
}
