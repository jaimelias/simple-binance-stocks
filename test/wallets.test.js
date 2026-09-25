import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import BinanceStocks, { ResponseError } from '../index.js'

const NOW = 1800000000000
const API_KEY = 'wallet-test-key'
const API_SECRET = 'wallet-test-secret'
const buys = Array.from({ length: 100 }, (_, index) => ({
  executionId: `buy-${index}`, symbol: 'NVDA', side: 'BUY', qty: '0.01'
}))
const sell = { executionId: 'sell-1', symbol: 'NVDA', side: 'SELL', qty: '0.25' }

function http(body, status = 200) {
  return { status, headers: {}, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }
}

function clientWith(responder) {
  const calls = []
  const client = new BinanceStocks({
    apiKey: API_KEY, apiSecret: API_SECRET, now: () => NOW,
    fetch: async (url, init) => {
      const parsed = new URL(url)
      const call = { path: parsed.pathname, query: parsed.searchParams, init, url }
      calls.push(call)
      return responder(call)
    }
  })
  return { client, calls }
}

function historyPage(call) {
  assert.equal(call.query.get('startTime'), '0')
  assert.equal(call.query.get('endTime'), String(NOW))
  assert.equal(call.query.get('size'), '100')
  const current = Number(call.query.get('current'))
  return http({ total: 101, page: current, size: 100, rows: current === 1 ? buys : [sell] })
}

test('equity wallet aggregates every fill page with exact decimal shares', async () => {
  const { client, calls } = clientWith(call => {
    assert.equal(call.path, '/sapi/v1/equity/trade/history')
    return historyPage(call)
  })
  assert.deepEqual(await client.getEquityWallet(), { NVDA: { amount: '0.75' } })
  assert.deepEqual(calls.map(call => call.query.get('current')), ['1', '2'])
})

test('funding wallet reads signed Funding USDC and preserves balance categories', async () => {
  const { client, calls } = clientWith(call => http([
    { asset: 'USDC', free: '1000.10', locked: '0.20', freeze: '1.00', withdrawing: '0' }
  ]))
  assert.deepEqual(await client.getFundingWallet(), {
    USDC: { free: '1000.1', locked: '0.2', freeze: '1', withdrawing: '0', amount: '1000.3' }
  })
  const call = calls[0]
  assert.equal(call.path, '/sapi/v1/asset/get-funding-asset')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.headers['X-MBX-APIKEY'], API_KEY)
  assert.equal(call.query.get('asset'), 'USDC')
  const encoded = call.url.split('?')[1]
  const payload = encoded.slice(0, encoded.lastIndexOf('&signature='))
  assert.equal(call.query.get('signature'), createHmac('sha256', API_SECRET).update(payload).digest('hex'))
})

test('portfolio values trade-derived shares at fresh USD bid prices', async () => {
  const { client, calls } = clientWith(call => {
    if (call.path.endsWith('/trade/history')) return historyPage(call)
    if (call.path.endsWith('/get-funding-asset')) return http([
      { asset: 'USDC', free: '1000.10', locked: '0.20', freeze: '0', withdrawing: '0' }
    ])
    if (call.path.endsWith('/market/quote')) return http({ symbol: 'NVDA', bidPrice: '300', askPrice: '301' })
    throw new Error(`Unexpected mocked path ${call.path}`)
  })
  assert.deepEqual(await client.getPortfolio(), {
    totals: { totalUsd: 1225.3, positionsUsd: 225, cashUsd: 1000.3 },
    cash: { USDC: { amount: 1000.3, quote: 1, usd: 1000.3, weight: 0.8164 } },
    positions: { NVDA: {
      amount: 0.75, quote: 300, usd: 225, weight: 0.1836
    } }
  })
  assert.equal(calls.filter(call => call.path.endsWith('/market/quote')).length, 1)
})

