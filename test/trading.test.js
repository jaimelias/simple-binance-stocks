import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import NodeClient from '../src/BinanceStocksNode.js'
import GasClient from '../src/BinanceStocksGas.js'
import Decimal from '../src/utilities/decimal.js'

const rules = () => ({
  symbol: 'AAPL', tradability: 'BUY_SELL', stepSize: '0.001', minQty: '0.001', maxQty: '100000',
  minNotional: '0.01', maxNotional: '1000000', fractionable: true, fractionableEh: true,
  extendedSession: true, overnightSupported: true
})
const fill = (id, extra = {}) => ({
  executionId: `fill-${id}`, orderId: 'same-order', symbol: 'AAPL', quote: 'USDC', side: 'BUY', qty: '0.01', ...extra
})
const page = (rows, current = 1, total = rows.length) => ({ total, page: current, size: 100, rows })
const limit = extra => ({ symbol: 'aapl', amountInUSD: 10, entryPrice: '3.00', tradingSession: 'RTH', ...extra })
const direct = extra => ({ symbol: 'aapl', orderType: 'LIMIT', price: '3', quantity: '1', tradingSession: 'RTH', ...extra })
const monetaryOrders = ['BUY', 'SELL'].flatMap(side => [
  ['createLimitOrder', limit({ side })],
  ['createMarketOrder', { symbol: 'aapl', amountInUSD: 10, side }]
])
const placementOrders = [...monetaryOrders, ...['BUY', 'SELL'].flatMap(side => [
  ['placeOrder', direct({ side })],
  ['placeOrder', { symbol: 'aapl', orderType: 'MARKET', side,
    ...(side === 'SELL' ? { quantity: '1' } : { notional: '10' }) }]
])]

/** Exercise the real adapters using deterministic, offline HTTP and GAS runtime substitutes. */
const harness = (t, Client) => {
  const calls = []
  const errors = []
  const state = { rules: rules(), quote: { bidPrice: '3.00', askPrice: '3.01' },
    trades: page([]), funding: [], placement: { status: 'S', orderId: 'order-1', extra: null } }
  const original = { fetch: globalThis.fetch, UrlFetchApp: globalThis.UrlFetchApp, Utilities: globalThis.Utilities }
  const request = (url, options) => {
    const parsed = new URL(url)
    const payload = Object.fromEntries(new URLSearchParams(options.body ?? options.payload ?? parsed.search))
    const call = { path: parsed.pathname, method: options.method.toUpperCase(), payload, headers: options.headers }
    calls.push(call)
    let data
    if (state.handler) data = state.handler(call)
    if (data === undefined) {
      switch (parsed.pathname.split('/').at(-1)) {
        case 'exchangeInfo': data = { symbols: [state.rules] }; break
        case 'quote': data = state.quote; break
        case 'place': data = state.placement; break
        case 'cancel': data = { status: 'S', orderId: payload.orderId }; break
        case 'cancel-all': data = { success: true }; break
        case 'detail': data = { qty: '1.000', fee: null, trades: [], extra: 'untouched' }; break
        case 'open-orders': data = []; break
        case 'history': data = state.trades; break
        case 'get-funding-asset': data = state.funding; break
        case 'listenKey': data = { listenKey: 'dummy-listen-key' }; break
        default: throw new Error(`Unmocked route ${parsed.pathname}`)
      }
    }
    const status = data?.httpStatus ?? 200
    const body = data?.rawBody ?? JSON.stringify(data)
    return { status, body }
  }
  globalThis.fetch = async (url, options) => {
    const response = request(url, options)
    return { status: response.status, statusText: 'Mock', text: async () => response.body }
  }
  globalThis.UrlFetchApp = { fetch: (url, options) => {
    const response = request(url, options)
    return { getResponseCode: () => response.status, getContentText: () => response.body }
  } }
  globalThis.Utilities = {
    getUuid: () => randomUUID(),
    computeHmacSha256Signature: (text, secret) => [...createHmac('sha256', secret).update(text).digest()]
  }
  t.after(() => Object.assign(globalThis, original))
  const client = new Client({ API_KEY: 'dummy-key', API_SECRET: 'dummy-secret', baseUrl: 'https://offline.invalid/',
    errorLogger: error => errors.push(error) })
  return { client, calls, state, errors }
}

