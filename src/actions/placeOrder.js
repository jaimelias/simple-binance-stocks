import { placeOrder as assertOrder } from '../utilities/endpointAsserts.js'
import { publicOptions, validateMaxSpreadPercent } from '../utilities/publicInputs.js'
import { placementFields, placementPayload, loadOrderRules, submitOrder } from '../utilities/orderPreparation.js'

/** Place an explicit Binance order without resizing the caller's quantity. */
export const placeOrder = async (main, params) => {
  const { maxSpreadPercent = 2, ...fields } = publicOptions(params,
    [...placementFields, 'orderType', 'price', 'quantity', 'notional', 'tradingSession', 'maxSpreadPercent'])
  validateMaxSpreadPercent(maxSpreadPercent)
  const payload = placementPayload(fields)
  assertOrder(payload)
  const rules = await loadOrderRules(main, payload.symbol)
  return submitOrder(main, payload, rules, { maxSpreadPercent })
}
