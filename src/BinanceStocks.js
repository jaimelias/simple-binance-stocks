import Transport from './transport.js'
import MetadataCache from './cache.js'
import Decimal from './decimal.js'
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
  'apiKey', 'apiSecret', 'quoteAsset', 'fetch', 'crypto', 'sign', 'now',
  'baseUrl', 'recvWindow', 'rateLimitFallbackMs'
]
const sizedOptions = [
  'symbol', 'side', 'amountInUSD', 'quoteAsset', 'timeInForce', 'walletType',
  'tokenize', 'clientOrderId', 'recvWindow'
]
const EXCHANGE_INFO_TTL_SECONDS = 300
const TOKENIZED_ASSETS_TTL_SECONDS = 21600
const TRADE_HISTORY_PAGE_SIZE = 100

function decimalField(value, name) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new ResponseError(`${name} must be a nonnegative decimal string.`)
  }
  return new Decimal(value)
}

function portfolioNumber(value, name) {
  const number = Number(value.toFixed())
  if (!Number.isFinite(number) || (number === 0 && !value.isZero())) {
    throw new ResponseError(`${name} cannot be represented as a finite portfolio number.`)
  }
  return number
}

function portfolioWeight(value, total) {
  if (total.isZero()) return null
  const scaled = value.times('10000')
  const whole = scaled.divToInt(total)
  const rounded = scaled.mod(total).times('2').gte(total) ? whole.plus('1') : whole
  return Number(rounded.toFixed()) / 10000
}

function validExchangeSymbol(item, requestedSymbol) {
  try {
    if (!item || Array.isArray(item) || ticker(item.symbol) !== item.symbol ||
        (requestedSymbol !== undefined && item.symbol !== requestedSymbol) ||
        !['BUY_SELL', 'BUY', 'SELL', 'NONE'].includes(item.tradability)) return false
    for (const field of ['fractionable', 'fractionableEh', 'extendedSession', 'overnightSupported']) {
      if (typeof item[field] !== 'boolean') return false
    }
    const values = {}
    for (const field of ['stepSize', 'minQty', 'maxQty', 'minNotional', 'maxNotional']) {
      values[field] = decimalField(item[field], `Exchange info ${field}`)
    }
    return !values.stepSize.isZero() && !values.maxQty.isZero() &&
      !values.maxNotional.isZero() && values.minQty.lte(values.maxQty) &&
      values.minNotional.lte(values.maxNotional) && values.stepSize.lte(values.maxQty)
  } catch {
    return false
  }
}

function validTokenizedAsset(item) {
  try {
    return item && !Array.isArray(item) &&
      typeof item.assetCode === 'string' && /^[A-Z0-9]+$/.test(item.assetCode) &&
      typeof item.assetName === 'string' && item.assetName.trim().length > 0 &&
      ticker(item.underlyingEquitySymbol) === item.underlyingEquitySymbol &&
      !decimalField(item.multiplier, 'Tokenized multiplier').isZero() &&
      typeof item.multiplierValid === 'boolean'
  } catch {
    return false
  }
}

function refreshOption(params, name) {
  allowedKeys(params, ['refresh'], name)
  if (params.refresh !== undefined && typeof params.refresh !== 'boolean') {
    throw new TypeError('refresh must be a boolean.')
  }
  return params.refresh === true
}

