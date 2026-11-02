import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import NodeClient from '../src/BinanceStocksNode.js'
import GasClient from '../src/BinanceStocksGas.js'

const symbolRules = (extra = {}) => ({
  symbol: 'OKTA', tradability: 'BUY_SELL', stepSize: '0.000000001', maxQty: '1000000',
  minNotional: '5', maxNotional: '1000000', fractionable: true, fractionableEh: true,
  extendedSession: true, overnightSupported: true, ...extra
})

const harness = (t, Client) => {
  const calls = []
  const errors = []
  const state = {
    exchange: { timezone: 'America/New_York', symbols: [symbolRules()], metadata: { sessions: ['RTH'] } },
    quote: { symbol: 'OKTA', bidPrice: '10', askPrice: '10.01' }
  }
  const original = { fetch: globalThis.fetch, UrlFetchApp: globalThis.UrlFetchApp, Utilities: globalThis.Utilities }
  const request = (url, options) => {
    const parsed = new URL(url)
    const call = {
      endpoint: parsed.pathname.split('/').at(-1), method: options.method.toUpperCase(),
      payload: Object.fromEntries(new URLSearchParams(options.body ?? options.payload ?? parsed.search))
    }
    calls.push(call)
    switch (call.endpoint) {
      case 'exchangeInfo':
        if (state.exchangeError) throw state.exchangeError
        return JSON.stringify(state.exchange)
      case 'quote': return JSON.stringify(state.quote)
      case 'place': return JSON.stringify({ status: 'S', orderId: 'mock-order', clientOrderId: call.payload.clientOrderId })
      default: throw new Error(`Unmocked endpoint ${call.endpoint}`)
    }
  }
  globalThis.fetch = async (url, options) => {
    const body = request(url, options)
    return { status: 200, text: async () => body }
  }
  globalThis.UrlFetchApp = { fetch: (url, options) => {
    const body = request(url, options)
    return { getResponseCode: () => 200, getContentText: () => body }
  } }
  globalThis.Utilities = {
    getUuid: () => randomUUID(),
    computeHmacSha256Signature: (text, secret) => [...createHmac('sha256', secret).update(text).digest()]
  }
  t.after(() => Object.assign(globalThis, original))
  const makeClient = () => new Client({
    API_KEY: 'dummy-key', API_SECRET: 'dummy-secret', baseUrl: 'https://offline.invalid',
    errorLogger: error => errors.push(error)
  })
  return { client: makeClient(), makeClient, state, calls, errors }
}

