import Decimal from './decimal.js';

const ORDER_FIELDS = new Set([
  'symbol', 'side', 'orderType', 'quoteAsset', 'price', 'quantity', 'notional',
  'timeInForce', 'tradingSession', 'walletType', 'clientOrderId', 'tokenize', 'recvWindow',
]);
const SIZED_FIELDS = new Set([
  ...ORDER_FIELDS, 'amountInUSD', 'entryPrice',
]);

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function checkFields(params, allowed) {
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) throw new TypeError(`Unknown order parameter: ${key}`);
  }
}

function enumeration(value, values, name) {
  if (!values.includes(value)) throw new TypeError(`${name} must be ${values.join(' or ')}`);
  return value;
}

function symbol(value) {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/.test(value)) {
    throw new TypeError('symbol must be a plain uppercase stock or ETF ticker');
  }
  return value;
}

function decimal(value, name, allowZero = false) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new TypeError(`${name} must be a positive decimal string or number`);
  }
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new TypeError(`${name} must be a plain decimal string`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  const result = new Decimal(value);
  if (!result.isFinite() || result.isNegative() || (!allowZero && result.isZero())) {
    throw new RangeError(`${name} must be ${allowZero ? 'nonnegative' : 'greater than zero'}`);
  }
  return result;
}

function required(params, field) {
  if (params[field] === undefined) throw new TypeError(`${field} is required`);
}

function forbidden(params, fields, description) {
  for (const field of fields) {
    if (params[field] !== undefined) throw new TypeError(`${field} is forbidden for ${description}`);
  }
}

/** Validate placement fields and return a new object ready for rule validation. */
export function validateOrderInput(params) {
  requireObject(params, 'Order');
  checkFields(params, ORDER_FIELDS);
  const result = {
    symbol: symbol(params.symbol),
    side: enumeration(params.side === undefined ? 'BUY' : params.side, ['BUY', 'SELL'], 'side'),
    orderType: enumeration(params.orderType, ['LIMIT', 'MARKET'], 'orderType'),
    quoteAsset: 'USDC',
  };
  if (params.quoteAsset !== undefined && params.quoteAsset !== 'USDC') {
    throw new TypeError('quoteAsset must be USDC');
  }
  result.timeInForce = enumeration(
    params.timeInForce === undefined ? 'DAY' : params.timeInForce, ['DAY', 'GTC'], 'timeInForce',
  );

  if (result.orderType === 'LIMIT') {
    forbidden(params, ['notional'], 'LIMIT orders');
    for (const field of ['price', 'quantity', 'tradingSession']) required(params, field);
    const price = decimal(params.price, 'price');
    if (price.decimalPlaces() > 2) throw new RangeError('price supports at most 2 decimal places');
    result.price = price.toFixed();
    result.quantity = decimal(params.quantity, 'quantity').toFixed();
    result.tradingSession = enumeration(params.tradingSession, ['RTH', 'EXTENDED', '24H'], 'tradingSession');
    if (result.timeInForce === 'GTC' && !new Decimal(result.quantity).isInteger() && result.tradingSession === 'RTH') {
      throw new RangeError('Fractional GTC orders require tradingSession EXTENDED or 24H');
    }
  } else {
    if (result.timeInForce !== 'DAY') throw new TypeError('GTC is only supported for LIMIT orders');
    forbidden(params, ['price', 'tradingSession'], 'MARKET orders');
    const amountField = result.side === 'BUY' ? 'notional' : 'quantity';
    forbidden(params, [result.side === 'BUY' ? 'quantity' : 'notional'], `${result.side} MARKET orders`);
    required(params, amountField);
    result[amountField] = decimal(params[amountField], amountField).toFixed();
  }

  if (params.walletType !== undefined) {
    result.walletType = enumeration(params.walletType, ['CARD', 'MAIN'], 'walletType');
    if (result.side === 'SELL' && result.walletType !== 'CARD') {
      throw new TypeError('SELL orders settle to CARD; walletType MAIN is not supported');
    }
  }
  if (params.clientOrderId !== undefined) {
    if (typeof params.clientOrderId !== 'string' || !/^[a-zA-Z0-9_-]{32,36}$/.test(params.clientOrderId)) {
      throw new TypeError('clientOrderId must contain 32 to 36 letters, digits, underscores, or hyphens');
    }
    result.clientOrderId = params.clientOrderId;
  }
  if (params.tokenize !== undefined) {
    if (typeof params.tokenize !== 'boolean') throw new TypeError('tokenize must be a boolean');
    result.tokenize = params.tokenize;
  }
  if (params.recvWindow !== undefined) {
    if (!Number.isInteger(params.recvWindow) || params.recvWindow < 1 || params.recvWindow > 60000) {
      throw new RangeError('recvWindow must be an integer between 1 and 60000 milliseconds');
    }
    result.recvWindow = params.recvWindow;
  }
  return result;
}

