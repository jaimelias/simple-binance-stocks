import { publicOptions } from '../utilities/publicInputs.js'
import { cancelAllOrders as assertCancel } from '../utilities/endpointAsserts.js'

/** Return the dedicated cancel-all acknowledgement without inferring order state. */
export const cancelAllOrders = async (main, options = {}) => {
  const payload = publicOptions(options, ['recvWindow'])
  assertCancel(payload)
  return main.apiClient('cancelAllOrders', payload)
}
