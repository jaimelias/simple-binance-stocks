import { publicOptions, normalizeSymbol } from '../utilities/publicInputs.js'
import { orderHistory } from '../utilities/endpointAsserts.js'

/** Fetch exactly one requested page of raw order history. */
export async function getOrderHistory(main, options) {
  const payload = { current: 1, size: 20, ...publicOptions(options,
    ['startTime', 'endTime', 'current', 'size', 'symbol', 'orderType', 'side', 'orderStatus', 'recvWindow']) }
  if (payload.symbol !== undefined) payload.symbol = normalizeSymbol(payload.symbol)
  orderHistory(payload)
  return main.apiClient('orderHistory', payload)
}
