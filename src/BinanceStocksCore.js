import { getNyMarketSession } from './utilities/getNyMarketSession.js'
export { getNyMarketSession }

/** Portable Stocks REST client. Network methods use the platform transport. */
export default class BinanceStocksCore {
  constructor(options = {}) {

    this.errorLogger = typeof options.errorLogger === 'function' 
      ? options.errorLogger
      : (err) => {
        console.error(err)
      }

    this.baseUrl = options.baseUrl ?? 'https://api.binance.com';
  }

  getNyMarketSession() {
    return getNyMarketSession();
  }

  quote(symbol) {
    return this.transport('quote', { symbol })
  }

  exchangeInfo(payload = {}) {
    return this.transport('exchangeInfo', payload)
  }

  tokenizedAssets(payload = {}) {
    return this.transport('tokenizedAssets', payload)
  }

  placeOrder(payload = {}) {
    return this.transport('placeOrder', payload)
  }

  cancelOrder(payload = {}) {
    return this.transport('cancelOrder', payload)
  }

  cancelAllOrders(payload = {}) {
    return this.transport('cancelAllOrders', payload)
  }

  openOrders(payload = {}) {
    return this.transport('openOrders', payload)
  }

  orderHistory(payload = {}) {
    return this.transport('orderHistory', payload)
  }

  orderDetail(payload = {}) {
    return this.transport('orderDetail', payload)
  }

  tradeHistory(payload = {}) {
    return this.transport('tradeHistory', payload)
  }

  mint(payload = {}) {
    return this.transport('mint', payload)
  }

  redeem(payload = {}) {
    return this.transport('redeem', payload)
  }

  conversionStatus(payload = {}) {
    return this.transport('conversionStatus', payload)
  }

  conversionHistory(payload = {}) {
    return this.transport('conversionHistory', payload)
  }

  disclaimer(payload = {}) {
    return this.transport('disclaimer', payload)
  }

  listenKey(payload = {}) {
    return this.transport('listenKey', payload)
  }

  fundingWallet(payload = {}) {
    return this.transport('fundingWallet', payload)
  }
}