for (const Client of [NodeClient, GasClient]) {
  const runtime = Client === NodeClient ? 'Node' : 'GAS'
  const check = (name, fn) => test(`${runtime}: ${name}`, async t => fn(harness(t, Client)))

  check('all thirteen public methods return Promises and preserve raw endpoint responses', async ({ client, calls }) => {
    const jobs = [
      ['createLimitOrder', limit()], ['createMarketOrder', { symbol: 'AAPL', amountInUSD: 10 }],
      ['placeOrder', direct()], ['sellPositions', null], ['cancelOrder', { orderId: 'order-1' }], ['cancelAllOrders'],
      ['getOrder', { orderId: 'order-1', clientOrderId: 'lookup-id' }], ['getOpenOrders'],
      ['getOrderHistory', { startTime: 0, endTime: 1 }], ['getTradeHistory', { startTime: 0, endTime: 1 }],
      ['getEquityWallet'], ['getFundingWallet'], ['getPortfolio']
    ]
    const results = {}
    for (const [method, options] of jobs) {
      const promise = client[method](options)
      assert.ok(promise instanceof Promise, method)
      results[method] = await promise
    }
    assert.deepEqual(results.placeOrder, { status: 'S', orderId: 'order-1', extra: null })
    assert.deepEqual(results.sellPositions, [])
    assert.deepEqual(results.cancelAllOrders, { success: true })
    assert.deepEqual(results.getOpenOrders, [])
    assert.deepEqual(results.getOrder, { qty: '1.000', fee: null, trades: [], extra: 'untouched' })
    assert.deepEqual(results.getTradeHistory, page([]))
    assert.deepEqual(results.getEquityWallet, {})
    const detail = calls.find(call => call.path.endsWith('/detail'))
    assert.equal(detail.payload.orderId, 'order-1')
    assert.equal(detail.payload.clientOrderId, 'lookup-id')
    assert.equal(calls.filter(call => call.path.endsWith('/cancel-all')).length, 1)
  })

  check('exact limit sizing, fresh rules, normalized tickers and explicit false', async ({ client, calls, state }) => {
    const options = limit({ tokenize: false, recvWindow: 12345 })
    await client.createLimitOrder(options)
    state.rules.stepSize = '0.1'
    await client.createLimitOrder(limit({ amountInUSD: 0.3, entryPrice: 0.1 }))
    const orders = calls.filter(call => call.path.endsWith('/place'))
    assert.equal(orders[0].payload.quantity, '3.333')
    assert.equal(orders[0].payload.price, '3.00')
    assert.equal(orders[0].payload.symbol, 'AAPL')
    assert.equal(orders[0].payload.tokenize, 'false')
    assert.equal(orders[0].payload.recvWindow, '12345')
    assert.equal(orders[0].payload.quoteAsset, 'USDC')
    assert.equal(orders[0].payload.side, 'BUY')
    assert.equal(orders[0].payload.timeInForce, 'DAY')
    assert.equal(orders[1].payload.quantity, '3')
    assert.equal(calls.filter(call => call.path.endsWith('/exchangeInfo')).length, 2)
    assert.equal(options.symbol, 'aapl')
    for (const order of orders) {
      for (const field of ['amountInUSD', 'entryPrice', 'notional']) assert.equal(order.payload[field], undefined)
    }
  })

  check('rejectMarketable rejects equal and crossing prices on both sides without submitting', async ({ client, calls, state }) => {
    state.quote = { symbol: 'AAPL', bidPrice: '3.00', askPrice: '3.01' }
    for (const [side, entryPrice] of [['BUY', '3.01'], ['BUY', '3.02'], ['SELL', '3.00'], ['SELL', '2.99']]) {
      const options = Object.freeze(limit({ side, entryPrice, rejectMarketable: true }))
      await assert.rejects(client.createLimitOrder(options), error =>
        error instanceof RangeError && /rejectMarketable.*marketable/.test(error.message) && error.clientOrderId === undefined)
      assert.equal(options.entryPrice, entryPrice)
    }
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 4)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 0)
  })

  check('rejectMarketable checks one opposing quote after rules and preserves accepted order fields', async ({ client, calls, state }) => {
    state.quote = { symbol: 'aapl', bidPrice: '2.99', askPrice: '3.01' }
    const clientOrderId = 'client_1234567890123456789012345678'
    for (const side of ['BUY', 'SELL']) {
      assert.deepEqual(await client.createLimitOrder(limit({ side, clientOrderId, rejectMarketable: true })), state.placement)
    }
    assert.deepEqual(calls.map(call => call.path.split('/').at(-1)),
      ['exchangeInfo', 'quote', 'place', 'exchangeInfo', 'quote', 'place'])
    for (const call of calls.filter(call => call.path.endsWith('/place'))) {
      assert.equal(call.payload.price, '3.00')
      assert.equal(call.payload.quantity, '3.333')
      assert.equal(call.payload.clientOrderId, clientOrderId)
      assert.equal(call.payload.rejectMarketable, undefined)
    }
    assert.ok(calls.filter(call => call.path.endsWith('/quote')).every(call => call.payload.symbol === 'AAPL'))
  })

  check('rejectMarketable compares sub-number-precision quote differences exactly', async ({ client, calls, state }) => {
    state.quote = { bidPrice: '2.99999999999999999999', askPrice: '3.00000000000000000001' }
    await client.createLimitOrder(limit({ rejectMarketable: true }))
    await client.createLimitOrder(limit({ side: 'SELL', rejectMarketable: true }))
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 2)
    state.quote = { bidPrice: '3.00000000000000000001', askPrice: '2.99999999999999999999' }
    await assert.rejects(client.createLimitOrder(limit({ rejectMarketable: true })), /askPrice/)
    await assert.rejects(client.createLimitOrder(limit({ side: 'SELL', rejectMarketable: true })), /askPrice/)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 2)
  })

  check('rejectMarketable fails before submission for unavailable, invalid or failed quotes', async ({ client, calls, state }) => {
    let generated = 0
    client.createClientOrderId = () => { generated++; return randomUUID() }
    for (const side of ['BUY', 'SELL']) {
      const field = side === 'BUY' ? 'askPrice' : 'bidPrice'
      for (const quote of [null, {}, { bidPrice: '2.99', askPrice: '3.01', [field]: undefined },
        ...['0', '-1', 'invalid', false, 'Infinity'].map(value => ({ [field]: value })),
        { symbol: 'MSFT', bidPrice: '2.99', askPrice: '3.01' }]) {
        state.quote = quote
        await assert.rejects(client.createLimitOrder(limit({ side, rejectMarketable: true })))
      }
    }
    state.handler = call => call.path.endsWith('/quote') ? { httpStatus: 503, rawBody: 'quote unavailable' } : undefined
    await assert.rejects(client.createLimitOrder(limit({ rejectMarketable: true })), error =>
      /503/.test(error.message) && error.clientOrderId === undefined)
    const error = new TypeError('quote transport disconnected')
    state.handler = call => { if (call.path.endsWith('/quote')) throw error }
    await assert.rejects(client.createLimitOrder(limit({ rejectMarketable: true })), actual => actual === error)
    assert.equal(error.clientOrderId, undefined)
    assert.equal(generated, 0)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 0)
  })

  check('rejectMarketable is a strict opt-in boolean and never reaches the wire', async ({ client, calls, state }) => {
    for (const rejectMarketable of [null, 0, 1, 'true', 'false', {}, []]) {
      await assert.rejects(client.createLimitOrder(limit({ rejectMarketable })), /rejectMarketable must be a boolean/)
    }
    assert.equal(calls.length, 0)
    await client.createLimitOrder(limit())
    await client.createLimitOrder(limit({ rejectMarketable: false }))
    await client.createLimitOrder(limit({ rejectMarketable: undefined }))
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 3)
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 3)
    assert.ok(calls.every(call => call.payload.rejectMarketable === undefined))
    await assert.rejects(client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 10, rejectMarketable: true }), /rejectMarketable is not allowed/)
    await assert.rejects(client.placeOrder(direct({ rejectMarketable: true })), /rejectMarketable is not allowed/)
  })

  check('rejectMarketable runs only after final size and symbol-rule validation', async ({ client, calls, state }) => {
    state.rules.stepSize = '1'
    await assert.rejects(client.createLimitOrder(limit({ amountInUSD: 1, rejectMarketable: true })), /quantity/)
    state.rules = { ...rules(), tradability: 'NONE' }
    await assert.rejects(client.createLimitOrder(limit({ rejectMarketable: true })), /does not allow/)
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 0)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 0)
  })

  check('guarded submission retains its reconciliation ID and does not retry a failed order', async ({ client, calls, state }) => {
    const error = new TypeError('order transport disconnected')
    state.handler = call => { if (call.path.endsWith('/place')) throw error }
    await assert.rejects(client.createLimitOrder(limit({ rejectMarketable: true, maxSpreadPercent: 1 })), actual => actual === error)
    assert.deepEqual(calls.map(call => call.path.split('/').at(-1)), ['exchangeInfo', 'quote', 'place'])
    assert.equal(error.clientOrderId, calls.at(-1).payload.clientOrderId)
    assert.match(error.clientOrderId, /^[a-f0-9-]{36}$/)
  })

  check('maxSpreadPercent enforces exact midpoint thresholds on both order types and sides', async ({ client, calls, state }) => {
    const clientOrderId = 'client_1234567890123456789012345678'
    for (const [method, params] of monetaryOrders) {
      state.quote = { symbol: ' aapl ', bidPrice: '99.95', askPrice: '100.05' }
      for (const maxSpreadPercent of [0.1, 0.2]) {
        const start = calls.length
        const options = Object.freeze({ ...params, maxSpreadPercent, clientOrderId })
        assert.deepEqual(await client[method](options), state.placement)
        assert.deepEqual(calls.slice(start).map(call => call.path.split('/').at(-1)), ['exchangeInfo', 'quote', 'place'])
        const payload = calls.at(-1).payload
        assert.equal(payload.clientOrderId, clientOrderId)
        assert.equal(payload.side, params.side)
        if (method === 'createLimitOrder') {
          assert.equal(payload.price, '3.00')
          assert.equal(payload.quantity, '3.333')
        } else if (params.side === 'SELL') {
          assert.equal(payload.quantity, '0.1')
          assert.equal(payload.notional, undefined)
        } else {
          assert.equal(payload.notional, '10')
          assert.equal(payload.quantity, undefined)
        }
      }
      await assert.rejects(client[method]({ ...params, maxSpreadPercent: 0.0999 }), error =>
        error instanceof RangeError && /maxSpreadPercent/.test(error.message) && error.clientOrderId === undefined)
      state.quote.askPrice = '100.050000000000000001'
      await assert.rejects(client[method]({ ...params, maxSpreadPercent: 0.1 }), /maxSpreadPercent/)
      state.quote.askPrice = '100.049999999999999999'
      await client[method]({ ...params, maxSpreadPercent: 0.1 })
    }
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 12)
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 20)
    assert.ok(calls.every(call => call.payload.maxSpreadPercent === undefined))
  })

  check('maxSpreadPercent accepts tiny positive limits and compares sub-number-precision differences', async ({ client, calls, state }) => {
    for (const [method, params] of placementOrders) {
      state.quote = { bidPrice: '100', askPrice: '100' }
      await client[method]({ ...params, maxSpreadPercent: 1e-20 })
      state.quote.askPrice = '100.000000000000000001'
      await assert.rejects(client[method]({ ...params, maxSpreadPercent: 1e-20 }), /maxSpreadPercent/)
      await client[method]({ ...params, maxSpreadPercent: 1e-18 })
    }
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, placementOrders.length * 2)
  })

  check('maxSpreadPercent validates before requests on every placement path', async ({ client, calls }) => {
    for (const [method, params] of placementOrders) {
      for (const maxSpreadPercent of [0, -0, 2.0000000000000004, 3, Number.MAX_VALUE,
        null, '', '0.1', NaN, Infinity, -Infinity, -1, true, false, {}, []]) {
        await assert.rejects(client[method]({ ...params, maxSpreadPercent }), error =>
          error instanceof TypeError && /maxSpreadPercent.*greater than 0 and at most 2/.test(error.message))
      }
    }
    assert.equal(calls.length, 0)
  })

  check('default and explicit 2% spread thresholds enforce the exact inclusive boundary', async ({ client, calls, state }) => {
    for (const extra of [{}, { maxSpreadPercent: undefined }, { maxSpreadPercent: 2 }]) {
      for (const [method, params] of placementOrders) {
        state.quote = { bidPrice: '99', askPrice: '101' }
        const start = calls.length
        await client[method]({ ...params, ...extra })
        assert.deepEqual(calls.slice(start).map(call => call.path.split('/').at(-1)), ['exchangeInfo', 'quote', 'place'])
        state.quote.askPrice = '101.000000000000000001'
        await assert.rejects(client[method]({ ...params, ...extra }), error =>
          error instanceof RangeError && /maxSpreadPercent.*2%/.test(error.message) && error.clientOrderId === undefined)
      }
    }
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, placementOrders.length * 6)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, placementOrders.length * 3)
    assert.ok(calls.every(call => call.payload.maxSpreadPercent === undefined))
  })

  check('direct placement accepts a stricter spread threshold without forwarding it to Binance', async ({ client, calls, state }) => {
    state.quote = { bidPrice: '99.95', askPrice: '100.05' }
    for (const [, params] of placementOrders.filter(([method]) => method === 'placeOrder')) {
      await client.placeOrder({ ...params, maxSpreadPercent: 0.1 })
      await assert.rejects(client.placeOrder({ ...params, maxSpreadPercent: 0.0999 }), /maxSpreadPercent/)
    }
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 8)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 4)
    assert.ok(calls.every(call => call.payload.maxSpreadPercent === undefined))
  })

  check('the default spread guard rejects unavailable quotes on every placement path', async ({ client, calls, state }) => {
    let generated = 0
    client.createClientOrderId = () => { generated++; return randomUUID() }
    for (const extra of [{}, { maxSpreadPercent: undefined }]) {
      for (const [method, params] of placementOrders) {
        for (const quote of [null, {}, { bidPrice: '3' }, { askPrice: '3.01' }]) {
          state.quote = quote
          await assert.rejects(client[method]({ ...params, ...extra }))
        }
      }
    }
    assert.equal(generated, 0)
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, placementOrders.length * 8)
    assert.equal(calls.filter(call => call.method === 'POST').length, 0)
  })

  check('raw apiClient placement cannot bypass the spread guard', async ({ client, calls }) => {
    for (const [, params] of placementOrders.filter(([method]) => method === 'placeOrder')) {
      await assert.rejects(client.apiClient('placeOrder', params), error =>
        error instanceof TypeError && /placeOrder/.test(error.message))
    }
    assert.equal(calls.length, 0)
  })

  check('the default guard blocks EWT and USO across helpers, direct placement and wallet selling and logs rejections', async ({ client, calls, state, errors }) => {
    const quotes = [
      { symbol: 'EWT', bidPrice: '96.84', askPrice: '115.52', bidSize: 100, askSize: 100 },
      { symbol: 'USO', bidPrice: '104.08', askPrice: '163', bidSize: 100, askSize: 100 }
    ]
    let generated = 0
    client.createClientOrderId = () => { generated++; return randomUUID() }
    for (const quote of quotes) {
      state.rules = { ...rules(), symbol: quote.symbol }
      state.quote = quote
      for (const [method, params] of placementOrders) {
        await assert.rejects(client[method]({ ...params, symbol: quote.symbol }), error => {
          assert.ok(error instanceof RangeError)
          assert.match(error.message, /maxSpreadPercent.*2%/)
          assert.equal(error.clientOrderId, undefined)
          assert.ok(errors.includes(error))
          return true
        })
      }
    }
    state.trades = page(quotes.map(({ symbol }, i) => fill(i, { symbol, qty: '1' })))
    state.handler = call => {
      if (call.path.endsWith('/exchangeInfo')) return { symbols: quotes.map(({ symbol }) => ({ ...rules(), symbol })) }
      if (call.path.endsWith('/quote')) return quotes.find(({ symbol }) => symbol === call.payload.symbol)
    }
    const results = await client.sellPositions(null)
    assert.equal(results.length, 2)
    for (const [i, { symbol, quantity, error }] of results.entries()) {
      assert.equal(symbol, quotes[i].symbol)
      assert.equal(quantity, '1')
      assert.ok(error instanceof RangeError)
      assert.match(error.message, /maxSpreadPercent.*2%/)
      assert.equal(error.clientOrderId, undefined)
      assert.ok(errors.includes(error))
    }
    assert.equal(generated, 0)
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, placementOrders.length * 2 + 2)
    assert.equal(calls.filter(call => call.method === 'POST').length, 0)
  })

  check('maxSpreadPercent logs invalid, crossed and mismatched quotes before generating IDs or submitting', async ({ client, calls, state, errors }) => {
    let generated = 0
    client.createClientOrderId = () => { generated++; return randomUUID() }
    const valid = { bidPrice: '3', askPrice: '3.01' }
    const invalid = [null, {}, { bidPrice: '4', askPrice: '3' },
      ...['bidPrice', 'askPrice'].flatMap(field =>
        [undefined, null, '0', '-1', 'invalid', false, 'Infinity'].map(value => ({ ...valid, [field]: value }))),
      ...['MSFT', '', null, 123].map(symbol => ({ ...valid, symbol }))]
    for (const [method, params] of placementOrders) {
      for (const quote of invalid) {
        state.quote = quote
        await assert.rejects(client[method]({ ...params, maxSpreadPercent: 1 }), error => errors.at(-1) === error)
      }
    }
    assert.equal(generated, 0)
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, placementOrders.length * invalid.length)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 0)
  })

  check('the default spread guard propagates quote failures without retries or submission', async ({ client, calls, state }) => {
    const error = new TypeError('quote transport disconnected')
    for (const [method, params] of placementOrders) {
      state.handler = call => call.path.endsWith('/quote') ? { httpStatus: 503, rawBody: 'quote unavailable' } : undefined
      await assert.rejects(client[method](params), actual =>
        /503/.test(actual.message) && actual.clientOrderId === undefined)
      state.handler = call => { if (call.path.endsWith('/quote')) throw error }
      await assert.rejects(client[method](params), actual => actual === error)
    }
    assert.equal(error.clientOrderId, undefined)
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, placementOrders.length * 2)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 0)
  })

  check('LIMIT spread and marketability guards share one quote and each can reject', async ({ client, calls, state }) => {
    for (const side of ['BUY', 'SELL']) {
      const options = limit({ side, rejectMarketable: true, maxSpreadPercent: 1 })
      state.quote = { bidPrice: '2.99', askPrice: '3.01' }
      await client.createLimitOrder(options)
      state.quote = { bidPrice: '2', askPrice: '4' }
      await assert.rejects(client.createLimitOrder(options), /maxSpreadPercent/)
      state.quote = { bidPrice: '3', askPrice: '3' }
      await assert.rejects(client.createLimitOrder(options), /rejectMarketable/)
    }
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 6)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 2)
    assert.ok(calls.every(call => call.payload.rejectMarketable === undefined && call.payload.maxSpreadPercent === undefined))
  })

  check('maxSpreadPercent avoids unnecessary quote requests when sizing or rules already reject', async ({ client, calls, state }) => {
    state.rules.stepSize = '1'
    await assert.rejects(client.createLimitOrder(limit({ amountInUSD: 1, maxSpreadPercent: 1 })), /quantity/)
    state.rules = { ...rules(), minNotional: '20' }
    await assert.rejects(client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 10, maxSpreadPercent: 1 }), /notional/)
    state.rules = { ...rules(), tradability: 'NONE' }
    await assert.rejects(client.createLimitOrder(limit({ maxSpreadPercent: 1 })), /does not allow/)
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 0)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 0)
  })

  check('market BUY uses notional and both sides share one spread quote with sizing', async ({ client, calls, state }) => {
    state.rules.fractionable = false
    state.rules.fractionableEh = false
    await client.createMarketOrder({ symbol: 'aapl', amountInUSD: 10 })
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 1)
    await client.createMarketOrder({ symbol: 'aapl', side: 'SELL', amountInUSD: 10, walletType: 'CARD' })
    const orders = calls.filter(call => call.path.endsWith('/place'))
    assert.equal(orders[0].payload.notional, '10')
    assert.equal(orders[0].payload.quantity, undefined)
    assert.equal(orders[1].payload.quantity, '3.333')
    assert.equal(orders[1].payload.notional, undefined)
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 2)
    for (const order of orders) {
      for (const field of ['price', 'entryPrice', 'amountInUSD', 'tradingSession']) assert.equal(order.payload[field], undefined)
    }
  })

  check('rejects invalid sizing and never rounds up to a minimum', async ({ client, calls, state }) => {
    for (const value of ['10', 0, -1, NaN, Infinity, null, true, undefined]) {
      await assert.rejects(client.createLimitOrder(limit({ amountInUSD: value })), /amountInUSD/)
      await assert.rejects(client.createMarketOrder({ symbol: 'AAPL', amountInUSD: value }), /amountInUSD/)
    }
    for (const entryPrice of [0, '0', -1, NaN, '1.001', '1.000', '1e2', null]) {
      await assert.rejects(client.createLimitOrder(limit({ entryPrice })))
    }
    state.rules.stepSize = '1'
    state.rules.minQty = '1'
    await assert.rejects(client.createLimitOrder(limit({ amountInUSD: 1 })), /quantity/)
    state.rules.minNotional = '10'
    await assert.rejects(client.createLimitOrder(limit()), /notional/)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 0)
  })

  check('validates every order combination and rejects forbidden/unknown fields', async ({ client, calls }) => {
    for (const params of [
      direct({ quantity: undefined }), direct({ price: undefined }), direct({ tradingSession: undefined }),
      direct({ notional: 10 }), direct({ quantity: '1.0001' }), direct({ amountInUSD: 10 }), direct({ entryPrice: 3 }),
      direct({ quoteAsset: 'USDT' }), direct({ tokenize: 'false' }), direct({ side: 'SELL', walletType: 'MAIN' }),
      direct({ side: null }), direct({ timeInForce: null }), direct({ quoteAsset: null }),
      direct({ walletType: 'SPOT' }), direct({ symbol: ' ' }), direct({ fee: '1' }),
      { symbol: 'AAPL', orderType: 'MARKET', quantity: '1' },
      { symbol: 'AAPL', orderType: 'MARKET', notional: '3', price: '3' },
      { symbol: 'AAPL', orderType: 'MARKET', notional: '3', tradingSession: 'RTH' },
      { symbol: 'AAPL', orderType: 'MARKET', notional: '3', timeInForce: 'GTC' },
      { symbol: 'AAPL', orderType: 'MARKET', side: 'SELL', notional: '3' }
    ]) await assert.rejects(client.placeOrder(params))
    for (const field of ['price', 'entryPrice', 'tradingSession', 'quantity', 'notional']) {
      await assert.rejects(client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 10, [field]: '1' }))
    }
    await assert.rejects(client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 10, timeInForce: 'GTC' }))
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 0)
    await client.placeOrder(direct({ side: 'SELL', price: 3, quantity: 2 }))
    await client.placeOrder({ symbol: 'aapl', orderType: 'MARKET', notional: 10 })
    await client.placeOrder({ symbol: 'aapl', orderType: 'MARKET', side: 'SELL', quantity: 2 })
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 3)
  })

  check('enforces symbol directions, bounds and requested session support', async ({ client, state }) => {
    for (const extra of [{ tradability: 'NONE' }, { tradability: 'SELL' }, { stepSize: '0' },
      { maxQty: '0.1' }, { minNotional: '20' }, { maxNotional: '1' }, { minQty: '9', maxQty: '1' },
      { minQty: undefined }, { symbol: 'MSFT' }, { tradability: 'UNKNOWN' }]) {
      state.rules = { ...rules(), ...extra }
      await assert.rejects(client.createLimitOrder(limit()))
    }
    state.rules = rules()
    await assert.rejects(client.createLimitOrder(limit({ tradingSession: 'CLOSED' })))
    await assert.rejects(client.createLimitOrder(limit({ timeInForce: 'GTC' })), /fractional GTC/)
    for (const session of ['RTH', 'EXTENDED', '24H']) {
      await client.createLimitOrder(limit({ tradingSession: session }))
    }
    await client.createLimitOrder(limit({ tradingSession: '24H', timeInForce: 'GTC' }))
    for (const [session, flag] of [['RTH', 'fractionable'], ['EXTENDED', 'fractionableEh'],
      ['EXTENDED', 'extendedSession'], ['24H', 'overnightSupported']]) {
      state.rules = { ...rules(), [flag]: false }
      await assert.rejects(client.createLimitOrder(limit({ tradingSession: session })), new RegExp(flag))
      state.rules[flag] = undefined
      await assert.rejects(client.createLimitOrder(limit({ tradingSession: session })), new RegExp(flag))
    }
  })

  check('generates unique UUIDs, preserves supplied IDs and raw failed acknowledgements', async ({ client, calls, state }) => {
    const id = 'client_1234567890123456789012345678'
    await client.placeOrder(direct({ clientOrderId: id }))
    await client.placeOrder(direct())
    state.placement = { status: 'F', reason: 'declined', optional: null }
    assert.deepEqual(await client.placeOrder(direct()), state.placement)
    const ids = calls.filter(call => call.path.endsWith('/place')).map(call => call.payload.clientOrderId)
    assert.equal(ids[0], id)
    assert.match(ids[1], /^[a-f0-9-]{36}$/)
    assert.notEqual(ids[1], ids[2])
    for (const invalid of ['short', 'x'.repeat(37), ' '.repeat(32)]) {
      await assert.rejects(client.placeOrder(direct({ clientOrderId: invalid })), /clientOrderId/)
    }
  })

  check('retains identifiers and error identity without retrying uncertain writes', async ({ client, calls, state, errors }) => {
    const failure = new TypeError('transport disconnected')
    state.handler = call => { if (call.path.endsWith('/place')) throw failure }
    await assert.rejects(client.placeOrder(direct()), error => error === failure)
    assert.match(failure.clientOrderId, /^[a-f0-9-]{36}$/)
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 1)
    assert.equal(errors[0], failure)
    state.handler = call => call.path.endsWith('/cancel') ? { httpStatus: 500, rawBody: 'unknown outcome' } : undefined
    await assert.rejects(client.cancelOrder({ orderId: 'order-2' }), error => error.orderId === 'order-2' && /500/.test(error.message))
    assert.equal(calls.filter(call => call.path.endsWith('/cancel')).length, 1)
    state.handler = call => call.path.endsWith('/place') ? { rawBody: '{bad JSON' } : undefined
    await assert.rejects(client.placeOrder(direct()), error => error instanceof SyntaxError && !!error.clientOrderId)
    state.handler = call => call.path.endsWith('/place') ? { status: 'S' } : undefined
    await assert.rejects(client.placeOrder(direct()), error => /invalid response/.test(error.message) && !!error.clientOrderId)
  })

  check('sells all wallet positions sequentially with exact full quantities and placement defaults', async ({ client, calls, state }) => {
    state.trades = page([
      fill(1, { qty: '1.234567890123456789' }),
      fill(2, { symbol: 'NVDA', qty: '3' }),
      fill(3, { symbol: 'NVDA', side: 'SELL', qty: '0.9' }),
      fill(4, { symbol: 'MSFT', qty: '1' }),
      fill(5, { symbol: 'MSFT', side: 'SELL', qty: '1' })
    ])
    state.handler = call => call.path.endsWith('/exchangeInfo')
      ? { symbols: ['AAPL', 'NVDA'].map(symbol => ({ ...rules(), symbol, stepSize: '0.000000000000000001' })) }
      : undefined

    assert.deepEqual(await client.sellPositions(null), [
      { symbol: 'AAPL', quantity: '1.234567890123456789', ack: state.placement },
      { symbol: 'NVDA', quantity: '2.1', ack: state.placement }
    ])
    assert.deepEqual(calls.map(call => call.path.replace('/sapi/v1/equity/', '')), [
      'trade/history', 'market/exchangeInfo', 'market/quote', 'order/place', 'market/exchangeInfo', 'market/quote', 'order/place'
    ])
    const orders = calls.filter(call => call.path.endsWith('/place'))
    for (const { payload } of orders) {
      assert.equal(payload.side, 'SELL')
      assert.equal(payload.orderType, 'MARKET')
      assert.equal(payload.timeInForce, 'DAY')
      assert.equal(payload.quoteAsset, 'USDC')
      for (const field of ['price', 'notional', 'tradingSession', 'amountInUSD']) {
        assert.equal(payload[field], undefined)
      }
    }
    assert.deepEqual(orders.map(call => [call.payload.symbol, call.payload.quantity]), [
      ['AAPL', '1.234567890123456789'], ['NVDA', '2.1']
    ])
    assert.notEqual(orders[0].payload.clientOrderId, orders[1].payload.clientOrderId)
  })

  check('sells only selected symbols, normalizes duplicates and reports missing positions', async ({ client, calls, state }) => {
    state.trades = page([fill(1, { qty: '1' }), fill(2, { symbol: 'NVDA', qty: '2' })])
    state.rules = { ...rules(), symbol: 'NVDA' }
    const selection = Object.freeze([
      Object.freeze({ symbol: ' nvda ' }), Object.freeze({ symbol: ' msft ' }), Object.freeze({ symbol: 'NVDA' })
    ])
    assert.deepEqual(await client.sellPositions(selection), [
      { symbol: 'NVDA', quantity: '2', ack: state.placement },
      { symbol: 'MSFT', skipped: 'NO_POSITION' }
    ])
    assert.deepEqual(calls.filter(call => call.path.endsWith('/place')).map(call => call.payload.symbol), ['NVDA'])
    assert.equal(calls.filter(call => call.path.endsWith('/trade/history')).length, 1)
    assert.equal(calls[0].payload.symbol, undefined)
  })

  check('validates the whole position selection before any API calls', async ({ client, calls }) => {
    await assert.rejects(client.sellPositions(), TypeError)
    for (const input of [undefined, {}, 'AAPL', false, 0, new Set(['AAPL']), new Array(1)]) {
      await assert.rejects(client.sellPositions(input), TypeError)
    }
    for (const entry of [null, undefined, [], 'AAPL', {}, { symbol: '' }, { symbol: ' ' },
      { symbol: null }, { symbol: 1 }, { symbol: 'AAPL', quantity: '1' }]) {
      await assert.rejects(client.sellPositions([{ symbol: 'AAPL' }, entry]), TypeError)
    }
    assert.equal(calls.length, 0)
  })

  check('handles empty selections and wallets without placing orders', async ({ client, calls }) => {
    assert.deepEqual(await client.sellPositions([]), [])
    assert.equal(calls.length, 0)
    assert.deepEqual(await client.sellPositions(null), [])
    assert.deepEqual(await client.sellPositions([{ symbol: 'AAPL' }]), [{ symbol: 'AAPL', skipped: 'NO_POSITION' }])
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.path.endsWith('/trade/history')))
  })

  check('does not sell partial holdings when a later wallet page fails', async ({ client, calls, state }) => {
    const rows = Array.from({ length: 100 }, (_, i) => fill(i))
    state.handler = call => call.payload.current === '1'
      ? page(rows, 1, 101) : { httpStatus: 500, rawBody: 'history unavailable' }
    await assert.rejects(client.sellPositions(null), /500/)
    assert.equal(calls.length, 2)
    assert.ok(calls.every(call => call.path.endsWith('/trade/history')))
    assert.equal(calls[0].payload.endTime, calls[1].payload.endTime)
  })

  check('collects invalid sizes, failed acknowledgements and uncertain writes while continuing once per symbol', async ({ client, calls, state, errors }) => {
    const symbols = ['AAPL', 'MSFT', 'NVDA', 'VOO']
    const failure = new TypeError('transport disconnected')
    const declined = { status: 'F', reason: 'declined', extra: null }
    state.trades = page(symbols.map((symbol, i) => fill(i, { symbol, qty: i === 0 ? '0.0011' : '2' })))
    state.handler = call => {
      if (call.path.endsWith('/exchangeInfo')) return { symbols: symbols.map(symbol => ({ ...rules(), symbol })) }
      if (call.path.endsWith('/place')) {
        if (call.payload.symbol === 'MSFT') return declined
        if (call.payload.symbol === 'NVDA') throw failure
      }
    }
    const results = await client.sellPositions(null)
    assert.equal(results.length, 4)
    assert.equal(results[0].symbol, 'AAPL')
    assert.equal(results[0].quantity, '0.0011')
    assert.ok(results[0].error instanceof RangeError)
    assert.match(results[0].error.message, /stepSize/)
    assert.deepEqual(results[1], { symbol: 'MSFT', quantity: '2', ack: declined })
    assert.deepEqual(results[2], { symbol: 'NVDA', quantity: '2', error: failure })
    assert.equal(results[2].error, failure)
    assert.equal(errors[0], failure)
    assert.deepEqual(results[3], { symbol: 'VOO', quantity: '2', ack: state.placement })
    const orders = calls.filter(call => call.path.endsWith('/place'))
    assert.deepEqual(orders.map(call => call.payload.symbol), ['MSFT', 'NVDA', 'VOO'])
    assert.equal(failure.clientOrderId, orders[1].payload.clientOrderId)
    assert.match(failure.clientOrderId, /^[a-f0-9-]{36}$/)
    assert.ok(calls.every(call => ['history', 'exchangeInfo', 'quote', 'place'].includes(call.path.split('/').at(-1))))
  })

  check('history fetches one requested page with filters and no placement defaults', async ({ client, calls, state }) => {
    state.trades = { total: 50, page: 2, size: 20, rows: [fill(1), fill(2, { qty: '1.234500' })], extra: null }
    assert.deepEqual(await client.getTradeHistory({ startTime: 0, endTime: 9, current: 2, symbol: ' aapl ', orderId: 'order' }), state.trades)
    const payload = calls.at(-1).payload
    assert.equal(payload.symbol, 'AAPL')
    assert.equal(payload.current, '2')
    assert.equal(payload.size, '20')
    assert.equal(payload.side, undefined)
    assert.equal(payload.page, undefined)
    assert.equal(calls.length, 1)
    await client.getOrderHistory({ startTime: 0, endTime: 9, orderStatus: 'FILLED,CANCELED', orderType: 'LIMIT' })
    assert.equal(calls.at(-1).payload.side, undefined)
    for (const options of [{}, { startTime: 2, endTime: 1 }, { startTime: -1, endTime: 1 },
      { startTime: 0, endTime: Infinity }, { startTime: 0, endTime: 1, size: 101 },
      { startTime: 0, endTime: 1, current: 0 }, { startTime: 0.1, endTime: 1 }]) {
      await assert.rejects(client.getOrderHistory(options))
      await assert.rejects(client.getTradeHistory(options))
    }
    await assert.rejects(client.getOrderHistory({ startTime: 0, endTime: 1, orderStatus: 'OPEN' }))
    await assert.rejects(client.getOrder({}))
    await assert.rejects(client.getOrder({ orderId: ' ' }))
    await assert.rejects(client.getOpenOrders({ symbol: 'AAPL' }))
    await assert.rejects(client.cancelAllOrders({ symbol: 'AAPL' }))
    await assert.rejects(client.cancelOrder({ clientOrderId: 'x' }))
  })

  check('signs only TRADE/USER_DATA, always sends API key and preserves recvWindow', async ({ client, calls }) => {
    await client.getQuote('AAPL')
    await client.getSymbolInfo('AAPL')
    await client.apiClient('listenKey', {})
    await client.getOpenOrders({ recvWindow: 60000 })
    await client.cancelAllOrders()
    for (const call of calls) assert.equal(call.headers['X-MBX-APIKEY'], 'dummy-key')
    for (const call of calls.slice(0, 2)) {
      for (const field of ['timestamp', 'recvWindow', 'signature']) assert.equal(call.payload[field], undefined)
    }
    assert.ok(Number.isSafeInteger(Number(calls[2].payload.timestamp)))
    assert.equal(calls[2].payload.recvWindow, '5000')
    assert.equal(calls[2].payload.signature, undefined)
    assert.equal(calls[3].payload.recvWindow, '60000')
    assert.equal(calls[4].payload.recvWindow, '5000')
    for (const call of calls.slice(3)) {
      const { signature, ...params } = call.payload
      assert.ok(Number.isSafeInteger(Number(params.timestamp)))
      const encoded = Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
      assert.equal(signature, createHmac('sha256', 'dummy-secret').update(encoded).digest('hex'))
    }
    const before = Date.now()
    await client.apiClient('listenKey', { timestamp: 1, recvWindow: 60000 })
    const stream = calls.at(-1)
    assert.ok(Number(stream.payload.timestamp) >= before && Number(stream.payload.timestamp) <= Date.now())
    assert.equal(stream.payload.recvWindow, '60000')
    assert.equal(stream.payload.signature, undefined)
    for (const recvWindow of [0, 60001, 1.5, '5000', null, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(client.getOpenOrders({ recvWindow }), /recvWindow/)
      await assert.rejects(client.apiClient('listenKey', { recvWindow }), /recvWindow/)
    }
    const count = calls.length
    await assert.rejects(client.apiClient('openOrders', { recvWindow: -1 }))
    assert.equal(calls.length, count)
  })

  check('wallet scans complete fixed sequential pages and tolerates sell-first traversal', async ({ client, calls, state }) => {
    const rows = Array.from({ length: 100 }, (_, i) => fill(i))
    rows[0] = fill(0, { side: 'SELL', qty: '2' })
    rows[1] = fill(1, { qty: '3' })
    state.handler = call => call.path.endsWith('/trade/history')
      ? page(call.payload.current === '1' ? rows : [fill(100, { qty: '0.02' })], Number(call.payload.current), 101)
      : undefined
    assert.deepEqual(await client.getEquityWallet({ startTime: 0, endTime: 100, recvWindow: 10000 }), { AAPL: { amount: '2' } })
    assert.deepEqual(calls.map(call => call.payload.current), ['1', '2'])
    assert.ok(calls.every(call => call.payload.endTime === '100' && call.payload.recvWindow === '10000' && call.payload.size === '100'))
    assert.ok(calls.every(call => call.payload.side === undefined && call.payload.symbol === undefined))
  })

  check('duplicate fills cannot hide incomplete history from wallet, portfolio or sellPositions', async ({ client, calls, state }) => {
    const rows = Array.from({ length: 100 }, (_, i) => fill(i, { qty: '1' }))
    const overlappingPage = [rows[99], fill(100, { qty: '1' })]
    for (const paginated of [false, true]) {
      state.handler = call => call.path.endsWith('/trade/history')
        ? paginated
          ? page(call.payload.current === '1' ? rows : overlappingPage, Number(call.payload.current), 102)
          : page([rows[0], rows[0]])
        : undefined
      for (const [method, input] of [['getEquityWallet'], ['getPortfolio'], ['sellPositions', null]]) {
        const before = calls.length
        await assert.rejects(client[method](input), /distinct execution count/)
        const requests = calls.slice(before)
        assert.equal(requests.length, paginated ? 2 : 1)
        assert.ok(requests.every(call => call.path.endsWith('/trade/history')))
      }
    }
  })

  check('wallet rejects incomplete, repeated, conflicting or malformed histories', async ({ client, state }) => {
    const rows = Array.from({ length: 100 }, (_, i) => fill(i))
    for (const second of [
      page([], 2, 101), page([fill(100)], 1, 101), page([fill(100)], 2, 102),
      page([rows[0]], 2, 101), page([fill(0, { qty: '9' })], 2, 101),
      { ...page([fill(100)], 2, 101), size: 20 }
    ]) {
      state.handler = call => call.path.endsWith('/trade/history')
        ? call.payload.current === '1' ? page(rows, 1, 101) : second : undefined
      await assert.rejects(client.getEquityWallet())
    }
    state.handler = undefined
    for (const row of [fill(0, { executionId: '' }), fill(0, { side: 'BAD' }), fill(0, { qty: 1 }),
      fill(0, { qty: '0' }), fill(0, { symbol: '' }), fill(0, { quote: 'USDT' })]) {
      state.trades = page([row])
      await assert.rejects(client.getEquityWallet())
    }
    state.trades = page([fill(0, { side: 'SELL', qty: '1' })])
    await assert.rejects(client.getEquityWallet(), /selected trade window cannot establish a nonnegative holding estimate/)
    state.trades = page([fill(0), fill(1, { side: 'SELL' })])
    assert.deepEqual(await client.getEquityWallet(), {})
    state.handler = call => call.path.endsWith('/trade/history')
      ? call.payload.current === '1' ? page(rows, 1, 101) : { httpStatus: 429, rawBody: 'rate limit' } : undefined
    await assert.rejects(client.getEquityWallet(), /429/)
  })

  check('funding uses its POST route and exact free plus locked balance', async ({ client, calls, state }) => {
    state.funding = [{ asset: 'BTC', free: '1' }, { asset: 'USDC', free: '0.1', locked: '0.2', freeze: '9', withdrawing: '8' }]
    assert.deepEqual(await client.getFundingWallet({ recvWindow: 9999 }),
      { USDC: { free: '0.1', locked: '0.2', freeze: '9', withdrawing: '8', amount: '0.3' } })
    assert.equal(calls[0].path, '/sapi/v1/asset/get-funding-asset')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].payload.asset, 'USDC')
    assert.equal(calls[0].payload.recvWindow, '9999')
    state.funding = []
    assert.deepEqual(await client.getFundingWallet(), { USDC: { free: '0', locked: '0', freeze: '0', withdrawing: '0', amount: '0' } })
    for (const response of [{}, [null], [{ asset: 'USDC', free: '1' }],
      [{ asset: 'USDC', free: '-1', locked: '0', freeze: '0', withdrawing: '0' }],
      [{ asset: 'USDC', free: '1', locked: 0, freeze: '0', withdrawing: '0' }],
      [{ asset: 'USDC' }, { asset: 'USDC' }]]) {
      state.funding = response
      await assert.rejects(client.getFundingWallet())
    }
  })

  check('portfolio computes exact values, four-place weights and all-cash/empty reports', async ({ client, state, calls }) => {
    state.trades = page([fill(0, { qty: '3', symbol: 'NVDA' })])
    state.quote = { bidPrice: '300' }
    state.funding = [{ asset: 'USDC', free: '5900', locked: '5', freeze: '0', withdrawing: '0' }]
    assert.deepEqual(await client.getPortfolio({ startTime: 1, endTime: 5, recvWindow: 20000 }), {
      totals: { totalUsd: 6805, positionsUsd: 900, cashUsd: 5905 },
      cash: { USDC: { amount: 5905, quote: 1, usd: 5905, weight: 0.8677 } },
      positions: { NVDA: { amount: 3, quote: 300, usd: 900, weight: 0.1323 } }
    })
    assert.equal(calls.filter(call => call.path.endsWith('/quote')).length, 1)
    assert.equal(calls[0].payload.startTime, '1')
    assert.equal(calls[1].payload.recvWindow, '20000')
    state.trades = page([])
    const cashOnly = await client.getPortfolio()
    assert.equal(cashOnly.cash.USDC.weight, 1)
    assert.deepEqual(cashOnly.positions, {})
    state.funding = []
    assert.deepEqual(await client.getPortfolio(), {
      totals: { totalUsd: 0, positionsUsd: 0, cashUsd: 0 },
      cash: { USDC: { amount: 0, quote: 1, usd: 0, weight: null } }, positions: {}
    })
    state.trades = page([fill(0, { qty: '1' })])
    state.quote = { bidPrice: '1' }
    state.funding = [{ asset: 'USDC', free: '19999', locked: '0', freeze: '0', withdrawing: '0' }]
    assert.equal((await client.getPortfolio()).positions.AAPL.weight, 0.0001)
  })

  check('missing successful bids null all weights; request failures propagate', async ({ client, state }) => {
    state.trades = page([fill(0, { qty: '1' }), fill(1, { symbol: 'MSFT', qty: '2' })])
    state.funding = [{ asset: 'USDC', free: '10', locked: '0', freeze: '0', withdrawing: '0' }]
    for (const quote of [null, {}, { bidPrice: '0' }, { bidPrice: '-1' }, { bidPrice: 'bad' }]) {
      state.handler = call => call.path.endsWith('/quote') && call.payload.symbol === 'AAPL' ? quote : undefined
      const report = await client.getPortfolio()
      assert.deepEqual(report.totals, { totalUsd: null, positionsUsd: null, cashUsd: 10 })
      assert.deepEqual(report.positions.AAPL, { amount: 1, quote: null, usd: null, weight: null })
      assert.deepEqual(report.positions.MSFT, { amount: 2, quote: 3, usd: 6, weight: null })
      assert.equal(report.cash.USDC.weight, null)
      await assert.rejects(client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 10, side: 'SELL' }), /bidPrice/)
    }
    state.handler = call => call.path.endsWith('/quote') ? { httpStatus: 503, rawBody: 'unavailable' } : undefined
    await assert.rejects(client.getPortfolio(), /503/)
    state.handler = call => call.path.endsWith('/quote') ? { bidPrice: '1' + '0'.repeat(310) } : undefined
    await assert.rejects(client.getPortfolio(), /representable numeric range/)
  })

  check('mismatched quote symbols block market SELLs and leave portfolio positions unpriced', async ({ client, state, calls }) => {
    state.trades = page([fill(0, { qty: '1' }), fill(1, { symbol: 'MSFT', qty: '2' })])
    state.funding = [{ asset: 'USDC', free: '10', locked: '0', freeze: '0', withdrawing: '0' }]
    for (const symbol of ['MSFT', '', null, 123]) {
      state.handler = call => call.path.endsWith('/quote') && call.payload.symbol === 'AAPL'
        ? { symbol, bidPrice: '10' } : undefined
      await assert.rejects(client.createMarketOrder({ symbol: 'AAPL', side: 'SELL', amountInUSD: 100 }), /symbol/)
      const report = await client.getPortfolio()
      assert.deepEqual(report.totals, { totalUsd: null, positionsUsd: null, cashUsd: 10 })
      assert.deepEqual(report.positions.AAPL, { amount: 1, quote: null, usd: null, weight: null })
      assert.deepEqual(report.positions.MSFT, { amount: 2, quote: 3, usd: 6, weight: null })
      assert.equal(report.cash.USDC.weight, null)
    }
    assert.equal(calls.filter(call => call.path.endsWith('/place')).length, 0)
    state.handler = call => call.path.endsWith('/quote') && call.payload.symbol === 'AAPL'
      ? { symbol: ' aapl ', bidPrice: '10', askPrice: '10.01' } : undefined
    assert.deepEqual((await client.getPortfolio()).totals, { totalUsd: 26, positionsUsd: 16, cashUsd: 10 })
    await client.createMarketOrder({ symbol: 'AAPL', side: 'SELL', amountInUSD: 100 })
    const orders = calls.filter(call => call.path.endsWith('/place'))
    assert.equal(orders.length, 1)
    assert.equal(orders[0].payload.symbol, 'AAPL')
    assert.equal(orders[0].payload.quantity, '10')
  })

  check('existing quote and symbol APIs retain successful empty/raw behavior', async ({ client, state }) => {
    state.quote = null
    assert.equal(await client.getQuote('AAPL'), null)
    assert.deepEqual(await client.getSymbolInfo('AAPL'), rules())
    assert.equal(await client.getSymbolInfo('aapl'), undefined)
    state.handler = call => call.path.endsWith('/quote') ? { rawBody: '' } : undefined
    assert.equal(await client.getQuote('AAPL'), null)
  })
}

test('decimal sizing retains tiny and scientific numeric inputs without binary division', () => {
  assert.equal(new Decimal(1e-7).toString(), '0.0000001')
  assert.equal(new Decimal(1e21).toString(), '1000000000000000000000')
  assert.equal(new Decimal(0.3).divToInt(new Decimal(0.1).times('0.1')).times('0.1').toString(), '3')
})
