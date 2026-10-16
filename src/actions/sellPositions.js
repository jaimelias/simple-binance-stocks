import { publicOptions, normalizeSymbol } from '../utilities/publicInputs.js'

/** Sell all or selected wallet positions once, preserving each placement outcome. */
export const sellPositions = async (main, positions) => {
  if (positions !== null && !Array.isArray(positions)) {
    throw new TypeError('positions must be null or an array of { symbol } objects')
  }
  const symbols = positions === null ? null : [...new Set(Array.from(positions, position =>
    normalizeSymbol(publicOptions(position, ['symbol']).symbol)))]
  if (symbols?.length === 0) return []

  const wallet = await main.getEquityWallet()
  const results = []
  for (const symbol of symbols ?? Object.keys(wallet)) {
    if (!Object.prototype.hasOwnProperty.call(wallet, symbol)) {
      results.push({ symbol, skipped: 'NO_POSITION' })
      continue
    }
    const quantity = wallet[symbol].amount
    try {
      const ack = await main.placeOrder({ symbol, side: 'SELL', orderType: 'MARKET', quantity })
      results.push({ symbol, quantity, ack })
    } catch (error) {
      results.push({ symbol, quantity, error })
    }
  }
  return results
}
