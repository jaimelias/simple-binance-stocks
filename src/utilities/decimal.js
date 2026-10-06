// Exact nonnegative decimal arithmetic for order sizes and wallet reports. Integer operations use
// decimal digits so the same implementation works in Node.js and Apps Script.
const trimInteger = (value) => {
  return value.replace(/^0+(?=\d)/, '');
}

const compareIntegers = (left, right) => {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

const addIntegers = (left, right) => {
  const result = [];
  let carry = 0;
  for (let i = left.length - 1, j = right.length - 1; i >= 0 || j >= 0 || carry; i--, j--) {
    const sum = (i >= 0 ? Number(left[i]) : 0) + (j >= 0 ? Number(right[j]) : 0) + carry;
    result.push(String(sum % 10));
    carry = Math.floor(sum / 10);
  }
  return trimInteger(result.reverse().join(''));
}

const subtractIntegers = (left, right) => {
  const result = [];
  let borrow = 0;
  for (let i = left.length - 1, j = right.length - 1; i >= 0; i--, j--) {
    let digit = Number(left[i]) - (j >= 0 ? Number(right[j]) : 0) - borrow;
    borrow = digit < 0 ? 1 : 0;
    if (borrow) digit += 10;
    result.push(String(digit));
  }
  return trimInteger(result.reverse().join(''));
}

const multiplyIntegers = (left, right) => {
  if (left === '0' || right === '0') return '0';
  const result = Array(left.length + right.length).fill(0);
  for (let i = left.length - 1; i >= 0; i--) {
    let carry = 0;
    for (let j = right.length - 1; j >= 0; j--) {
      const index = i + j + 1;
      const product = Number(left[i]) * Number(right[j]) + result[index] + carry;
      result[index] = product % 10;
      carry = Math.floor(product / 10);
    }
    result[i] += carry;
  }
  return trimInteger(result.join(''));
}

const divideIntegers = (numerator, denominator) => {
  if (denominator === '0') throw new RangeError('Cannot divide by zero');
  if (compareIntegers(numerator, denominator) < 0) return { quotient: '0', remainder: numerator };
  if (denominator === '1') return { quotient: numerator, remainder: '0' };
  const multiples = Array.from({ length: 10 }, (_, i) => multiplyIntegers(denominator, String(i)));
  let remainder = '0';
  let quotient = '';
  for (const digit of numerator) {
    remainder = trimInteger(remainder + digit);
    let low = 0;
    let high = 9;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (compareIntegers(multiples[middle], remainder) <= 0) low = middle;
      else high = middle - 1;
    }
    quotient += String(low);
    remainder = subtractIntegers(remainder, multiples[low]);
  }
  return { quotient: trimInteger(quotient), remainder };
}

const parts = (digits, scale) => {
  digits = trimInteger(digits);
  if (digits === '0') return { digits, scale: 0 };
  while (scale > 0 && digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    scale--;
  }
  return { digits, scale };
}

const parse = (value) => {
  if (value instanceof Decimal) return { digits: value.digits, scale: value.scale };
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new TypeError('Decimal value must be a finite number or plain decimal string');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Decimal value must be finite');
    if (value < 0) throw new RangeError('Decimal value must be nonnegative');
    const [coefficient, exponentText = '0'] = String(value).toLowerCase().split('e');
    const [integer, fraction = ''] = coefficient.split('.');
    const scale = fraction.length - Number(exponentText);
    return scale < 0 ? parts(integer + fraction + '0'.repeat(-scale), 0) : parts(integer + fraction, scale);
  }
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new TypeError('Decimal value must be a plain nonnegative decimal string');
  const [integer, fraction = ''] = value.split('.');
  return parts(integer + fraction, fraction.length);
}

const fromParts = (digits, scale) => {
  const result = Object.create(Decimal.prototype);
  Object.assign(result, parts(digits, scale));
  return Object.freeze(result);
}

const aligned = (left, right) => {
  const scale = Math.max(left.scale, right.scale);
  return {
    left: trimInteger(left.digits + '0'.repeat(scale - left.scale)),
    right: trimInteger(right.digits + '0'.repeat(scale - right.scale)),
    scale,
  };
}

export default class Decimal {
  constructor(value) {
    Object.assign(this, parse(value));
    Object.freeze(this);
  }

  toFixed() {
    if (this.scale === 0) return this.digits;
    const digits = this.digits.padStart(this.scale + 1, '0');
    return `${digits.slice(0, -this.scale)}.${digits.slice(-this.scale)}`;
  }

  toString() { return this.toFixed(); }
  isFinite() { return true; }
  isPositive() { return !this.isZero(); }
  isNegative() { return false; }
  isZero() { return this.digits === '0'; }
  isInteger() { return this.scale === 0; }
  decimalPlaces() { return this.scale; }

  comparedTo(value) {
    const operands = aligned(this, new Decimal(value));
    return compareIntegers(operands.left, operands.right);
  }

  lt(value) { return this.comparedTo(value) < 0; }
  lte(value) { return this.comparedTo(value) <= 0; }
  gt(value) { return this.comparedTo(value) > 0; }
  gte(value) { return this.comparedTo(value) >= 0; }
  eq(value) { return this.comparedTo(value) === 0; }

  plus(value) {
    const operands = aligned(this, new Decimal(value));
    return fromParts(addIntegers(operands.left, operands.right), operands.scale);
  }

  minus(value) {
    const operands = aligned(this, new Decimal(value));
    if (compareIntegers(operands.left, operands.right) < 0) {
      throw new RangeError('Decimal subtraction cannot produce a negative result');
    }
    return fromParts(subtractIntegers(operands.left, operands.right), operands.scale);
  }

  times(value) {
    const right = new Decimal(value);
    return fromParts(multiplyIntegers(this.digits, right.digits), this.scale + right.scale);
  }

  divToInt(value) {
    const right = new Decimal(value);
    const operands = aligned(this, right);
    return fromParts(divideIntegers(operands.left, operands.right).quotient, 0);
  }

  mod(value) {
    const operands = aligned(this, new Decimal(value));
    return fromParts(divideIntegers(operands.left, operands.right).remainder, operands.scale);
  }
}
