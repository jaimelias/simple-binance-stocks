import { publicOptions } from '../utilities/publicInputs.js'
import { openOrders } from '../utilities/endpointAsserts.js'

/** Return the raw open-order array, including a valid empty array. */
export async function getOpenOrders(main, options = {}) {
  const payload = publicOptions(options, ['recvWindow'])
  openOrders(payload)
  return main.apiClient('openOrders', payload)
}
