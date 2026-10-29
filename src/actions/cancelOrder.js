import { publicOptions } from '../utilities/publicInputs.js'
import { cancelOrder as assertCancel } from '../utilities/endpointAsserts.js'

/** Request cancellation once; an acknowledgement does not prove completion. */
export const cancelOrder = async (main, options) => {
  const payload = publicOptions(options, ['orderId', 'recvWindow'])
  assertCancel(payload)
  return main.apiClient('cancelOrder', payload)
}
