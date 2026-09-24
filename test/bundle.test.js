import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import BinanceStocks from '../index.js'

const apiKey = 'bundle-test-api-key'
const apiSecret = 'bundle-test-api-secret'
const fixedId = '12345678-1234-4234-8234-123456789012'
const symbolInfo = {
  symbol: 'AAPL', tradability: 'BUY_SELL', stepSize: '0.000000001',
  minQty: '0.000000001', maxQty: '100000', minNotional: '0.01', maxNotional: '1000000',
  fractionable: true, fractionableEh: true, extendedSession: true, overnightSupported: true
}

function bodyFor(url) {
  const path = new URL(url).pathname
  if (path.endsWith('/exchangeInfo')) return { timezone: 'UTC', symbols: [symbolInfo] }
  if (path.endsWith('/quote')) return { symbol: 'AAPL', bidPrice: '100.00', askPrice: '100.01' }
  if (path.endsWith('/listenKey')) return { listenKey: 'test-listen-key' }
  if (path.endsWith('/order/place')) return { status: 'S', orderId: 'test-order', clientOrderId: new URL(url).searchParams.get('clientOrderId') }
  throw new Error('Unexpected test route')
}

test('Apps Script artifact loads without Node/browser services and performs signed sized orders', async () => {
  const code = await readFile(new URL('../dist/google-apps-script-build.js', import.meta.url), 'utf8')
  assert.equal(/^\s*(?:import|export)\s/m.test(code), false, 'The bundle must not contain ES module syntax.')
  assert.equal(/require\(|node:crypto|#apiSecret/.test(code), false, 'The bundle must not need Node.js or private-field syntax.')
  const requests = []
  const sandbox = {
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      getUuid: () => fixedId,
      computeHmacSha256Signature(payload, secret, charset) {
        assert.equal(charset, 'UTF-8')
        return [...createHmac('sha256', secret).update(payload).digest()].map(byte => byte > 127 ? byte - 256 : byte)
      }
    },
    UrlFetchApp: {
      fetch(url, options) {
        requests.push({ url, options })
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify(bodyFor(url)),
          getAllHeaders: () => ({ 'X-SAPI-USED-IP-WEIGHT-1M': '3' })
        }
      }
    }
  }
  runInNewContext(code, sandbox, { filename: 'google-apps-script-build.js', timeout: 2000 })
  assert.equal(typeof sandbox.BinanceStocks, 'function')
  assert.equal(typeof sandbox.BinanceStocksLibrary.RateLimitError, 'function')
  const client = new sandbox.BinanceStocks({ apiKey, apiSecret, symbol: 'AAPL', now: () => 1800000000000 })
  const quote = await client.getQuote()
  assert.equal(quote.bidPrice, '100.00')
  assert.equal(new URL(requests[0].url).searchParams.has('signature'), false)
  const result = await client.createLimitOrder({ amountInUSD: 0.3, entryPrice: '0.10', tradingSession: 'RTH' })
  assert.equal(result.clientOrderId, fixedId)
  const request = requests.at(-1)
  const query = new URL(request.url).searchParams
  assert.equal(query.get('quantity'), '3')
  assert.equal(query.get('price'), '0.1')
  assert.equal(query.get('quoteAsset'), 'USDC')
  assert.equal(query.has('amountInUSD'), false)
  assert.equal(request.options.muteHttpExceptions, true)
  const encoded = request.url.split('?')[1].split('&signature=')[0]
  assert.equal(query.get('signature'), createHmac('sha256', apiSecret).update(encoded).digest('hex'))
  assert.equal(client.getRateLimitState().usage['x-sapi-used-ip-weight-1m'], '3')
})

test('Apps Script can create a key-only listen key without Utilities signing', async () => {
  const code = await readFile(new URL('../dist/google-apps-script-build.js', import.meta.url), 'utf8')
  const requests = []
  const sandbox = {
    UrlFetchApp: {
      fetch(url) {
        requests.push(url)
        return { getResponseCode: () => 200, getAllHeaders: () => ({}), getContentText: () => JSON.stringify(bodyFor(url)) }
      }
    }
  }
  runInNewContext(code, sandbox)
  const client = new sandbox.BinanceStocks({ apiKey, now: () => 1800000000000 })
  assert.equal((await client.createListenKey()).listenKey, 'test-listen-key')
  const query = new URL(requests[0]).searchParams
  assert.equal(query.get('timestamp'), '1800000000000')
  assert.equal(query.has('signature'), false)
})

test('CommonJS distribution and ESM entry both size and sign market orders', async () => {
  const require = createRequire(import.meta.url)
  const CommonJSClient = require('../dist/index.cjs')
  assert.equal(typeof CommonJSClient, 'function')
  assert.equal(typeof CommonJSClient.RateLimitError, 'function')
  for (const Client of [BinanceStocks, CommonJSClient]) {
    const requests = []
    const client = new Client({
      apiKey, apiSecret, symbol: 'AAPL', now: () => 1800000000000,
      fetch: async (url, options) => {
        requests.push({ url, options })
        return { status: 200, headers: {}, text: async () => JSON.stringify(bodyFor(url)) }
      }
    })
    assert.equal((await client.createMarketOrder({ amountInUSD: 100 })).status, 'S')
    const request = requests.at(-1)
    const query = new URL(request.url).searchParams
    assert.equal(query.get('notional'), '100')
    assert.equal(query.has('quantity'), false)
    assert.match(query.get('clientOrderId'), /^[a-zA-Z0-9_-]{32,36}$/)
    const payload = request.url.split('?')[1].split('&signature=')[0]
    assert.equal(query.get('signature'), createHmac('sha256', apiSecret).update(payload).digest('hex'))
  }
})
