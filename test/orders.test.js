import test from 'node:test';
import assert from 'node:assert/strict';
import { createSizedOrder, validateOrderInput, validateOrderRules } from '../src/orders.js';

const rules = Object.freeze({
  symbol: 'AAPL', tradability: 'BUY_SELL', fractionable: true, fractionableEh: true,
  extendedSession: true, overnightSupported: true, stepSize: '0.000000001',
  minQty: '0.000000001', maxQty: '100000', minNotional: '1', maxNotional: '1000000',
});
const limit = Object.freeze({
  symbol: 'AAPL', side: 'BUY', orderType: 'LIMIT', price: '180.50', quantity: '1', tradingSession: 'RTH',
});
const quote = Object.freeze({ symbol: 'AAPL', bidPrice: '180.50', askPrice: '180.52' });

test('all four order combinations produce valid USDC request fields', () => {
  for (const side of ['BUY', 'SELL']) {
    const result = validateOrderRules({ ...limit, side }, rules);
    assert.equal(result.side, side);
    assert.equal(result.price, '180.5');
    assert.equal(result.quantity, '1');
    assert.equal(result.quoteAsset, 'USDC');
    assert.equal(result.timeInForce, 'DAY');
    assert.equal(result.tradingSession, 'RTH');
    assert.equal('notional' in result, false);
  }
  assert.deepEqual(validateOrderRules({ symbol: 'AAPL', orderType: 'MARKET', notional: 100 }, rules), {
    symbol: 'AAPL', side: 'BUY', orderType: 'MARKET', quoteAsset: 'USDC', timeInForce: 'DAY', notional: '100',
  });
  assert.deepEqual(validateOrderRules({ symbol: 'AAPL', side: 'SELL', orderType: 'MARKET', quantity: 2 }, rules, quote), {
    symbol: 'AAPL', side: 'SELL', orderType: 'MARKET', quoteAsset: 'USDC', timeInForce: 'DAY', quantity: '2',
  });
});

test('rejects non-USDC funding and invalid required fields before placement', () => {
  for (const quoteAsset of ['USD', 'USDT', 'usdc', '', null]) {
    assert.throws(() => validateOrderInput({ ...limit, quoteAsset }), /quoteAsset must be USDC/);
  }
  for (const ticker of ['aapl', 'AAPL/USDC', 'NASDAQ:AAPL', ' AAPL ', '', 42, null]) {
    assert.throws(() => validateOrderInput({ ...limit, symbol: ticker }), /ticker/);
  }
  assert.equal(validateOrderInput({ ...limit, symbol: 'BRK.B' }).symbol, 'BRK.B');
  for (const field of ['symbol', 'orderType', 'price', 'quantity', 'tradingSession']) {
    const params = { ...limit };
    delete params[field];
    assert.throws(() => validateOrderInput(params));
  }
  for (const [field, value] of [['side', 'buy'], ['orderType', 'STOP'], ['tradingSession', 'ALL'], ['timeInForce', 'IOC']]) {
    assert.throws(() => validateOrderInput({ ...limit, [field]: value }), new RegExp(field));
  }
});

test('enforces the documented order field matrix and rejects ignored mistakes', () => {
  assert.throws(() => validateOrderInput({ ...limit, notional: 100 }), /notional is forbidden/);
  const marketBuy = { symbol: 'AAPL', orderType: 'MARKET', notional: 100 };
  const marketSell = { symbol: 'AAPL', side: 'SELL', orderType: 'MARKET', quantity: 1 };
  for (const [base, forbidden] of [[marketBuy, ['price', 'quantity', 'tradingSession']], [marketSell, ['price', 'notional', 'tradingSession']]]) {
    for (const field of forbidden) {
      assert.throws(() => validateOrderInput({ ...base, [field]: '1' }), new RegExp(`${field} is forbidden`));
    }
  }
  for (const params of [marketBuy, marketSell]) {
    assert.throws(() => validateOrderInput({ ...params, timeInForce: 'GTC' }), /GTC/);
  }
  for (const field of ['amountInUSD', 'entryPrice', 'type', 'fee', 'timestamp', 'signature']) {
    assert.throws(() => validateOrderInput({ ...limit, [field]: 1 }), /Unknown order parameter/);
  }
});

