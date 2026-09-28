import { getNyMarketSession } from './utilities/getNyMarketSession.js'
import { endpoints } from './utilities/endpointsMaster.js'

const transports = new WeakMap()

const dispatchTransport = (client, key, payload = {})  => {
  const transport = transports.get(client)

  if (!transport) {
    throw new TypeError('No transport adapter configured')
  }

  return transport(client, key, payload)
}


/** Portable Stocks REST client. Network methods use the platform transport. */
export default class BinanceStocksCore {

  constructor(options = {}, transportAdapter) {

    if (typeof transportAdapter !== 'function') {
      throw new TypeError('A transport adapter is required')
    }

    transports.set(this, transportAdapter)

    this.errorLogger = typeof options.errorLogger === 'function' 
      ? options.errorLogger
      : (err) => { console.error(err) }

    const baseUrl = options.baseUrl ?? 'https://api.binance.com'

    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.API_KEY = options.API_KEY;
    this.API_SECRET = options.API_SECRET;
  }

  getNyMarketSession() {
    return getNyMarketSession();
  }

  getQuote(symbol) {
    return dispatchTransport(this, 'quote', { symbol })
  }
}