/** Portable Stocks REST client. All network methods return promises. */
export default class BinanceStocks {
  constructor(options = {}) {
    allowedKeys(options, clientOptions, 'client')
    usdc(options.quoteAsset)
    Object.defineProperty(this, 'quoteAsset', { value: 'USDC', enumerable: true })
    this._crypto = options.crypto ?? globalThis.crypto
    this._now = options.now ?? Date.now
    const { quoteAsset, ...transportOptions } = options
    this._transport = new Transport(transportOptions)
    this._metadataCache = new MetadataCache({
      now: this._now,
      baseUrl: options.baseUrl ?? 'https://api.binance.com'
    })
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

  async getExchangeInfo(options = {}) {
    allowedKeys(options, [], 'exchange-info options')
    this._transport.assertApiKey()
    const result = await this._request('exchangeInfo')
    if (!result || !Array.isArray(result.symbols)) {
      throw new ResponseError('Exchange info response must contain a symbols array.')
    }
    return result
  }

  async getSymbolInfo(symbol, options = {}) {
    ticker(symbol)
    const refresh = refreshOption(options, 'symbol-info options')
    this._transport.assertApiKey()
    const key = `symbolInfo:${symbol}`
    if (!refresh) {
      const cached = this._metadataCache.get(key)
      if (cached !== undefined) return cached
    }
    const result = await this._request('exchangeInfo', { symbol })
    if (!result || !Array.isArray(result.symbols)) {
      throw new ResponseError('Exchange info response must contain a symbols array.')
    }
    const info = result.symbols.find(item => item?.symbol === symbol)
    if (!info) throw new RangeError(`No active exchange information for symbol ${symbol}.`)
    if (result.symbols.length === 1 && validExchangeSymbol(info, symbol)) {
      this._metadataCache.set(key, info, EXCHANGE_INFO_TTL_SECONDS)
    }
    return info
  }

  async getQuote(symbol) {
    return this._request('quote', { symbol: ticker(symbol) })
  }

  async getTokenizedAssets(options = {}) {
    const refresh = refreshOption(options, 'tokenized-assets options')
    this._transport.assertApiKey()
    const key = 'tokenizedAssets'
    if (!refresh) {
      const cached = this._metadataCache.get(key)
      if (cached !== undefined) return cached
    }
    const result = await this._request('tokenizedAssets')
    if (!Array.isArray(result)) throw new ResponseError('Tokenized assets response must be an array.')
    if (result.length > 0 && result.every(validTokenizedAsset)) {
      this._metadataCache.set(key, result, TOKENIZED_ASSETS_TTL_SECONDS)
    }
    return result
  }

  async placeOrder(params) {
    allowedKeys(params, [
      'symbol', 'side', 'orderType', 'quoteAsset', 'price', 'quantity', 'notional',
      'timeInForce', 'tradingSession', 'walletType', 'tokenize', 'clientOrderId', 'recvWindow'
    ], 'order')
    const order = validateOrderInput(params)
    const info = await this.getSymbolInfo(order.symbol, { refresh: true })
    const quote = order.orderType === 'MARKET' && order.side === 'SELL'
      ? await this.getQuote(order.symbol) : null
    const validated = validateOrderRules(order, info, quote)
    return this._request('placeOrder', this._identified(validated))
  }

  async createLimitOrder(params) {
    allowedKeys(params, [...sizedOptions, 'entryPrice', 'tradingSession'], 'limit order')
    amountInUSD(params.amountInUSD)
    usdc(params.quoteAsset)
    const symbol = ticker(params.symbol)
    const info = await this.getSymbolInfo(symbol, { refresh: true })
    const order = createSizedOrder({ ...params, symbol, orderType: 'LIMIT' }, info)
    return this._request('placeOrder', this._identified(order))
  }

  async createMarketOrder(params) {
    allowedKeys(params, sizedOptions, 'market order')
    amountInUSD(params.amountInUSD)
    usdc(params.quoteAsset)
    const symbol = ticker(params.symbol)
    const info = await this.getSymbolInfo(symbol, { refresh: true })
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

  /** Estimate shares from all reported fills in the requested time range. */
  async getEquityWallet(params = {}) {
    allowedKeys(params, ['startTime', 'endTime', 'recvWindow'], 'equity-wallet options')
    const startTime = params.startTime ?? 0
    const endTime = params.endTime ?? this._now()
    const seen = new Map()
    const totals = new Map()
    let expectedTotal
    let current = 1

    while (true) {
      const response = await this.getTradeHistory({
        startTime, endTime, current, size: TRADE_HISTORY_PAGE_SIZE, recvWindow: params.recvWindow
      })
      if (!response || !Number.isSafeInteger(response.total) || response.total < 0 ||
          response.page !== current || !Array.isArray(response.rows) ||
          response.rows.length > TRADE_HISTORY_PAGE_SIZE) {
        throw new ResponseError('Trade history returned an invalid page.')
      }
      if (expectedTotal === undefined) expectedTotal = response.total
      if (response.total !== expectedTotal) {
        throw new ResponseError('Trade history changed during pagination; retry the wallet estimate.')
      }
      let newRows = 0
      for (const row of response.rows) {
        if (!row || typeof row.executionId !== 'string' || row.executionId.length === 0 ||
            !['BUY', 'SELL'].includes(row.side)) {
          throw new ResponseError('Trade history contains an invalid execution row.')
        }
        let symbol
        try { symbol = ticker(row.symbol) } catch {
          throw new ResponseError('Trade history contains an invalid equity symbol.')
        }
        const quantity = decimalField(row.qty, 'Trade quantity')
        if (quantity.isZero()) throw new ResponseError('Trade quantity must be greater than zero.')
        const fingerprint = `${symbol}|${row.side}|${quantity.toFixed()}`
        if (seen.has(row.executionId)) {
          if (seen.get(row.executionId) !== fingerprint) {
            throw new ResponseError('Trade history contains conflicting execution IDs.')
          }
          continue
        }
        seen.set(row.executionId, fingerprint)
        newRows += 1
        const value = totals.get(symbol) ?? { bought: new Decimal('0'), sold: new Decimal('0') }
        value[row.side === 'BUY' ? 'bought' : 'sold'] =
          value[row.side === 'BUY' ? 'bought' : 'sold'].plus(quantity)
        totals.set(symbol, value)
      }
      if (seen.size > expectedTotal) throw new ResponseError('Trade history returned more fills than its total.')
      if (seen.size === expectedTotal) break
      if (newRows === 0) throw new ResponseError('Trade history pagination stopped before all fills were returned.')
      current += 1
    }

    const wallet = {}
    for (const symbol of [...totals.keys()].sort()) {
      const { bought, sold } = totals.get(symbol)
      if (sold.gt(bought)) {
        throw new ResponseError(`Trade-derived shares for ${symbol} are negative; the history is incomplete.`)
      }
      const amount = bought.minus(sold)
      if (!amount.isZero()) wallet[symbol] = { amount: amount.toFixed() }
    }
    return wallet
  }

  /** Read USDC in Binance's Funding Wallet. The report amount is free plus locked. */
  async getFundingWallet(params = {}) {
    allowedKeys(params, ['recvWindow'], 'funding-wallet options')
    recvWindow(params.recvWindow)
    const response = await this._request('fundingWallet', { asset: 'USDC', recvWindow: params.recvWindow })
    if (response.length > 1) throw new ResponseError('Funding Wallet returned duplicate USDC balances.')
    if (response.length === 0) {
      return { USDC: { free: '0', locked: '0', freeze: '0', withdrawing: '0', amount: '0' } }
    }
    if (!response[0] || response[0].asset !== 'USDC') {
      throw new ResponseError('Funding Wallet returned an invalid USDC balance.')
    }
    const balance = {}
    for (const field of ['free', 'locked', 'freeze', 'withdrawing']) {
      balance[field] = decimalField(response[0][field], `Funding Wallet ${field}`).toFixed()
    }
    balance.amount = new Decimal(balance.free).plus(balance.locked).toFixed()
    return { USDC: balance }
  }

  /** Value trade-derived equity shares at current USD bid prices. */
  async getPortfolio(params = {}) {
    allowedKeys(params, ['startTime', 'endTime', 'recvWindow'], 'portfolio options')
    const [equityWallet, fundingWallet] = await Promise.all([
      this.getEquityWallet(params),
      this.getFundingWallet({ recvWindow: params.recvWindow })
    ])
    const cashValue = new Decimal(fundingWallet.USDC.amount)
    const usdcAmount = portfolioNumber(cashValue, 'USDC amount')
    const portfolio = {
      totals: { totalUsd: null, positionsUsd: null, cashUsd: usdcAmount },
      cash: { USDC: { amount: usdcAmount, quote: 1, usd: usdcAmount, weight: null } },
      positions: {}
    }
    const positionValues = new Map()
    let positionsValue = new Decimal('0')
    let complete = true
    for (const [symbol, holding] of Object.entries(equityWallet)) {
      const amount = portfolioNumber(new Decimal(holding.amount), `${symbol} amount`)
      const quote = await this.getQuote(symbol)
      if (!quote || quote.symbol !== symbol || typeof quote.bidPrice !== 'string' ||
          !/^\d+(?:\.\d+)?$/.test(quote.bidPrice) || new Decimal(quote.bidPrice).isZero()) {
        portfolio.positions[symbol] = {
          amount, quote: null, usd: null, weight: null
        }
        complete = false
        continue
      }
      const bid = new Decimal(quote.bidPrice)
      const value = new Decimal(holding.amount).times(bid)
      portfolio.positions[symbol] = {
        amount,
        quote: portfolioNumber(bid, `${symbol} quote`),
        usd: portfolioNumber(value, `${symbol} USD value`),
        weight: null
      }
      positionValues.set(symbol, value)
      positionsValue = positionsValue.plus(value)
    }
    if (complete) {
      const totalValue = cashValue.plus(positionsValue)
      portfolio.totals.totalUsd = portfolioNumber(totalValue, 'Portfolio USD total')
      portfolio.totals.positionsUsd = portfolioNumber(positionsValue, 'Positions USD total')
      portfolio.cash.USDC.weight = portfolioWeight(cashValue, totalValue)
      for (const [symbol, value] of positionValues) {
        portfolio.positions[symbol].weight = portfolioWeight(value, totalValue)
      }
    }
    return portfolio
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