test('decimal input is normalized without rounding the submitted limit price', () => {
  assert.equal(validateOrderInput({ ...limit, price: '000180.5000', quantity: '01.0000' }).price, '180.5');
  assert.throws(() => validateOrderInput({ ...limit, price: '180.501' }), /2 decimal places/);
  for (const value of [NaN, Infinity, -Infinity, 0, -1, '', '1e2', '0x10', ' 1', '1,00', true, null, {}, []]) {
    assert.throws(() => validateOrderInput({ ...limit, quantity: value }));
  }
  assert.equal(validateOrderInput({ ...limit, quantity: 1e-9 }).quantity, '0.000000001');
});

test('client identifiers, wallet behavior, tokenize and recvWindow are explicit', () => {
  const clientOrderId = 'client_0123456789012345678901234567';
  const params = { ...limit, clientOrderId, walletType: 'MAIN', tokenize: false, recvWindow: 60000 };
  const result = validateOrderInput(Object.freeze(params));
  assert.equal(result.clientOrderId, clientOrderId);
  assert.equal(result.walletType, 'MAIN');
  assert.equal(result.tokenize, false);
  assert.equal(result.recvWindow, 60000);
  assert.equal(params.quoteAsset, undefined);
  for (const value of ['', 'x'.repeat(31), 'x'.repeat(37), '!'.repeat(32), 123]) {
    assert.throws(() => validateOrderInput({ ...limit, clientOrderId: value }), /clientOrderId/);
  }
  for (const value of ['true', 1, null]) assert.throws(() => validateOrderInput({ ...limit, tokenize: value }), /tokenize/);
  for (const value of [0, -1, 60001, 1.5, '5000', NaN]) assert.throws(() => validateOrderInput({ ...limit, recvWindow: value }), /recvWindow/);
  assert.throws(() => validateOrderInput({ ...limit, walletType: 'SPOT' }), /walletType/);
  assert.throws(() => validateOrderInput({ ...limit, side: 'SELL', walletType: 'MAIN' }), /settle to CARD/);
  assert.equal(validateOrderInput({ ...limit, side: 'SELL', walletType: 'CARD' }).walletType, 'CARD');
});

test('limit amountInUSD sizing uses exact division and rounds down to stepSize', () => {
  for (const side of ['BUY', 'SELL']) {
    const result = createSizedOrder({ symbol: 'AAPL', side, orderType: 'LIMIT', amountInUSD: 100, entryPrice: '180.50', tradingSession: 'RTH' }, rules);
    assert.equal(result.quantity, '0.55401662');
    assert.equal(result.price, '180.5');
    assert.equal(result.quoteAsset, 'USDC');
    assert.equal('amountInUSD' in result, false);
    assert.equal('entryPrice' in result, false);
  }
  const smallRules = { ...rules, minNotional: '0' };
  const exact = createSizedOrder({ symbol: 'AAPL', orderType: 'LIMIT', amountInUSD: 0.3, entryPrice: '0.10', tradingSession: 'RTH' }, smallRules);
  assert.equal(exact.quantity, '3');
  const unusualStep = createSizedOrder({ symbol: 'AAPL', orderType: 'LIMIT', amountInUSD: 10, entryPrice: 3, tradingSession: 'RTH' }, { ...rules, stepSize: '0.03' });
  assert.equal(unusualStep.quantity, '3.33');
  const repeating = createSizedOrder({ symbol: 'AAPL', orderType: 'LIMIT', amountInUSD: 1, entryPrice: '0.07', tradingSession: 'RTH' }, smallRules);
  assert.equal(repeating.quantity, '14.285714285');
});

test('market buy maps USD amount directly to notional without requiring a quote', () => {
  const order = createSizedOrder({ symbol: 'AAPL', orderType: 'MARKET', amountInUSD: 123.45, walletType: 'MAIN' }, rules);
  assert.deepEqual(order, {
    symbol: 'AAPL', side: 'BUY', orderType: 'MARKET', quoteAsset: 'USDC', timeInForce: 'DAY', notional: '123.45', walletType: 'MAIN',
  });
});

