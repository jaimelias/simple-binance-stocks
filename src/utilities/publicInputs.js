import Decimal from './decimal.js'

/** Copy only supported public options, rejecting likely caller mistakes. */
export const publicOptions = (value, fields) => {
  if (value === null || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('Options must be a plain object')
  }
  const result = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue
    if (!fields.includes(key)) throw new TypeError(`${key} is not allowed`)
    result[key] = entry
  }
  return result
}

/** Normalize a ticker without relying on client state. */
export const normalizeSymbol = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('symbol must be a non-empty string')
  }
  return value.trim().toUpperCase()
}

/** Parse public decimal inputs; response fields may require strings only. */
export const decimalValue = (value, field, { positive = true, stringOnly = false } = {}) => {
  if (stringOnly && typeof value !== 'string') throw new TypeError(`${field} must be a decimal string`)
  let decimal
  try {
    decimal = new Decimal(value)
  } catch {
    throw new TypeError(`${field} must be a ${positive ? 'positive' : 'nonnegative'} decimal`)
  }
  if (positive && decimal.isZero()) throw new RangeError(`${field} must be greater than zero`)
  return decimal
}

/** Validate monetary convenience sizing before converting it to exact decimals. */
export const orderAmount = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError('amountInUSD must be a finite number greater than zero')
  }
  return new Decimal(value)
}

/** Convert a decimal for a report, rejecting overflow and loss of nonzero magnitude. */
export const reportNumber = (value) => {
  const number = Number(value.toString())
  if (!Number.isFinite(number) || (number === 0 && !value.isZero())) {
    throw new RangeError('Portfolio value is outside the representable numeric range')
  }
  return number
}