test('portfolio reports cash and position totals with portfolio weights', async () => {
  const { client } = clientWith(call => {
    if (call.path.endsWith('/trade/history')) return http({
      total: 2, page: 1, size: 100, rows: [
        { executionId: 'nvda-buy', symbol: 'NVDA', side: 'BUY', qty: '2' },
        { executionId: 'aapl-buy', symbol: 'AAPL', side: 'BUY', qty: '4' }
      ]
    })
    if (call.path.endsWith('/get-funding-asset')) return http([
      { asset: 'USDC', free: '1000', locked: '0', freeze: '0', withdrawing: '0' }
    ])
    if (call.path.endsWith('/market/quote')) {
      const symbol = call.query.get('symbol')
      return http({ symbol, bidPrice: symbol === 'NVDA' ? '300' : '100' })
    }
    throw new Error(`Unexpected mocked path ${call.path}`)
  })
  assert.deepEqual(await client.getPortfolio(), {
    totals: { totalUsd: 2000, positionsUsd: 1000, cashUsd: 1000 },
    cash: { USDC: { amount: 1000, quote: 1, usd: 1000, weight: 0.5 } },
    positions: {
      AAPL: { amount: 4, quote: 100, usd: 400, weight: 0.2 },
      NVDA: { amount: 2, quote: 300, usd: 600, weight: 0.3 }
    }
  })
})

test('portfolio shows unavailable quotes without inventing a zero valuation', async () => {
  const { client } = clientWith(call => {
    if (call.path.endsWith('/trade/history')) return http({ total: 1, page: 1, size: 100, rows: [buys[0]] })
    if (call.path.endsWith('/get-funding-asset')) return http([])
    if (call.path.endsWith('/market/quote')) return http('')
    throw new Error(`Unexpected mocked path ${call.path}`)
  })
  assert.deepEqual(await client.getPortfolio(), {
    totals: { totalUsd: null, positionsUsd: null, cashUsd: 0 },
    cash: { USDC: { amount: 0, quote: 1, usd: 0, weight: null } },
    positions: { NVDA: {
      amount: 0.01, quote: null, usd: null, weight: null
    } }
  })
})

test('portfolio treats malformed or unusable bids as unavailable', async () => {
  for (const quote of [
    { symbol: 'NVDA' }, { symbol: 'NVDA', bidPrice: 'oops' },
    { symbol: 'NVDA', bidPrice: '0' }, { symbol: 'AAPL', bidPrice: '300' }
  ]) {
    const { client } = clientWith(call => {
      if (call.path.endsWith('/trade/history')) return http({ total: 1, page: 1, size: 100, rows: [buys[0]] })
      if (call.path.endsWith('/get-funding-asset')) return http([])
      if (call.path.endsWith('/market/quote')) return http(quote)
      throw new Error(`Unexpected mocked path ${call.path}`)
    })
    assert.deepEqual((await client.getPortfolio()).positions.NVDA, {
      amount: 0.01, quote: null, usd: null, weight: null
    })
  }
})

test('portfolio includes cash and empty positions when there are no equity holdings', async () => {
  const { client, calls } = clientWith(call => {
    if (call.path.endsWith('/trade/history')) return http({ total: 0, page: 1, size: 100, rows: [] })
    if (call.path.endsWith('/get-funding-asset')) return http([])
    throw new Error(`Unexpected mocked path ${call.path}`)
  })
  assert.deepEqual(await client.getPortfolio(), {
    totals: { totalUsd: 0, positionsUsd: 0, cashUsd: 0 },
    cash: { USDC: { amount: 0, quote: 1, usd: 0, weight: null } },
    positions: {}
  })
  assert.equal(calls.filter(call => call.path.endsWith('/market/quote')).length, 0)
})

test('funding wallet rejects malformed filtered responses', async () => {
  for (const response of [[{}], [null], [{ asset: 'BTC', free: '1' }], [
    { asset: 'USDC', free: '1', locked: '0', freeze: '0', withdrawing: '0' },
    { asset: 'USDC', free: '2', locked: '0', freeze: '0', withdrawing: '0' }
  ]]) {
    const { client } = clientWith(() => http(response))
    await assert.rejects(() => client.getFundingWallet(), ResponseError)
  }
})

test('equity wallet rejects incomplete pages and negative reconstructed shares', async () => {
  const incomplete = clientWith(call => http({
    total: 2, page: Number(call.query.get('current')), size: 100, rows: [buys[0]]
  }))
  await assert.rejects(() => incomplete.client.getEquityWallet(), ResponseError)
  assert.equal(incomplete.calls.length, 2)

  const negative = clientWith(() => http({ total: 1, page: 1, size: 100, rows: [sell] }))
  await assert.rejects(() => negative.client.getEquityWallet(), /negative; the history is incomplete/)
})
