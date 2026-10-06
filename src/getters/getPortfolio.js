import Decimal from '../utilities/decimal.js'
import { publicOptions, decimalValue, reportNumber } from '../utilities/publicInputs.js'
import { tradeHistory } from '../utilities/endpointAsserts.js'

/** Round a value's weight to four decimal places with exact half-up ties. */
const weight = (value, total) => {
  if (total.isZero()) return null
  const scaled = value.times('10000')
  let rounded = scaled.divToInt(total)
  if (scaled.mod(total).times('2').gte(total)) rounded = rounded.plus('1')
  return reportNumber(rounded.times('0.0001'))
}

/** Build an estimated current portfolio, preserving unavailable successful quotes as null. */
export const getPortfolio = async (main, options = {}) => {
  const input = publicOptions(options, ['startTime', 'endTime', 'recvWindow'])
  const window = { startTime: 0, ...input }
  if (window.endTime === undefined) window.endTime = Date.now()
  tradeHistory(window)
  const equity = await main.getEquityWallet(window)
  const funding = await main.getFundingWallet({ recvWindow: window.recvWindow })
  const cashValue = decimalValue(funding.USDC.amount, 'cash.amount', { positive: false, stringOnly: true })
  const cashNumber = reportNumber(cashValue)
  const cash = { USDC: { amount: cashNumber, quote: 1, usd: cashNumber, weight: null } }
  const positions = {}
  const values = new Map()
  let positionsValue = new Decimal('0')
  let complete = true
  for (const [symbol, position] of Object.entries(equity)) {
    const amount = decimalValue(position.amount, 'position.amount', { positive: false, stringOnly: true })
    if (amount.isZero()) continue
    const entry = { amount: reportNumber(amount), quote: null, usd: null, weight: null }
    positions[symbol] = entry
    const quote = await main.getQuote(symbol)
    let bid
    try {
      bid = decimalValue(quote?.bidPrice, 'quote.bidPrice')
    } catch {
      complete = false
      continue
    }
    const value = amount.times(bid)
    entry.quote = reportNumber(bid)
    entry.usd = reportNumber(value)
    values.set(symbol, value)
    positionsValue = positionsValue.plus(value)
  }
  const total = positionsValue.plus(cashValue)
  if (complete) {
    cash.USDC.weight = weight(cashValue, total)
    for (const [symbol, value] of values) positions[symbol].weight = weight(value, total)
  }
  return {
    totals: {
      totalUsd: complete ? reportNumber(total) : null,
      positionsUsd: complete ? reportNumber(positionsValue) : null,
      cashUsd: cashNumber
    },
    cash,
    positions
  }
}
