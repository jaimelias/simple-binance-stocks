import Transport from './transport.js'
import { endpoints } from './endpoints.js'
import { ResponseError } from './errors.js'
import { createSizedOrder, validateOrderInput, validateOrderRules } from './orders.js'
import {
  allowedKeys, amountInUSD, clientOrderId, compact, cursor, enumValue,
  nonEmptyString, pagination, positiveDecimal, recvWindow, ticker, timeRange, usdc
} from './validation.js'

export {
  BinanceAPIError, RateLimitError, UnknownExecutionError, ResponseError, ValidationError
} from './errors.js'

const clientOptions = [
  'apiKey', 'apiSecret', 'symbol', 'quoteAsset', 'fetch', 'crypto', 'sign', 'now',
  'baseUrl', 'recvWindow', 'rateLimitFallbackMs'
]
const sizedOptions = [
  'symbol', 'side', 'amountInUSD', 'quoteAsset', 'timeInForce', 'walletType',
  'tokenize', 'clientOrderId', 'recvWindow'
]

/** Portable Stocks REST client. All network methods return promises. */
export default class BinanceStocks {
  constructor(options = {}) {
    allowedKeys(options, clientOptions, 'client')
    usdc(options.quoteAsset)
    if (options.symbol !== undefined) ticker(options.symbol)
    this.symbol = options.symbol
    Object.defineProperty(this, 'quoteAsset', { value: 'USDC', enumerable: true })
    this._crypto = options.crypto ?? globalThis.crypto
    const { symbol, quoteAsset, ...transportOptions } = options
    this._transport = new Transport(transportOptions)
  }

  _request(name, params = {}) {
    return this._transport.request({ ...endpoints[name], params: compact(params) })
  }

  _newClientOrderId() {
    let value
    if (typeof Utilities !== 'undefined' && typeof Utilities.getUuid === 'function') {
      value = Utilities.getUuid()
    } else if (typeof this._crypto?.randomUUID === 'function') {
      value = this._crypto.randomUUID()
    } else if (typeof this._crypto?.getRandomValues === 'function') {
      value = Array.from(this._crypto.getRandomValues(new Uint8Array(16)), byte =>
        byte.toString(16).padStart(2, '0')).join('')
    } else {
      throw new TypeError('Provide clientOrderId or a crypto implementation with randomUUID/getRandomValues.')
    }
    return clientOrderId(value)
  }

  _identified(params) {
    return { ...params, clientOrderId: params.clientOrderId ?? this._newClientOrderId() }
  }

  async getExchangeInfo(params = {}) {
    allowedKeys(params, ['symbol'])
    const { symbol } = params
    if (symbol !== undefined) ticker(symbol)
    return this._request('exchangeInfo', { symbol })
  }

  async getSymbolInfo(symbol = this.symbol) {
    ticker(symbol)
    const result = await this.getExchangeInfo({ symbol })
    if (!result || !Array.isArray(result.symbols)) {
      throw new ResponseError('Exchange info response must contain a symbols array.')
    }
    const info = result.symbols.find(item => item?.symbol === symbol)
    if (!info) throw new RangeError(`No active exchange information for symbol ${symbol}.`)
    return info
  }

  async getQuote(symbol = this.symbol) {
    return this._request('quote', { symbol: ticker(symbol) })
  }

  async getTokenizedAssets() {
    return this._request('tokenizedAssets')
  }

  async placeOrder(params) {
    allowedKeys(params, [
      'symbol', 'side', 'orderType', 'quoteAsset', 'price', 'quantity', 'notional',
      'timeInForce', 'tradingSession', 'walletType', 'tokenize', 'clientOrderId', 'recvWindow'
    ], 'order')
    const order = validateOrderInput({ ...params, symbol: params.symbol ?? this.symbol })
    const info = await this.getSymbolInfo(order.symbol)
    const quote = order.orderType === 'MARKET' && order.side === 'SELL'
      ? await this.getQuote(order.symbol) : null
    const validated = validateOrderRules(order, info, quote)
    return this._request('placeOrder', this._identified(validated))
  }

  async createLimitOrder(params) {
    allowedKeys(params, [...sizedOptions, 'entryPrice', 'tradingSession'], 'limit order')
    amountInUSD(params.amountInUSD)
    usdc(params.quoteAsset)
    const symbol = ticker(params.symbol ?? this.symbol)
    const info = await this.getSymbolInfo(symbol)
    const order = createSizedOrder({ ...params, symbol, orderType: 'LIMIT' }, info)
    return this._request('placeOrder', this._identified(order))
  }

  async createMarketOrder(params) {
    allowedKeys(params, sizedOptions, 'market order')
    amountInUSD(params.amountInUSD)
    usdc(params.quoteAsset)
    const symbol = ticker(params.symbol ?? this.symbol)
    const info = await this.getSymbolInfo(symbol)
    const quote = (params.side ?? 'BUY') === 'SELL' ? await this.getQuote(symbol) : null
    const order = createSizedOrder({ ...params, symbol, orderType: 'MARKET' }, info, quote)
    return this._request('placeOrder', this._identified(order))
  }

