import { getNyMarketSession } from './utilities/getNyMarketSession.js'
import { getSymbolInfo } from './getters/getSymbolInfo.js'
import { createLimitOrder } from './actions/createLimitOrder.js'
import { createMarketOrder } from './actions/createMarketOrder.js'
import { placeOrder } from './actions/placeOrder.js'
import { cancelOrder } from './actions/cancelOrder.js'
import { cancelAllOrders } from './actions/cancelAllOrders.js'
import { getOrder } from './getters/getOrder.js'
import { getOpenOrders } from './getters/getOpenOrders.js'
import { getOrderHistory } from './getters/getOrderHistory.js'
import { getTradeHistory } from './getters/getTradeHistory.js'
import { getEquityWallet } from './getters/getEquityWallet.js'
import { getFundingWallet } from './getters/getFundingWallet.js'
import { getPortfolio } from './getters/getPortfolio.js'

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

  /** Size a LIMIT order; rejectMarketable optionally checks the latest opposing quote. */
  async createLimitOrder(options) { return createLimitOrder(this, options) }

  /** Submit a MARKET buy by notional or size a sell using the current bid. */
  async createMarketOrder(options) { return createMarketOrder(this, options) }

  /** Validate and submit an explicit Binance order without resizing it. */
  async placeOrder(params) { return placeOrder(this, params) }

  /** Request cancellation and return Binance's acknowledgement. */
  async cancelOrder(options) { return cancelOrder(this, options) }

  /** Request cancellation of all open orders in one call. */
  async cancelAllOrders(options = {}) { return cancelAllOrders(this, options) }

  /** Return raw order detail by orderId, clientOrderId, or both. */
  async getOrder(options) { return getOrder(this, options) }

  /** Return the raw array of open orders. */
  async getOpenOrders(options = {}) { return getOpenOrders(this, options) }

  /** Return one raw page of order history for the required time window. */
  async getOrderHistory(options) { return getOrderHistory(this, options) }

  /** Return one raw page of fills for the required time window. */
  async getTradeHistory(options) { return getTradeHistory(this, options) }

  /** Estimate equity holdings from every page of fills in a fixed window. */
  async getEquityWallet(options = {}) { return getEquityWallet(this, options) }

  /** Read the USDC Funding Wallet, including locked funds. */
  async getFundingWallet(options = {}) { return getFundingWallet(this, options) }

  /** Report estimated holdings at current bids and current funding cash. */
  async getPortfolio(options = {}) { return getPortfolio(this, options) }
}
