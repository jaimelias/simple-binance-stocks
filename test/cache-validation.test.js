import test from 'node:test'
import assert from 'node:assert/strict'
import BinanceStocks from '../index.js'

const RULE = {
  symbol: 'AAPL', tradability: 'BUY_SELL', fractionable: true, fractionableEh: true,
  extendedSession: true, overnightSupported: true, stepSize: '0.000000001',
  minQty: '0.000000001', maxQty: '100000', minNotional: '1', maxNotional: '1000000'
}
const ASSET = {
  assetCode: 'AAPLB', assetName: 'Apple Inc. Tokenized Stock',
  underlyingEquitySymbol: 'AAPL', multiplier: '1', multiplierValid: true
}

function clientWith(responses) {
  let count = 0
  const client = new BinanceStocks({
    apiKey: 'offline-key',
    fetch: async () => ({
      status: 200, headers: {}, text: async () => JSON.stringify(responses[Math.min(count++, responses.length - 1)])
    })
  })
  return { client, calls: () => count }
}

test('symbol rules are cached only after the required trading fields are valid', async () => {
  const fixture = clientWith([
    { symbols: [{ symbol: 'AAPL' }] },
    { symbols: [RULE] }
  ])
  await fixture.client.getSymbolInfo('AAPL')
  await fixture.client.getSymbolInfo('AAPL')
  await fixture.client.getSymbolInfo('AAPL')
  assert.equal(fixture.calls(), 2)
})

test('tokenized asset metadata is cached only with the current response fields', async () => {
  const fixture = clientWith([
    [{ tokenizedAsset: 'AAPLB', underlyingAsset: 'AAPL', multiplier: '1' }],
    [ASSET]
  ])
  await fixture.client.getTokenizedAssets()
  await fixture.client.getTokenizedAssets()
  await fixture.client.getTokenizedAssets()
  assert.equal(fixture.calls(), 2)
})
