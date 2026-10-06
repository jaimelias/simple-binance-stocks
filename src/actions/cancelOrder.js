import { publicOptions } from '../utilities/publicInputs.js'
import { cancelOrder as assertCancel } from '../utilities/endpointAsserts.js'

/** Request cancellation once; an acknowledgement does not prove completion. */
export async function cancelOrder(main, options) {
  const payload = publicOptions(options, ['orderId', 'recvWindow'])
  assertCancel(payload)
  try {
    return await main.apiClient('cancelOrder', payload)
  } catch (error) {
    if (error !== null && (typeof error === 'object' || typeof error === 'function')) error.orderId = payload.orderId
    throw error
  }
}