  async cancelOrder(params) {
    allowedKeys(params, ['orderId', 'recvWindow'])
    nonEmptyString(params.orderId, 'orderId')
    recvWindow(params.recvWindow)
    return this._request('cancelOrder', params)
  }

  /** Cancels every open Stocks order on the account, across all symbols. */
  async cancelAllOrders(params = {}) {
    allowedKeys(params, ['recvWindow'])
    recvWindow(params.recvWindow)
    return this._request('cancelAllOrders', params)
  }

  async getOpenOrders(params = {}) {
    allowedKeys(params, ['recvWindow'])
    recvWindow(params.recvWindow)
    return this._request('openOrders', params)
  }

  async getOrder(params) {
    allowedKeys(params, ['orderId', 'clientOrderId', 'recvWindow'])
    if (params.orderId === undefined && params.clientOrderId === undefined) {
      throw new TypeError('Provide orderId or clientOrderId.')
    }
    if (params.orderId !== undefined) nonEmptyString(params.orderId, 'orderId')
    if (params.clientOrderId !== undefined) clientOrderId(params.clientOrderId)
    recvWindow(params.recvWindow)
    return this._request('orderDetail', params)
  }

  async getOrderHistory(params) {
    allowedKeys(params, ['startTime', 'endTime', 'symbol', 'orderType', 'side', 'orderStatus', 'current', 'size', 'recvWindow'])
    this._historyParams(params)
    if (params.orderType !== undefined) enumValue(params.orderType, 'orderType', ['LIMIT', 'MARKET'])
    if (params.orderStatus !== undefined) {
      nonEmptyString(params.orderStatus, 'orderStatus')
      for (const status of params.orderStatus.split(',')) {
        enumValue(status, 'orderStatus', ['FILLED', 'PARTIALLY_FILLED', 'CANCELED', 'EXPIRED', 'REJECTED'])
      }
    }
    return this._request('orderHistory', params)
  }

  async getTradeHistory(params) {
    allowedKeys(params, ['startTime', 'endTime', 'symbol', 'side', 'orderId', 'current', 'size', 'recvWindow'])
    this._historyParams(params)
    if (params.orderId !== undefined) nonEmptyString(params.orderId, 'orderId')
    return this._request('tradeHistory', params)
  }

  _historyParams(params) {
    timeRange(params)
    pagination(params)
    recvWindow(params.recvWindow)
    if (params.symbol !== undefined) ticker(params.symbol)
    if (params.side !== undefined) enumValue(params.side, 'side', ['BUY', 'SELL'])
  }

  async mintTokenized(params) {
    allowedKeys(params, ['underlyingAsset', 'underlyingAssetAmount', 'clientOrderId', 'recvWindow'])
    ticker(params.underlyingAsset)
    if (params.clientOrderId !== undefined) clientOrderId(params.clientOrderId)
    recvWindow(params.recvWindow)
    return this._request('mint', this._identified({
      ...params, underlyingAssetAmount: positiveDecimal(params.underlyingAssetAmount, 'underlyingAssetAmount')
    }))
  }

  async redeemTokenized(params) {
    allowedKeys(params, ['tokenizedAsset', 'tokenizedAssetAmount', 'clientOrderId', 'recvWindow'])
    nonEmptyString(params.tokenizedAsset, 'tokenizedAsset')
    if (params.clientOrderId !== undefined) clientOrderId(params.clientOrderId)
    recvWindow(params.recvWindow)
    return this._request('redeem', this._identified({
      ...params, tokenizedAssetAmount: positiveDecimal(params.tokenizedAssetAmount, 'tokenizedAssetAmount')
    }))
  }

  async getConversionStatus(params) {
    allowedKeys(params, ['issuerRequestId', 'convertType', 'recvWindow'])
    nonEmptyString(params.issuerRequestId, 'issuerRequestId')
    enumValue(params.convertType, 'convertType', ['MINT', 'REDEEM'])
    recvWindow(params.recvWindow)
    return this._request('conversionStatus', params)
  }

  async getConversionHistory(params = {}) {
    allowedKeys(params, ['startTime', 'endTime', 'lastId', 'size', 'recvWindow'])
    timeRange(params, false)
    pagination(params)
    recvWindow(params.recvWindow)
    return this._request('conversionHistory', {
      ...params, lastId: params.lastId === undefined ? undefined : cursor(params.lastId)
    })
  }

  async acceptDisclaimer(params) {
    allowedKeys(params, ['accepted', 'recvWindow'])
    if (params.accepted !== true) throw new TypeError('Explicit accepted: true is required to acknowledge the US equity disclaimer.')
    recvWindow(params.recvWindow)
    return this._request('disclaimer', { recvWindow: params.recvWindow })
  }

  async createListenKey(params = {}) {
    allowedKeys(params, ['recvWindow'])
    recvWindow(params.recvWindow)
    return this._request('listenKey', params)
  }

  getRateLimitState() {
    return this._transport.getRateLimitState()
  }
}
