import Decimal from '../utilities/decimal.js'
import { publicOptions, normalizeSymbol, decimalValue } from '../utilities/publicInputs.js'
import { tradeHistory } from '../utilities/endpointAsserts.js'
import { unrealizedPnl } from '../utilities/unrealizedPnl.js'

/** Compare complete JSON rows independently of object property order. */
const canonicalRow = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalRow).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalRow(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Reconstruct moving weighted average cost from chronologically ordered fills. */
const remainingCost = fills => {
  fills.sort((left, right) => left.executionAt - right.executionAt)
  let amount = new Decimal('0')
  let cost = new Decimal('0')
  for (let i = 0; i < fills.length; i++) {
    const fill = fills[i]
    if (i > 0 && fill.executionAt === fills[i - 1].executionAt && fill.side !== fills[i - 1].side) {
      return null
    }
    if (fill.side === 'BUY') {
      amount = amount.plus(fill.quantity)
      cost = cost.plus(fill.quantity.times(fill.price))
    } else {
      if (fill.quantity.gt(amount)) return null
      const remaining = amount.minus(fill.quantity)
      cost = remaining.isZero() ? new Decimal('0') : cost.times(remaining).div(amount)
      amount = remaining
    }
  }
  return cost
}

/** Internal shared snapshot: complete fill history, remaining basis, and one bid per position. */
export const getEquitySnapshot = async (main, options = {}) => {
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
      const price = decimalValue(row.price, 'trade.price', { stringOnly: true })
      if (!Number.isSafeInteger(row.executionAt) || row.executionAt < 0) {
        throw new TypeError('trade.executionAt must be a nonnegative safe integer')
      }
      const fingerprint = canonicalRow(row)
      if (executions.has(row.executionId)) {
        if (executions.get(row.executionId) !== fingerprint) throw new Error('Conflicting rows for the same executionId')
        continue
      }
      executions.set(row.executionId, fingerprint)
      const balance = totals.get(symbol) ?? { BUY: new Decimal('0'), SELL: new Decimal('0'), fills: [] }
      balance[row.side] = balance[row.side].plus(quantity)
      balance.fills.push({ quantity, price, side: row.side, executionAt: row.executionAt })
      totals.set(symbol, balance)
    }
    if (expectedTotal > 0 && executions.size === previousCount) {
      throw new Error('Repeated or nonadvancing trade history page')
    }
    consumed += page.rows.length
    if (consumed === expectedTotal) break
  }
  if (executions.size !== expectedTotal) {
    throw new Error('Incomplete trade history: distinct execution count does not match total')
  }
  const positions = new Map()
  for (const [symbol, balance] of totals) {
    if (balance.SELL.gt(balance.BUY)) {
      throw new RangeError(`The selected trade window cannot establish a nonnegative holding estimate for ${symbol}`)
    }
    const amount = balance.BUY.minus(balance.SELL)
    if (!amount.isZero()) positions.set(symbol, { amount, costBasis: remainingCost(balance.fills), bid: null, value: null })
  }
  for (const [symbol, position] of positions) {
    const quote = await main.getQuote(symbol)
    try {
      if (quote?.symbol !== undefined && normalizeSymbol(quote.symbol) !== symbol) {
        throw new TypeError('quote.symbol does not match the position symbol')
      }
      position.bid = decimalValue(quote?.bidPrice, 'quote.bidPrice')
      position.value = position.amount.times(position.bid)
    } catch {
      // A successful response without a matching positive bid leaves this position unpriced.
    }
  }
  return positions
}

/** Return estimated holdings and current bid-based PnL as decimal strings. */
export const getEquityWallet = async (main, options = {}) => {
  const positions = await getEquitySnapshot(main, options)
  const wallet = {}
  for (const [symbol, position] of positions) {
    wallet[symbol] = {
      amount: position.amount.toString(),
      costBasisUsd: position.costBasis?.toString() ?? null,
      ...unrealizedPnl(position.value, position.costBasis)
    }
  }
  return wallet
}
