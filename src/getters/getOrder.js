import { publicOptions } from '../utilities/publicInputs.js'
import { orderDetail } from '../utilities/endpointAsserts.js'

/** Return raw order detail for either or both supplied identifiers. */
export async function getOrder(main, options) {
  const payload = publicOptions(options, ['orderId', 'clientOrderId', 'recvWindow'])
  orderDetail(payload)
  return main.apiClient('orderDetail', payload)
}
