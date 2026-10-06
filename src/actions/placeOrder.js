import { placeOrder as assertOrder } from '../utilities/endpointAsserts.js'
import { placementPayload, loadOrderRules, submitOrder } from '../utilities/orderPreparation.js'

/** Place an explicit Binance order without resizing the caller's quantity. */
export async function placeOrder(main, params) {
  const payload = placementPayload(params)
  assertOrder(payload)
  const rules = await loadOrderRules(main, payload.symbol)
  return submitOrder(main, payload, rules)
}
