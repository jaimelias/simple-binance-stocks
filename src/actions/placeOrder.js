import { placeOrder as assertOrder } from '../utilities/endpointAsserts.js'
import { decimalValue, publicOptions, validateMaxSpreadPercent } from '../utilities/publicInputs.js'
import { placementFields, placementPayload, loadOrderRules, validatePlacementOptions, hasSellSizing, applySellSizing, submitOrder } from '../utilities/orderPreparation.js'

/** Place an explicit Binance order with optional SELL sizing. */
export const placeOrder = async (main, params) => {
  const { maxSpreadPercent = 2, bufferSteps, maxSellQuantity, beforeSubmit, quantityMode, ...fields } = publicOptions(params,
    [...placementFields, 'orderType', 'price', 'quantity', 'notional', 'tradingSession', 'maxSpreadPercent',
      'bufferSteps', 'maxSellQuantity', 'beforeSubmit', 'quantityMode'])
  validateMaxSpreadPercent(maxSpreadPercent)
  const payload = placementPayload(fields)
  const options = { bufferSteps, maxSellQuantity, beforeSubmit, quantityMode }
  validatePlacementOptions(payload.side, options)
  const adjustQuantity = hasSellSizing(main, payload, options)
  if (adjustQuantity) decimalValue(payload.quantity, 'quantity')
  assertOrder(adjustQuantity ? { ...payload, quantity: '1' } : payload)
  const rules = await loadOrderRules(main, payload.symbol)
  applySellSizing(main, payload, rules, options, { estimatedExit: true })
  return submitOrder(main, payload, rules, { maxSpreadPercent, beforeSubmit,
    estimateMarketSellNotional: adjustQuantity && payload.orderType === 'MARKET' })
}