test('market sell uses bid and rejects unavailable or mismatched quotes', () => {
  const params = { symbol: 'AAPL', side: 'SELL', orderType: 'MARKET', amountInUSD: 100 };
  assert.equal(createSizedOrder(params, rules, quote).quantity, '0.55401662');
  assert.equal(createSizedOrder(params, rules, { ...quote, askPrice: '999' }).quantity, '0.55401662');
  for (const unavailable of [null, undefined, {}, { ...quote, symbol: 'SPY' }, { ...quote, bidPrice: '0' }, { ...quote, bidPrice: '-1' }, { ...quote, bidPrice: NaN }]) {
    assert.throws(() => createSizedOrder(params, rules, unavailable));
  }
  assert.throws(() => validateOrderRules({ symbol: 'AAPL', side: 'SELL', orderType: 'MARKET', quantity: 1 }, rules), /quote/);
});

test('amountInUSD must be a finite positive JavaScript number with no conflicting fields', () => {
  const params = { symbol: 'AAPL', orderType: 'LIMIT', amountInUSD: 100, entryPrice: 180.5, tradingSession: 'RTH' };
  for (const amountInUSD of ['100', NaN, Infinity, -Infinity, 0, -0, -1, null, undefined, {}, []]) {
    assert.throws(() => createSizedOrder({ ...params, amountInUSD }, rules), /amountInUSD/);
  }
  for (const field of ['price', 'quantity', 'notional']) {
    assert.throws(() => createSizedOrder({ ...params, [field]: 100 }, rules), /forbidden/);
  }
  assert.throws(() => createSizedOrder({ ...params, typo: true }, rules), /Unknown order parameter/);
  assert.throws(() => createSizedOrder({ ...params, entryPrice: 180.501 }, rules), /2 decimal places/);
  assert.throws(() => createSizedOrder({ symbol: 'AAPL', orderType: 'MARKET', amountInUSD: 100, entryPrice: 180.5 }, rules), /entryPrice is forbidden/);
});

test('rounded quantities never increase to satisfy minimums or whole-share restrictions', () => {
  const params = { symbol: 'AAPL', orderType: 'LIMIT', amountInUSD: 1, entryPrice: 3, tradingSession: 'RTH' };
  assert.throws(() => createSizedOrder(params, { ...rules, stepSize: '0.01' }), /notional is below/);
  assert.throws(() => createSizedOrder({ ...params, amountInUSD: 0.01 }, { ...rules, stepSize: '1' }), /zero quantity/);
  assert.throws(() => createSizedOrder({ ...params, amountInUSD: 4 }, { ...rules, fractionable: false }), /fractional shares/);
});

test('quantity and notional limits include exact boundaries and reject misaligned lots', () => {
  const bounded = { ...rules, stepSize: '0.1', minQty: '0.5', maxQty: '2', minNotional: '5', maxNotional: '20' };
  const order = { ...limit, price: '10', quantity: '0.5' };
  assert.equal(validateOrderRules(order, bounded).quantity, '0.5');
  assert.equal(validateOrderRules({ ...order, quantity: '2' }, bounded).quantity, '2');
  assert.throws(() => validateOrderRules({ ...order, quantity: '0.4' }, bounded), /quantity is below/);
  assert.throws(() => validateOrderRules({ ...order, quantity: '2.1' }, bounded), /quantity exceeds/);
  assert.throws(() => validateOrderRules({ ...order, quantity: '0.55' }, bounded), /stepSize/);
  assert.throws(() => validateOrderRules({ ...order, price: '9.99' }, bounded), /notional is below/);
  assert.throws(() => validateOrderRules({ ...order, price: '10.01', quantity: '2' }, bounded), /notional exceeds/);
  assert.throws(() => createSizedOrder({ symbol: 'AAPL', orderType: 'MARKET', amountInUSD: 20.01 }, bounded), /notional exceeds/);
});

test('long decimal inputs retain every digit in quantity and notional checks', () => {
  const quantity = '123456789012345678901234567890.123456789';
  const largeRules = { ...rules, maxQty: quantity, maxNotional: quantity };
  assert.equal(validateOrderRules({ ...limit, price: '1', quantity }, largeRules).quantity, quantity);
  assert.throws(() => validateOrderRules({ ...limit, price: '1', quantity: '123456789012345678901234567890.1234567889' }, largeRules), /stepSize/);
  const exactMaximum = '370370367037037036703703703670.370370367';
  assert.equal(validateOrderRules({ ...limit, price: '3', quantity }, { ...largeRules, maxNotional: exactMaximum }).quantity, quantity);
  assert.throws(() => validateOrderRules({ ...limit, price: '3', quantity }, { ...largeRules, maxNotional: '370370367037037036703703703670.370370366' }), /notional exceeds/);
});

