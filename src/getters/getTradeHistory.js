import { publicOptions, normalizeSymbol } from '../utilities/publicInputs.js'
import { tradeHistory } from '../utilities/endpointAsserts.js'

/** Fetch exactly one requested page; every trade row represents one fill. */
export async function getTradeHistory(main, options) {
  const payload = { current: 1, size: 20, ...publicOptions(options,
    ['startTime', 'endTime', 'current', 'size', 'symbol', 'side', 'orderId', 'recvWindow']) }
  if (payload.symbol !== undefined) payload.symbol = normalizeSymbol(payload.symbol)
  tradeHistory(payload)
  return main.apiClient('tradeHistory', payload)
}
