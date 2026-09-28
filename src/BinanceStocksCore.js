import { getNyMarketSession } from './utilities/getNyMarketSession.js'
import { endpoints } from './utilities/endpointsMaster.js'

/** Portable Stocks REST client. Network methods use the platform transport. */
export default class BinanceStocksCore {
  constructor(options = {}) {

    this.errorLogger = typeof options.errorLogger === 'function' 
      ? options.errorLogger
      : (err) => { console.error(err) }

    const baseUrl = options.baseUrl ?? 'https://api.binance.com'

    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.API_KEY = options.API_KEY;
    this.API_SECRET = options.API_SECRET;
  }

  async #core(key, payload = {}) {

    return this.transport(key, payload)
  }

  getNyMarketSession() {
    return getNyMarketSession();
  }

  getQuote(symbol) {
    return this.#core('quote', {symbol})
  }
}
