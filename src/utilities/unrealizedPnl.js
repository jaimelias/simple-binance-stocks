import { reportNumber } from './publicInputs.js'

/** Keep signed reporting separate from the nonnegative sizing decimal type. */
export const unrealizedPnl = (value, costBasis, numeric = false) => {
  if (value === null || costBasis === null) {
    return { unrealizedPnlUsd: null, unrealizedPnlPercent: null }
  }
  const loss = value.lt(costBasis)
  const magnitude = loss ? costBasis.minus(value) : value.minus(costBasis)
  const output = decimal => {
    if (numeric) {
      const number = reportNumber(decimal)
      return loss && number !== 0 ? -number : number
    }
    return loss && !decimal.isZero() ? `-${decimal}` : decimal.toString()
  }
  return {
    unrealizedPnlUsd: output(magnitude),
    unrealizedPnlPercent: costBasis.isZero() ? null : output(magnitude.times('100').div(costBasis))
  }
}
