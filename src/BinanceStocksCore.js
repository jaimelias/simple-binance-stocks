import Decimal from './utilities/decimal.js'
import { endpoints } from './utilities/endpoints.js'
export {getNyMarketSession} from './utilities/getNyMarketSession.js'

/** Portable Stocks REST client. All network methods return promises. */
export default class BinanceStocksCore {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? 'https://api.binance.com';
  }

  getNyMarketSession() {
    return getNyMarketSession()
  }

  quote(symbol) {

  }

}
