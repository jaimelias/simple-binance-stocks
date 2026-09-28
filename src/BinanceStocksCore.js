import { getNyMarketSession } from './utilities/getNyMarketSession.js'
import { endpoints } from './utilities/endpointsMaster.js'
import { getSymbolInfo } from './getters/getSymbolInfo.js'

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

  getNyMarketSession() {
    return getNyMarketSession();
  }

  async getQuote(symbol) {
    return this.apiClient('quote', { symbol })
  }

  async getSymbolInfo(symbol) {
    return getSymbolInfo(this, symbol)
  }
}
