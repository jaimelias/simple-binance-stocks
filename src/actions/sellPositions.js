import { publicOptions, normalizeSymbol } from '../utilities/publicInputs.js'
import { placementPayload, loadOrderRules, validatePlacementOptions, applySellSizing, submitOrder } from '../utilities/orderPreparation.js'

/** Sell all or selected wallet positions once, preserving each placement outcome. */
export const sellPositions = async (main, positions, options = {}) => {
  if (positions !== null && !Array.isArray(positions)) {
    throw new TypeError('positions must be null or an array of { symbol } objects')
  }
  const symbols = positions === null ? null : [...new Set(Array.from(positions, position =>
    normalizeSymbol(publicOptions(position, ['symbol']).symbol)))]
  const { bufferSteps, beforeSubmit } = publicOptions(options, ['bufferSteps', 'beforeSubmit'])
  validatePlacementOptions('SELL', { bufferSteps, beforeSubmit })
  if (symbols?.length === 0) return []

  const wallet = await main.getEquityWallet()
  const results = []
  for (const symbol of symbols ?? Object.keys(wallet)) {
    if (!Object.prototype.hasOwnProperty.call(wallet, symbol)) {
      results.push({ symbol, skipped: 'NO_POSITION' })
      continue
    }
    let quantity = wallet[symbol].amount
    try {
      const rules = await loadOrderRules(main, symbol)
      const payload = placementPayload({ symbol, side: 'SELL', orderType: 'MARKET', quantity })
      applySellSizing(main, payload, rules, { bufferSteps }, { estimatedExit: true, round: true })
      quantity = payload.quantity
      const ack = await submitOrder(main, payload, rules, { estimateMarketSellNotional: true, beforeSubmit })
      results.push({ symbol, quantity, ack })
    } catch (error) {
      results.push({ symbol, quantity, error })
    }
  }
  return results
}
