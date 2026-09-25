import test from 'node:test';
import assert from 'node:assert/strict';
import Decimal from '../src/decimal.js';

test('addition and subtraction preserve fractional carries for wallet balances', () => {
  const whole = new Decimal('999999999999999999.999999999').plus('0.000000001');
  assert.equal(whole.toFixed(), '1000000000000000000');
  assert.equal(whole.minus('0.000000001').toFixed(), '999999999999999999.999999999');
  assert.throws(() => new Decimal('0.1').minus('0.2'), /negative/);
});

test('plain decimal parsing preserves digits and normalizes padding', () => {
  for (const [input, expected] of [
    ['000123.4500', '123.45'], ['0.0000012300', '0.00000123'], ['000.000', '0'],
    ['123456789012345678901234567890.000000000000000000001', '123456789012345678901234567890.000000000000000000001'],
    [0, '0'], [-0, '0'], [123.45, '123.45'],
  ]) assert.equal(new Decimal(input).toFixed(), expected);
  const source = new Decimal('123.456');
  assert.equal(new Decimal(source).toFixed(), '123.456');
  assert.equal(Object.isFrozen(source), true);
  assert.equal(source.decimalPlaces(), 3);
  assert.equal(source.isInteger(), false);
  assert.equal(new Decimal('1.000').isInteger(), true);
  assert.equal(new Decimal('0').isZero(), true);
  assert.equal(new Decimal('0').isPositive(), false);
  assert.equal(new Decimal('1').isPositive(), true);
  assert.equal(source.isFinite(), true);
  assert.equal(source.isNegative(), false);
});

test('finite numeric exponent notation expands without rounding decimal digits', () => {
  assert.equal(new Decimal(1e-9).toFixed(), '0.000000001');
  assert.equal(new Decimal(1.23e-7).toFixed(), '0.000000123');
  assert.equal(new Decimal(1.23e21).toFixed(), '1230000000000000000000');
  assert.equal(new Decimal(Number.MIN_VALUE).toFixed(), `0.${'0'.repeat(323)}5`);
  assert.equal(new Decimal(Number.MAX_VALUE).toFixed(), `17976931348623157${'0'.repeat(292)}`);
});

test('malformed strings and nonfinite or negative numbers cannot enter arithmetic', () => {
  for (const value of ['', '1e3', '1E-3', '0x10', '1_000', 'Infinity', 'NaN', '-1', '+1', ' 1', '1 ', '.5', '1.', '1,5', '1\n', null, undefined, true, {}, [], NaN, Infinity, -Infinity, -1]) {
    assert.throws(() => new Decimal(value), { name: value === -1 ? 'RangeError' : 'TypeError' });
  }
});

test('comparisons distinguish tiny differences after large integer parts', () => {
  const below = new Decimal('123456789012345678901234567890.000000000001');
  const above = new Decimal('123456789012345678901234567890.000000000002');
  assert.equal(below.lt(above), true);
  assert.equal(above.gt(below), true);
  assert.equal(below.eq(below.toFixed()), true);
  assert.equal(new Decimal('000.0100').eq('0.01'), true);
  assert.equal(new Decimal('0').lt('0.00000000000000000001'), true);
  assert.equal(new Decimal('1').gt('0.99999999999999999999999999999999999'), true);
  assert.equal(new Decimal('2').lte('2.00'), true);
  assert.equal(new Decimal('2.00').gte('2'), true);
});

test('multiplication has exact carries across long integer and fractional parts', () => {
  for (const [left, right, expected] of [
    ['0.1', '0.2', '0.02'], ['180.5', '0.55401662', '99.99999991'],
    ['99999999999999999999', '99999999999999999999', '9999999999999999999800000000000000000001'],
    ['123456789012345678901234567890.123456789', '3', '370370367037037036703703703670.370370367'],
    ['0.00000000001', '0.00000000001', '0.0000000000000000000001'],
    ['0', '123.456', '0'],
  ]) {
    const first = new Decimal(left);
    assert.equal(first.times(right).toFixed(), expected);
    assert.equal(new Decimal(right).times(first).toFixed(), expected);
    assert.equal(first.toFixed(), left);
  }
});

