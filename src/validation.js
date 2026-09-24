import Decimal from './decimal.js'

export function optionsObject(value, name = 'options') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object.`)
  }
  return value
}

export function allowedKeys(value, keys, name = 'options') {
  optionsObject(value, name)
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`Unknown ${name} parameter: ${key}.`)
  }
}

export function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined))
}

export function ticker(value) {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9.-]*$/.test(value)) {
    throw new TypeError('symbol must be a plain uppercase stock or ETF ticker.')
  }
  return value
}

export function nonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new TypeError(`${name} must be a non-empty string without surrounding whitespace.`)
  }
  return value
}

export function enumValue(value, name, values) {
  if (!values.includes(value)) throw new TypeError(`${name} must be one of ${values.join(', ')}.`)
  return value
}

export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`)
  }
  return value
}

export function recvWindow(value) {
  if (value !== undefined) integer(value, 'recvWindow', 1, 60000)
  return value
}

export function clientOrderId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{32,36}$/.test(value)) {
    throw new TypeError('clientOrderId must contain 32–36 letters, digits, underscores, or hyphens.')
  }
  return value
}

export function positiveDecimal(value, name) {
  if ((typeof value !== 'number' || !Number.isFinite(value)) &&
      (typeof value !== 'string' || value.length > 200 || !/^\d+(?:\.\d+)?$/.test(value))) {
    throw new TypeError(`${name} must be a positive decimal string or finite number.`)
  }
  const decimal = new Decimal(value)
  if (!decimal.isFinite() || !decimal.isPositive() || decimal.isZero()) {
    throw new RangeError(`${name} must be greater than zero.`)
  }
  return decimal.toFixed()
}

export function amountInUSD(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError('amountInUSD must be a finite number greater than zero.')
  }
  return value
}

export function usdc(value) {
  if (value !== undefined && value !== 'USDC') throw new TypeError('quoteAsset must be USDC.')
  return 'USDC'
}

export function timeRange(params, required = true) {
  for (const key of ['startTime', 'endTime']) {
    if (required || params[key] !== undefined) integer(params[key], `${key} (Unix milliseconds)`)
  }
  if (params.startTime !== undefined && params.endTime !== undefined && params.startTime > params.endTime) {
    throw new RangeError('startTime must be less than or equal to endTime.')
  }
}

export function pagination(params) {
  if (params.current !== undefined) integer(params.current, 'current', 1)
  if (params.size !== undefined) integer(params.size, 'size', 1, 100)
}

export function cursor(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const normalized = value.replace(/^0+(?=\d)/, '')
    if (normalized.length < 19 || (normalized.length === 19 && normalized <= '9223372036854775807')) {
      return normalized
    }
  } else if (Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  throw new TypeError('lastId must be a non-negative safe integer or an int64 decimal string.')
}
