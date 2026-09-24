import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import BinanceStocks from '../index.js'

const apiKey = 'bundle-test-api-key'
const apiSecret = 'bundle-test-api-secret'
const fixedId = '12345678-1234-4234-8234-123456789012'
const artifactUrl = new URL('../dist/BinanceStocks.min.js', import.meta.url)
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

function gasUtilities() {
  return {
    Charset: { UTF_8: 'UTF-8' },
    getUuid: () => fixedId,
    computeHmacSha256Signature(payload, secret, charset) {
      assert.equal(charset, 'UTF-8')
      return [...createHmac('sha256', secret).update(payload).digest()].map(byte => byte > 127 ? byte - 256 : byte)
    }
  }
}

function gasResponse(body, status = 200, headers = {}) {
  return {
    getResponseCode: () => status,
    getContentText: () => JSON.stringify(body),
    getAllHeaders: () => headers
  }
}

async function loadArtifact(sandbox = {}) {
  const code = await readFile(artifactUrl, 'utf8')
  runInNewContext(code, sandbox, { filename: 'BinanceStocks.min.js', timeout: 2000 })
  return sandbox.BinanceStocks
}

test('Apps Script artifact loads without Node/browser services and performs signed sized orders', async () => {
  const code = await readFile(artifactUrl, 'utf8')
  assert.equal(/^\s*(?:import|export)\s/m.test(code), false, 'The bundle must not contain ES module syntax.')
  assert.equal(/require\(|node:crypto|#apiSecret/.test(code), false, 'The bundle must not need Node.js or private-field syntax.')
  const requests = []
  const sandbox = {
    Utilities: gasUtilities(),
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
  runInNewContext(code, sandbox, { filename: 'BinanceStocks.min.js', timeout: 2000 })
  assert.equal(typeof sandbox.BinanceStocks, 'function')
  assert.equal(typeof sandbox.BinanceStocks.RateLimitError, 'function')
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
  const requests = []
  const sandbox = {
    UrlFetchApp: {
      fetch(url) {
        requests.push(url)
        return { getResponseCode: () => 200, getAllHeaders: () => ({}), getContentText: () => JSON.stringify(bodyFor(url)) }
      }
    }
  }
  const AppsScriptClient = await loadArtifact(sandbox)
  const client = new AppsScriptClient({ apiKey, now: () => 1800000000000 })
  assert.equal((await client.createListenKey()).listenKey, 'test-listen-key')
  const query = new URL(requests[0]).searchParams
  assert.equal(query.get('timestamp'), '1800000000000')
  assert.equal(query.has('signature'), false)
})

test('Node ESM entry sizes and signs market orders with Node cryptography', async () => {
  const requests = []
  const client = new BinanceStocks({
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
  assert.equal(query.get('quoteAsset'), 'USDC')
  assert.equal(query.has('quantity'), false)
  assert.match(query.get('clientOrderId'), /^[a-zA-Z0-9_-]{32,36}$/)
  const payload = request.url.split('?')[1].split('&signature=')[0]
  assert.equal(query.get('signature'), createHmac('sha256', apiSecret).update(payload).digest('hex'))
})

test('minified Apps Script artifact preserves exported error names and inheritance', async () => {
  const AppsScriptClient = await loadArtifact()
  assert.equal(typeof AppsScriptClient, 'function')
  for (const name of ['BinanceAPIError', 'RateLimitError', 'UnknownExecutionError', 'ResponseError', 'ValidationError']) {
    const ErrorType = AppsScriptClient[name]
    assert.equal(typeof ErrorType, 'function')
    const error = new ErrorType('test error')
    assert.equal(error.name, name)
    assert.equal(error.message, 'test error')
    assert.ok(error instanceof ErrorType)
    if (name !== 'ValidationError') assert.ok(error instanceof AppsScriptClient.BinanceAPIError)
  }
})

test('minified Apps Script artifact enforces a 429 cooldown and resumes after Retry-After', async () => {
  let now = 1800000000000
  let calls = 0
  const AppsScriptClient = await loadArtifact({
    UrlFetchApp: {
      fetch(url) {
        calls += 1
        return calls === 1
          ? gasResponse({ code: -1003, msg: 'Slow down' }, 429, { 'Retry-After': '2', 'X-SAPI-USED-IP-WEIGHT-1M': '99' })
          : gasResponse(bodyFor(url))
      }
    }
  })
  const client = new AppsScriptClient({ apiKey, symbol: 'AAPL', now: () => now })
  await assert.rejects(client.getQuote(), error => {
    assert.ok(error instanceof AppsScriptClient.RateLimitError)
    assert.equal(error.name, 'RateLimitError')
    assert.equal(error.status, 429)
    assert.equal(error.code, -1003)
    assert.equal(error.headers['retry-after'], '2')
    assert.equal(error.retryAfterMs, 2000)
    assert.equal(error.lockedUntil, now + 2000)
    assert.equal(error.local, false)
    return true
  })
  assert.equal(calls, 1)
  assert.equal(client.getRateLimitState().usage['x-sapi-used-ip-weight-1m'], '99')
  now += 1000
  await assert.rejects(client.getQuote(), error => {
    assert.ok(error instanceof AppsScriptClient.RateLimitError)
    assert.equal(error.name, 'RateLimitError')
    assert.equal(error.retryAfterMs, 1000)
    assert.equal(error.local, true)
    return true
  })
  assert.equal(calls, 1, 'The local cooldown must prevent another HTTP request.')
  now += 1000
  assert.equal((await client.getQuote()).bidPrice, '100.00')
  assert.equal(calls, 2)
})

test('minified Apps Script artifact retains uncertain order IDs and never retries mutations', async () => {
  for (const outcome of ['network', 'server', 'malformed']) {
    const requests = []
    const AppsScriptClient = await loadArtifact({
      Utilities: gasUtilities(),
      UrlFetchApp: {
        fetch(url, options) {
          requests.push({ url, options })
          if (!new URL(url).pathname.endsWith('/order/place')) return gasResponse(bodyFor(url))
          if (outcome === 'network') throw new Error('Simulated transport interruption')
          if (outcome === 'server') return gasResponse({ code: -1007, msg: 'Timeout' }, 503)
          return gasResponse({ unexpected: true })
        }
      }
    })
    const client = new AppsScriptClient({ apiKey, apiSecret, symbol: 'AAPL', now: () => 1800000000000 })
    await assert.rejects(client.createMarketOrder({ amountInUSD: 100, clientOrderId: fixedId }), error => {
      assert.ok(error instanceof AppsScriptClient.UnknownExecutionError, outcome)
      assert.ok(error instanceof AppsScriptClient.BinanceAPIError, outcome)
      assert.equal(error.name, 'UnknownExecutionError')
      assert.equal(error.executionUnknown, true)
      assert.equal(error.clientOrderId, fixedId)
      assert.equal(error.path, '/sapi/v1/equity/order/place')
      assert.equal(error.method, 'POST')
      assert.equal(error.stack.includes(apiSecret), false)
      return true
    })
    assert.equal(requests.filter(request => request.options.method === 'post').length, 1, outcome)
    assert.equal(requests.length, 2, 'Only exchange info and a single placement should be requested.')
  }
})
