import { decimalValue, publicOptions } from './publicInputs.js'

export const estimatedExitBufferValue = (value) => {
  if (value === undefined) return undefined
  const reserve = decimalValue(value, 'estimatedExitBuffer', { stringOnly: true })
  if (reserve.gte('1')) throw new RangeError('estimatedExitBuffer must be less than one share')
  return reserve.toString()
}

export const validateBufferSteps = (bufferSteps) => {
  if (!Number.isSafeInteger(bufferSteps) || bufferSteps < 0) {
    throw new TypeError('bufferSteps must be an explicitly supplied nonnegative safe integer')
  }
}

/** Conservatively size an estimated fractional exit; this does not verify available shares. */
export const prepareSellQuantity = (options) => {
  const { quantity, stepSize, bufferSteps } = publicOptions(options, ['quantity', 'stepSize', 'bufferSteps'])
  const amount = decimalValue(quantity, 'quantity', { stringOnly: true })
  const step = decimalValue(stepSize, 'stepSize', { stringOnly: true })
  validateBufferSteps(bufferSteps)
  if (bufferSteps > 0 && amount.isInteger()) {
    throw new RangeError('Positive bufferSteps are only supported for fractional quantities; whole-share quantities cannot be buffered')
  }
  const buffer = step.times(String(bufferSteps))
  if (buffer.gte(amount)) throw new RangeError('buffer must be less than quantity')
  const prepared = amount.minus(buffer).divToInt(step).times(step)
  if (prepared.isZero()) throw new RangeError('Prepared sell quantity must be greater than zero')
  return prepared.toString()
}

export const prepareAutomaticSellQuantity = ({ quantity, stepSize, reserveQuantity }) => {
  const amount = decimalValue(quantity, 'quantity', { stringOnly: true })
  const step = decimalValue(stepSize, 'stepSize', { stringOnly: true })
  const rounded = amount.divToInt(step).times(step)
  if (rounded.isZero()) throw new RangeError('Prepared sell quantity must be greater than zero')
  if (rounded.isInteger()) return rounded.toString()
  const reserve = decimalValue(reserveQuantity, 'reserveQuantity', { stringOnly: true })
  let steps = reserve.divToInt(step)
  if (!reserve.mod(step).isZero()) steps = steps.plus('1')
  const buffer = steps.times(step)
  if (buffer.gte('1')) throw new RangeError('Automatic sell buffer must be less than one share')
  if (buffer.gte(amount)) throw new RangeError('buffer must be less than quantity')
  const prepared = amount.minus(buffer).divToInt(step).times(step)
  if (prepared.isZero()) throw new RangeError('Prepared sell quantity must be greater than zero')
  return prepared.toString()
}
