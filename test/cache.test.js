import test from 'node:test'
import assert from 'node:assert/strict'
import MetadataCache from '../src/cache.js'

test('Node cache is per instance, expires lazily, and returns defensive copies', () => {
  let now = 1000
  const cache = new MetadataCache({ now: () => now })
  const other = new MetadataCache({ now: () => now })
  const metadata = { symbols: [{ symbol: 'NVDA', stepSize: '0.001' }] }
  cache.set('exchangeInfo:NVDA', metadata, 2)
  metadata.symbols[0].stepSize = '999'
  assert.equal(other.get('exchangeInfo:NVDA'), undefined)
  const first = cache.get('exchangeInfo:NVDA')
  assert.equal(first.symbols[0].stepSize, '0.001')
  first.symbols[0].stepSize = '888'
  assert.equal(cache.get('exchangeInfo:NVDA').symbols[0].stepSize, '0.001')
  now = 2999
  assert.ok(cache.get('exchangeInfo:NVDA'))
  now = 3000
  assert.equal(cache.get('exchangeInfo:NVDA'), undefined)
  cache.set('tokenizedAssets', [], 21600)
  cache.delete('tokenizedAssets')
  assert.equal(cache.get('tokenizedAssets'), undefined)
})

test('Apps Script cache uses namespaced keys and respects service limits', () => {
  const originalUrlFetchApp = globalThis.UrlFetchApp
  const originalCacheService = globalThis.CacheService
  const entries = new Map()
  const writes = []
  const scriptCache = {
    get: key => entries.get(key) ?? null,
    put: (key, value, ttl) => {
      assert.ok(key.length <= 250)
      assert.ok(Buffer.byteLength(value, 'utf8') <= 100 * 1024)
      writes.push({ key, ttl })
      entries.set(key, value)
    },
    remove: key => entries.delete(key),
  }
  globalThis.UrlFetchApp = { fetch() {} }
  globalThis.CacheService = { getScriptCache: () => scriptCache }
  try {
    const cache = new MetadataCache({ baseUrl: 'https://api.binance.com' })
    const sameOrigin = new MetadataCache({ baseUrl: 'https://api.binance.com/' })
    const otherOrigin = new MetadataCache({ baseUrl: 'https://testnet.binance.com' })
    cache.set('tokenizedAssets', { assets: ['NVDAB'] }, 50000)
    assert.equal(writes[0].ttl, 21600)
    assert.match(writes[0].key, /^simple-binance-stocks:metadata:v1:https:\/\/api\.binance\.com:/)
    assert.deepEqual(sameOrigin.get('tokenizedAssets'), { assets: ['NVDAB'] })
    assert.equal(otherOrigin.get('tokenizedAssets'), undefined)
    sameOrigin.get('tokenizedAssets').assets.push('AAPL')
    assert.deepEqual(cache.get('tokenizedAssets'), { assets: ['NVDAB'] })

    cache.set('exchangeInfo:NVDA', { symbols: [] }, 60)
    assert.equal(writes.at(-1).ttl, 60)
    const longKey = 'symbol:' + 'A'.repeat(500)
    cache.set(longKey, { value: 1 }, 60)
    assert.deepEqual(sameOrigin.get(longKey), { value: 1 })
    assert.equal(sameOrigin.get(longKey + 'B'), undefined)

    const count = writes.length
    cache.set('oversized', { data: 'é'.repeat(60000) }, 60)
    assert.equal(writes.length, count)
    assert.equal(cache.get('oversized'), undefined)

    entries.delete(writes[0].key) // CacheService may evict before requested expiry.
    assert.equal(cache.get('tokenizedAssets'), undefined)
    cache.delete('exchangeInfo:NVDA')
    assert.equal(cache.get('exchangeInfo:NVDA'), undefined)
  } finally {
    if (originalUrlFetchApp === undefined) delete globalThis.UrlFetchApp
    else globalThis.UrlFetchApp = originalUrlFetchApp
    if (originalCacheService === undefined) delete globalThis.CacheService
    else globalThis.CacheService = originalCacheService
  }
})

test('unserializable values and storage failures do not interrupt metadata reads', () => {
  const cache = new MetadataCache()
  const circular = {}
  circular.self = circular
  cache.set('circular', circular, 60)
  assert.equal(cache.get('circular'), undefined)
  cache.set('finite', { value: 1 }, 60)
  cache.set('finite', { value: 2 }, 0)
  assert.equal(cache.get('finite'), undefined)
})