for (const Client of [NodeClient, GasClient]) {
  const runtime = Client === NodeClient ? 'Node' : 'GAS'

  test(`${runtime}: concurrent exchange and symbol reads share one immutable cached response`, async t => {
    const { client, calls } = harness(t, Client)
    const [first, row, second, missing] = await Promise.all([
      client.getExchangeInfo(), client.getSymbolInfo('OKTA'), client.getExchangeInfo(), client.getSymbolInfo('okta')
    ])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].endpoint, 'exchangeInfo')
    assert.equal(first, second)
    assert.equal(row, first.symbols[0])
    assert.equal(missing, undefined)
    for (const value of [first, first.symbols, row, first.metadata, first.metadata.sessions]) {
      assert.ok(Object.isFrozen(value))
    }
    assert.throws(() => { row.stepSize = '1' }, TypeError)
    assert.throws(() => { row.tradability = 'NONE' }, TypeError)
    assert.throws(() => { first.symbols.push(symbolRules({ symbol: 'FAKE' })) }, TypeError)
    assert.throws(() => { first.metadata.sessions[0] = '24H' }, TypeError)
    assert.equal((await client.getSymbolInfo('OKTA')).stepSize, '0.000000001')
    assert.equal(await client.getSymbolInfo('FAKE'), undefined)
    assert.equal(calls.length, 1)
  })

  test(`${runtime}: exchange caches stay isolated and a new client loads changed rules`, async t => {
    const { client, makeClient, state, calls } = harness(t, Client)
    const original = await client.getExchangeInfo()
    state.exchange.symbols = [symbolRules({ stepSize: '0.1', tradability: 'NONE' })]
    state.exchange.metadata.sessions.push('24H')
    assert.equal(await client.getExchangeInfo(), original)
    assert.equal((await client.getSymbolInfo('OKTA')).stepSize, '0.000000001')
    assert.deepEqual(original.metadata.sessions, ['RTH'])
    const updated = await makeClient().getExchangeInfo()
    assert.notEqual(updated, original)
    assert.equal(updated.symbols[0].stepSize, '0.1')
    assert.equal(updated.symbols[0].tradability, 'NONE')
    assert.deepEqual(updated.metadata.sessions, ['RTH', '24H'])
    assert.equal(calls.length, 2)
  })

  test(`${runtime}: concurrent failed exchange reads preserve the error and a later call retries`, async t => {
    const { client, state, calls, errors } = harness(t, Client)
    const failure = new Error('mock exchange transport failure')
    state.exchangeError = failure
    const failed = await Promise.allSettled([client.getExchangeInfo(), client.getSymbolInfo('OKTA')])
    for (const result of failed) {
      assert.equal(result.status, 'rejected')
      assert.equal(result.reason, failure)
    }
    assert.equal(calls.length, 1)
    assert.deepEqual(errors, [failure])
    delete state.exchangeError
    const [exchange, row] = await Promise.all([client.getExchangeInfo(), client.getSymbolInfo('OKTA')])
    assert.equal(row, exchange.symbols[0])
    assert.equal(calls.length, 2)
    assert.equal(await client.getExchangeInfo(), exchange)
    assert.equal(calls.length, 2)
  })

  test(`${runtime}: placements reuse cached rules, fetch fresh quotes, and preserve buffered, whole and exact intents`, async t => {
    const { client, state, calls } = harness(t, Client)
    await client.getExchangeInfo()
    state.exchange.symbols = [symbolRules({ stepSize: '1', tradability: 'NONE' })]
    const base = { symbol: 'OKTA', side: 'SELL' }
    const quantity = '27.44440023'
    let intent
    const operations = [
      ['placeOrder', { ...base, orderType: 'MARKET', quantity,
        beforeSubmit: order => { intent = order } }, '27.44440022'],
      ['placeOrder', { ...base, orderType: 'LIMIT', quantity, price: '10', tradingSession: 'RTH' }, '27.44440022'],
      ['createLimitOrder', { ...base, amountInUSD: 300, entryPrice: '10', tradingSession: 'RTH', maxSellQuantity: quantity }, '27.44440022'],
      ['createMarketOrder', { ...base, amountInUSD: 300, maxSellQuantity: quantity }, '27.44440022'],
      ['placeOrder', { ...base, orderType: 'MARKET', quantity: '3' }, '3'],
      ['placeOrder', { ...base, orderType: 'MARKET', quantity: '3.0000000001' }, '3']
    ]
    for (const [method, options, expected] of operations) {
      const start = calls.length
      await client[method](options)
      assert.deepEqual(calls.slice(start).map(call => call.endpoint), ['quote', 'place'])
      assert.equal(calls.at(-1).payload.quantity, expected)
    }
    assert.ok(Object.isFrozen(intent))
    assert.equal(intent.quantityMode, 'EXACT')
    const start = calls.length
    await client.placeOrder(intent)
    assert.deepEqual(calls.slice(start).map(call => call.endpoint), ['quote', 'place'])
    assert.equal(calls.at(-1).payload.quantity, '27.44440022')
    assert.equal(calls.at(-1).payload.clientOrderId, intent.clientOrderId)
    state.quote = { symbol: 'OKTA', bidPrice: '20', askPrice: '20.01' }
    await client.createMarketOrder({ ...base, amountInUSD: 30 })
    assert.equal(calls.at(-1).payload.quantity, '1.5')
    const beforeReject = calls.length
    await assert.rejects(client.placeOrder({ ...intent, quantity: '27.4444002201' }), /exact stepSize increment/)
    assert.equal(calls.length, beforeReject)
    assert.equal(calls.filter(call => call.endpoint === 'exchangeInfo').length, 1)
    for (const call of calls.filter(call => call.endpoint === 'place')) {
      for (const field of ['bufferSteps', 'maxSellQuantity', 'quantityMode', 'estimatedExitBuffer', 'beforeSubmit', 'amountInUSD']) {
        assert.equal(call.payload[field], undefined)
      }
    }
  })

  test(`${runtime}: a callback failure prevents submission while retaining the cached rules and original error`, async t => {
    const { client, calls, errors } = harness(t, Client)
    const cached = await client.getExchangeInfo()
    const failure = new Error('mock persistence failed')
    let finalOrder
    await assert.rejects(client.placeOrder({
      symbol: 'OKTA', side: 'SELL', orderType: 'MARKET', quantity: '27.44440023',
      beforeSubmit: order => { finalOrder = order; throw failure }
    }), error => error === failure)
    assert.equal(failure.clientOrderId, finalOrder.clientOrderId)
    assert.equal(finalOrder.quantity, '27.44440022')
    assert.equal(finalOrder.quantityMode, 'EXACT')
    assert.deepEqual(calls.map(call => call.endpoint), ['exchangeInfo', 'quote'])
    assert.deepEqual(errors, [failure])
    assert.equal(await client.getExchangeInfo(), cached)
    assert.equal(calls.length, 2)
  })
}
