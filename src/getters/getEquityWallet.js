import Decimal from '../utilities/decimal.js'
import { publicOptions, normalizeSymbol, decimalValue } from '../utilities/publicInputs.js'
import { tradeHistory } from '../utilities/endpointAsserts.js'

/** Compare complete JSON rows independently of object property order. */
const canonicalRow = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalRow).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalRow(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Aggregate a complete fixed-window fill history into a nonnegative holding estimate. */
export const getEquityWallet = async (main, options = {}) => {
  const input = publicOptions(options, ['startTime', 'endTime', 'recvWindow'])
  const window = { startTime: 0, ...input }
  if (window.endTime === undefined) window.endTime = Date.now()
  tradeHistory(window)
  const executions = new Map()
  const totals = new Map()
  let expectedTotal
  let consumed = 0
  for (let current = 1; ; current++) {
    const page = await main.getTradeHistory({ ...window, size: 100, current })
    if (!page || !Number.isSafeInteger(page.total) || page.total < 0 ||
        page.page !== current || page.size !== 100 || !Array.isArray(page.rows)) {
      throw new TypeError('Invalid trade history pagination metadata')
    }
    if (expectedTotal === undefined) expectedTotal = page.total
    if (page.total !== expectedTotal || page.rows.length !== Math.min(100, expectedTotal - consumed)) {
      throw new Error('Inconsistent or incomplete trade history page')
    }
    const previousCount = executions.size
    for (const row of page.rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          typeof row.executionId !== 'string' || !row.executionId.trim() ||
          !['BUY', 'SELL'].includes(row.side) || (row.quote !== undefined && row.quote !== 'USDC')) {
        throw new TypeError('Malformed trade history row')
      }
      const symbol = normalizeSymbol(row.symbol)
      const quantity = decimalValue(row.qty, 'trade.qty', { stringOnly: true })
      const fingerprint = canonicalRow(row)
      if (executions.has(row.executionId)) {
        if (executions.get(row.executionId) !== fingerprint) throw new Error('Conflicting rows for the same executionId')
        continue
      }
      executions.set(row.executionId, fingerprint)
      const balance = totals.get(symbol) ?? { BUY: new Decimal('0'), SELL: new Decimal('0') }
      balance[row.side] = balance[row.side].plus(quantity)
      totals.set(symbol, balance)
    }
    if (expectedTotal > 0 && executions.size === previousCount) {
      throw new Error('Repeated or nonadvancing trade history page')
    }
    consumed += page.rows.length
    if (consumed === expectedTotal) break
  }
  const wallet = {}
  for (const [symbol, balance] of totals) {
    if (balance.SELL.gt(balance.BUY)) {
      throw new RangeError(`The selected trade window cannot establish a nonnegative holding estimate for ${symbol}`)
    }
    const amount = balance.BUY.minus(balance.SELL)
    if (!amount.isZero()) wallet[symbol] = { amount: amount.toString() }
  }
  return wallet
}