function readRules(info, orderSymbol) {
  requireObject(info, 'symbolInfo');
  if (info.symbol !== orderSymbol) throw new TypeError('symbolInfo must match the order symbol');
  enumeration(info.tradability, ['BUY_SELL', 'BUY', 'SELL', 'NONE'], 'symbolInfo.tradability');
  for (const field of ['fractionable', 'fractionableEh', 'extendedSession', 'overnightSupported']) {
    if (typeof info[field] !== 'boolean') throw new TypeError(`symbolInfo.${field} must be a boolean`);
  }
  const rules = {};
  for (const field of ['stepSize', 'minQty', 'maxQty', 'minNotional', 'maxNotional']) {
    rules[field] = decimal(info[field], `symbolInfo.${field}`, field.startsWith('min'));
  }
  if (rules.minQty.gt(rules.maxQty) || rules.stepSize.gt(rules.maxQty)) {
    throw new RangeError('symbolInfo quantity rules are inconsistent');
  }
  if (rules.minNotional.gt(rules.maxNotional)) throw new RangeError('symbolInfo notional rules are inconsistent');
  return rules;
}

function quotePrice(quote, orderSymbol, side) {
  requireObject(quote, 'A valid current quote');
  if (quote.symbol !== orderSymbol) throw new TypeError('Current quote must match the order symbol');
  const field = side === 'SELL' ? 'bidPrice' : 'askPrice';
  return decimal(quote[field], `Current quote ${field}`);
}

function within(value, minimum, maximum, name) {
  if (value.lt(minimum)) throw new RangeError(`${name} is below the symbol minimum (${minimum.toFixed()})`);
  if (value.gt(maximum)) throw new RangeError(`${name} exceeds the symbol maximum (${maximum.toFixed()})`);
}

/** Enforce the current exchange-info rules without changing caller data. */
export function validateOrderRules(order, symbolInfo, quote = null) {
  const result = validateOrderInput(order);
  const rules = readRules(symbolInfo, result.symbol);
  if (symbolInfo.tradability !== 'BUY_SELL' && symbolInfo.tradability !== result.side) {
    throw new RangeError(`Symbol does not permit ${result.side} orders`);
  }
  if (['EXTENDED', '24H'].includes(result.tradingSession) && !symbolInfo.extendedSession) {
    throw new RangeError('Symbol does not support extended trading sessions');
  }
  if (result.tradingSession === '24H' && !symbolInfo.overnightSupported) {
    throw new RangeError('Symbol does not support overnight trading');
  }
  const quantity = result.quantity === undefined ? null : new Decimal(result.quantity);
  const fractional = quantity === null || !quantity.isInteger();
  if (fractional) {
    const extended = ['EXTENDED', '24H'].includes(result.tradingSession);
    const supported = extended ? symbolInfo.fractionableEh : symbolInfo.fractionable;
    if (!supported) {
      throw new RangeError(`Symbol does not support fractional shares${extended ? ' in extended hours' : ' in the regular session'}`);
    }
  }

  if (quantity !== null) {
    within(quantity, rules.minQty, rules.maxQty, 'quantity');
    if (!quantity.mod(rules.stepSize).isZero()) {
      throw new RangeError(`quantity must be a multiple of stepSize (${rules.stepSize.toFixed()})`);
    }
  }
  let notional;
  if (result.notional !== undefined) {
    notional = new Decimal(result.notional);
  } else {
    const price = result.orderType === 'LIMIT' ? new Decimal(result.price) : quotePrice(quote, result.symbol, result.side);
    notional = quantity.times(price);
  }
  within(notional, rules.minNotional, rules.maxNotional, 'USD notional');
  return result;
}

/** Convert a USD target into Binance fields, rounding share quantity down. */
export function createSizedOrder(params, symbolInfo, quote = null) {
  requireObject(params, 'Order');
  checkFields(params, SIZED_FIELDS);
  if (typeof params.amountInUSD !== 'number' || !Number.isFinite(params.amountInUSD) || params.amountInUSD <= 0) {
    throw new TypeError('amountInUSD must be a finite JavaScript number greater than zero');
  }
  forbidden(params, ['price', 'quantity', 'notional'], 'amountInUSD sizing; use entryPrice for LIMIT orders');
  const { amountInUSD, entryPrice, ...options } = params;
  let order;
  if (options.orderType === 'LIMIT') {
    order = validateOrderInput({ ...options, price: entryPrice, quantity: '1' });
  } else {
    if (entryPrice !== undefined) throw new TypeError('entryPrice is forbidden for MARKET orders');
    const amountField = options.side === 'SELL' ? 'quantity' : 'notional';
    order = validateOrderInput({ ...options, [amountField]: amountField === 'notional' ? amountInUSD : '1' });
  }
  if (order.orderType === 'MARKET' && order.side === 'BUY') {
    return validateOrderRules(order, symbolInfo, quote);
  }
  const rules = readRules(symbolInfo, order.symbol);
  const price = order.orderType === 'LIMIT' ? new Decimal(order.price) : quotePrice(quote, order.symbol, order.side);
  const lotCost = price.times(rules.stepSize);
  const quantity = new Decimal(amountInUSD).divToInt(lotCost).times(rules.stepSize);
  if (quantity.isZero()) throw new RangeError('amountInUSD rounds down to zero quantity');
  order.quantity = quantity.toFixed();
  return validateOrderRules(order, symbolInfo, quote);
}