test('integer division always rounds down, including recurring and near-integer results', () => {
  for (const [numerator, denominator, expected] of [
    ['1', '3', '0'], ['10', '3', '3'], ['0.3', '0.1', '3'], ['1', '0.07', '14'],
    ['100', '0.0000001805', '554016620'],
    ['999999999999999999999999999999.999999999', '1', '999999999999999999999999999999'],
    ['1', '0.999999999999999999999999999999999999', '1'],
    ['1', '0.000000000000000000000000000003', '333333333333333333333333333333'],
    ['0', '0.0001', '0'], ['1', '1000000', '0'],
  ]) assert.equal(new Decimal(numerator).divToInt(denominator).toFixed(), expected);
  assert.throws(() => new Decimal('1').divToInt(0), /divide by zero/);
});

test('modulo is exact for fractional lot sizes and long values', () => {
  for (const [value, step, expected] of [
    ['3.33', '0.03', '0'], ['3.34', '0.03', '0.01'], ['0.3', '0.1', '0'],
    ['1.000000001', '0.00000001', '0.000000001'],
    ['123456789012345678901234567890.123456789', '0.000000001', '0'],
    ['123456789012345678901234567890.1234567889', '0.000000001', '0.0000000009'],
    ['0.001', '1', '0.001'], ['0', '3', '0'],
  ]) assert.equal(new Decimal(value).mod(step).toFixed(), expected);
  assert.throws(() => new Decimal('0').mod('0'), /divide by zero/);
});

test('decimal digit algorithms agree with independent exact safe-integer calculations', () => {
  // These operands/products remain below Number.MAX_SAFE_INTEGER, so native
  // integer arithmetic is an independent oracle for carries and long division.
  const leftValues = [0, 1, 9, 10, 99, 101, 9999, 120034, 987654321];
  const rightValues = [1, 2, 3, 9, 10, 97, 1234, 99999];
  for (const left of leftValues) {
    for (const right of rightValues) {
      const number = new Decimal(left);
      assert.equal(number.times(right).toFixed(), String(left * right));
      assert.equal(number.divToInt(right).toFixed(), String(Math.floor(left / right)));
      assert.equal(number.mod(right).toFixed(), String(left % right));
    }
  }
});

test('160 deterministic large decimal cases agree with an independent Node BigInt oracle', () => {
  // BigInt is used only by this Node test; production arithmetic stays portable
  // to Apps Script. Oracle operands retain an integer coefficient and scale.
  let seed = 0x51a7c0de;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const integer = (length) => {
    let digits = String(1 + random() % 9);
    for (let index = 1; index < length; index++) digits += String(random() % 10);
    return BigInt(digits);
  };
  const scaleFactor = (scale) => BigInt(10) ** BigInt(scale);
  const format = (coefficient, scale) => {
    if (coefficient === BigInt(0)) return '0';
    const digits = coefficient.toString().padStart(scale + 1, '0');
    if (scale === 0) return digits;
    return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '');
  };
  for (let index = 0; index < 160; index++) {
    const left = index % 17 === 0 ? BigInt(0) : index % 11 === 0 ? BigInt('9'.repeat(97)) : integer(20 + random() % 81);
    const right = integer(20 + random() % 81);
    const leftScale = random() % 111;
    const rightScale = random() % 111;
    const input = new Decimal(format(left, leftScale));
    const operand = format(right, rightScale);
    const commonScale = Math.max(leftScale, rightScale);
    const numerator = left * scaleFactor(commonScale - leftScale);
    const denominator = right * scaleFactor(commonScale - rightScale);
    assert.equal(input.times(operand).toFixed(), format(left * right, leftScale + rightScale), `product case ${index}`);
    assert.equal(input.divToInt(operand).toFixed(), (numerator / denominator).toString(), `quotient case ${index}`);
    assert.equal(input.mod(operand).toFixed(), format(numerator % denominator, commonScale), `remainder case ${index}`);
  }
});