test('tradability, session and fractional GTC rules are enforced', () => {
  for (const tradability of ['SELL', 'NONE']) assert.throws(() => validateOrderRules(limit, { ...rules, tradability }), /does not permit BUY/);
  assert.equal(validateOrderRules(limit, { ...rules, tradability: 'BUY' }).side, 'BUY');
  assert.throws(() => validateOrderRules({ ...limit, tradingSession: 'EXTENDED' }, { ...rules, extendedSession: false }), /extended trading/);
  assert.throws(() => validateOrderRules({ ...limit, tradingSession: '24H' }, { ...rules, overnightSupported: false }), /overnight/);
  assert.throws(() => validateOrderRules({ ...limit, quantity: '0.5' }, { ...rules, fractionable: false }), /fractional shares/);
  assert.throws(() => validateOrderRules({ symbol: 'AAPL', orderType: 'MARKET', notional: '180.50' }, { ...rules, fractionable: false }), /fractional shares/);
  assert.throws(() => validateOrderRules({ ...limit, quantity: '0.5', tradingSession: 'EXTENDED' }, { ...rules, fractionableEh: false }), /extended hours/);
  assert.throws(() => validateOrderInput({ ...limit, quantity: '0.5', timeInForce: 'GTC' }), /Fractional GTC/);
  assert.equal(validateOrderRules({ ...limit, timeInForce: 'GTC' }, rules).timeInForce, 'GTC');
  for (const tradingSession of ['EXTENDED', '24H']) {
    assert.equal(validateOrderRules({ ...limit, quantity: '0.5', timeInForce: 'GTC', tradingSession }, rules).quantity, '0.5');
  }
});

test('fractional eligibility follows the selected session flag', () => {
  const extendedOnly = { ...rules, fractionable: false, fractionableEh: true };
  const regularOnly = { ...rules, fractionable: true, fractionableEh: false };
  const fractional = { ...limit, quantity: '0.5' };
  for (const tradingSession of ['EXTENDED', '24H']) {
    assert.equal(validateOrderRules({ ...fractional, tradingSession }, extendedOnly).quantity, '0.5');
    assert.throws(() => validateOrderRules({ ...fractional, tradingSession }, regularOnly), /extended hours/);
  }
  assert.throws(() => validateOrderRules(fractional, extendedOnly), /regular session/);
  assert.equal(validateOrderRules(fractional, regularOnly).quantity, '0.5');
  const marketBuy = { symbol: 'AAPL', orderType: 'MARKET', notional: '100' };
  const marketSell = { symbol: 'AAPL', side: 'SELL', orderType: 'MARKET', quantity: '0.5' };
  for (const market of [marketBuy, marketSell]) {
    assert.throws(() => validateOrderRules(market, extendedOnly, quote), /regular session/);
    assert.equal(validateOrderRules(market, regularOnly, quote).orderType, 'MARKET');
  }
});

test('missing or malformed exchange rules cannot silently disable order validation', () => {
  for (const field of ['symbol', 'tradability', 'fractionable', 'fractionableEh', 'extendedSession', 'overnightSupported', 'stepSize', 'minQty', 'maxQty', 'minNotional', 'maxNotional']) {
    const missing = { ...rules };
    delete missing[field];
    assert.throws(() => validateOrderRules(limit, missing), new RegExp(`symbolInfo|${field}`));
  }
  for (const override of [
    { symbol: 'SPY' }, { tradability: 'TRADING' }, { fractionable: 'true' }, { stepSize: '0' },
    { stepSize: '-1' }, { stepSize: '100001' }, { maxQty: '0' }, { minQty: '100001' },
    { minNotional: '1000001' }, { maxNotional: 'NaN' },
  ]) assert.throws(() => validateOrderRules(limit, { ...rules, ...override }));
});
