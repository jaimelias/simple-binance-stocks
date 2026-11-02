import { decimalValue, publicOptions } from './publicInputs.js'

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
