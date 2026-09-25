import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import BinanceStocks, { BinanceAPIError, RateLimitError, ResponseError, UnknownExecutionError } from '../index.js';
import CoreBinanceStocks from '../src/BinanceStocks.js';

const API_KEY = 'offline-key-fixture';
const API_SECRET = 'offline-hmac-fixture';
const NOW = 1770736694138;
const GENERATED_ID = '00000000-0000-4000-8000-000000000001';
const SUPPLIED_ID = '11111111-1111-4111-8111-111111111111';
const PREFIX = '/sapi/v1/equity/';
const RULES = Object.freeze({
  symbol: 'AAPL', name: 'Apple Inc.', tradability: 'BUY_SELL',
  fractionable: true, fractionableEh: true, extendedSession: true, overnightSupported: true,
  stepSize: '0.000000001', minQty: '0.000000001', maxQty: '100000',
  minNotional: '1', maxNotional: '1000000',
});
const QUOTE = Object.freeze({ symbol: 'AAPL', bidPrice: '180.50', askPrice: '180.52' });
const LIMIT = Object.freeze({
  symbol: 'AAPL', side: 'BUY', orderType: 'LIMIT', price: '180.50', quantity: '1',
  tradingSession: 'RTH', clientOrderId: SUPPLIED_ID,
});
const SIZED_LIMIT = Object.freeze({
  symbol: 'AAPL', amountInUSD: 100, entryPrice: '180.50', tradingSession: 'RTH', clientOrderId: SUPPLIED_ID,
});

function http(body, status = 200, headers = {}) {
  return { status, headers, text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
}

function defaultResponse(call) {
  const { path, query } = call;
  switch (path) {
    case 'market/exchangeInfo': {
      const symbols = [RULES, { ...RULES, symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust' }];
      return http({ timezone: 'America/New_York', symbols: query.symbol ? symbols.filter(item => item.symbol === query.symbol) : symbols });
    }
    case 'market/quote': return http({ ...QUOTE, symbol: query.symbol });
    case 'market/tokenized-assets': return http([{
      assetCode: 'AAPLB', assetName: 'Apple Inc. Tokenized Stock',
      underlyingEquitySymbol: 'AAPL', multiplier: '1', multiplierValid: true,
    }]);
    case 'order/place': return http({ status: 'S', orderId: 'order-001', clientOrderId: query.clientOrderId });
    case 'order/cancel': return http({ status: 'S', orderId: query.orderId });
    case 'order/cancel-all': return http({ success: true });
    case 'order/open-orders': return http([]);
    case 'order/detail': return http({ orderId: 'order-001', clientOrderId: SUPPLIED_ID, status: 'ACCEPTED', trades: [] });
    case 'order/history':
    case 'trade/history': return http({ total: 0, page: Number(query.current ?? 1), size: Number(query.size ?? 20), rows: [] });
    case 'tokenized/mint':
    case 'tokenized/redeem': return http({ issuerRequestId: 'conversion-001', status: 'P' });
    case 'tokenized/convert-status': return http({});
    case 'tokenized/history': return http({ rows: [], hasMore: false, nextLastId: null });
    case 'account/disclaimer': return http({ success: true });
    case 'listenKey': return http({ listenKey: 'offline-listen-key' });
    case 'asset/get-funding-asset': return http([{ asset: 'USDC', free: '900', locked: '100', freeze: '0', withdrawing: '0' }]);
    default: throw new Error(`Unexpected mocked route: ${path}`);
  }
}

function harness({ responder, options = {}, Client = BinanceStocks } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.binance.com');
    assert.ok(parsed.pathname.startsWith(PREFIX) || parsed.pathname === '/sapi/v1/asset/get-funding-asset');
    const path = parsed.pathname.startsWith(PREFIX) ? parsed.pathname.slice(PREFIX.length) : 'asset/get-funding-asset';
    const call = { url, init, path, query: Object.fromEntries(parsed.searchParams) };
    calls.push(call);
    return responder ? responder(call, defaultResponse) : defaultResponse(call);
  };
  const client = new Client({ apiKey: API_KEY, apiSecret: API_SECRET, now: () => NOW, fetch, ...options });
  return { client, calls };
}

function businessParams(call) {
  const { timestamp, recvWindow, signature, ...params } = call.query;
  return params;
}

function assertSecurity(call, security) {
  assert.equal(call.init.headers['X-MBX-APIKEY'], API_KEY);
  assert.equal(call.init.redirect, 'error');
  if (security === 'MARKET_DATA') {
    assert.equal(call.query.timestamp, undefined);
    assert.equal(call.query.recvWindow, undefined);
    assert.equal(call.query.signature, undefined);
  } else {
    assert.equal(call.query.timestamp, String(NOW));
    assert.equal(call.query.recvWindow, '5000');
    if (security === 'USER_STREAM') assert.equal(call.query.signature, undefined);
    else {
      const encoded = call.url.slice(call.url.indexOf('?') + 1);
      const payload = encoded.slice(0, encoded.lastIndexOf('&signature='));
      assert.equal(call.query.signature, createHmac('sha256', API_SECRET).update(payload).digest('hex'));
    }
  }
}

test('REST endpoints use their documented path, HTTP method and security', async (t) => {
  const cases = [
    ['getExchangeInfo', [], 'market/exchangeInfo', 'GET', 'MARKET_DATA', {}],
    ['getSymbolInfo', ['AAPL'], 'market/exchangeInfo', 'GET', 'MARKET_DATA', { symbol: 'AAPL' }],
    ['getTokenizedAssets', [], 'market/tokenized-assets', 'GET', 'MARKET_DATA', {}],
    ['getQuote', ['AAPL'], 'market/quote', 'GET', 'MARKET_DATA', { symbol: 'AAPL' }],
    ['placeOrder', [LIMIT], 'order/place', 'POST', 'TRADE', { symbol: 'AAPL', side: 'BUY', orderType: 'LIMIT', quoteAsset: 'USDC', price: '180.5', quantity: '1', tradingSession: 'RTH', timeInForce: 'DAY', clientOrderId: SUPPLIED_ID }],
    ['cancelOrder', [{ orderId: 'order-001' }], 'order/cancel', 'POST', 'TRADE', { orderId: 'order-001' }],
    ['cancelAllOrders', [], 'order/cancel-all', 'POST', 'TRADE', {}],
    ['getOpenOrders', [], 'order/open-orders', 'GET', 'USER_DATA', {}],
    ['getOrderHistory', [{ startTime: 10, endTime: 20 }], 'order/history', 'GET', 'USER_DATA', { startTime: '10', endTime: '20' }],
    ['getOrder', [{ orderId: 'order-001' }], 'order/detail', 'GET', 'USER_DATA', { orderId: 'order-001' }],
    ['getTradeHistory', [{ startTime: 10, endTime: 20 }], 'trade/history', 'GET', 'USER_DATA', { startTime: '10', endTime: '20' }],
    ['mintTokenized', [{ underlyingAsset: 'AAPL', underlyingAssetAmount: '1', clientOrderId: SUPPLIED_ID }], 'tokenized/mint', 'POST', 'TRADE', { underlyingAsset: 'AAPL', underlyingAssetAmount: '1', clientOrderId: SUPPLIED_ID }],
    ['redeemTokenized', [{ tokenizedAsset: 'AAPLB', tokenizedAssetAmount: '1', clientOrderId: SUPPLIED_ID }], 'tokenized/redeem', 'POST', 'TRADE', { tokenizedAsset: 'AAPLB', tokenizedAssetAmount: '1', clientOrderId: SUPPLIED_ID }],
    ['getConversionStatus', [{ issuerRequestId: 'conversion-001', convertType: 'MINT' }], 'tokenized/convert-status', 'GET', 'USER_DATA', { issuerRequestId: 'conversion-001', convertType: 'MINT' }],
    ['getConversionHistory', [], 'tokenized/history', 'GET', 'USER_DATA', {}],
    ['acceptDisclaimer', [{ accepted: true }], 'account/disclaimer', 'POST', 'TRADE', {}],
    ['createListenKey', [], 'listenKey', 'POST', 'USER_STREAM', {}],
    ['getFundingWallet', [], 'asset/get-funding-asset', 'POST', 'USER_DATA', { asset: 'USDC' }],
  ];
  for (const [method, args, path, verb, security, expected] of cases) {
    await t.test(method, async () => {
      const { client, calls } = harness();
      await client[method](...args);
      const call = calls.at(-1);
      assert.equal(call.path, path);
      assert.equal(call.init.method, verb);
      assert.deepEqual(businessParams(call), expected);
      assertSecurity(call, security);
      for (const preflight of calls.slice(0, -1)) assertSecurity(preflight, 'MARKET_DATA');
      assert.equal(calls.length, method === 'placeOrder' ? 2 : 1);
    });
  }
});

test('constructor validates options, USDC and runtime configuration without making requests', () => {
  const neverFetch = () => { throw new Error('Constructor must not fetch'); };
  for (const options of [null, [], 'key', 3, false]) assert.throws(() => new BinanceStocks(options), TypeError);
  for (const options of [
    { quoteAsset: 'USD' }, { quoteAsset: 'USDT' }, { quoteAsset: null }, { symbol: 'AAPL' },
    { symbol: 'aapl' }, { symbol: 'AAPL/USDC' }, { unknown: true }, { recvWindow: 0 }, { recvWindow: 60001 },
    { rateLimitFallbackMs: 0 }, { now: NOW }, { fetch: true }, { sign: true },
    { baseUrl: 'http://api.binance.com' }, { baseUrl: 'https://api.binance.com/sapi' },
  ]) assert.throws(() => new BinanceStocks({ fetch: neverFetch, ...options }));
  const client = new BinanceStocks({ apiKey: API_KEY, fetch: neverFetch });
  assert.equal(client.quoteAsset, 'USDC');
  assert.equal(client.symbol, undefined);
  assert.throws(() => { client.quoteAsset = 'USD'; }, TypeError);
});

test('one client handles multiple explicit symbols and rejects missing symbols', async () => {
  const { client, calls } = harness();
  assert.equal((await client.getQuote('AAPL')).symbol, 'AAPL');
  assert.equal((await client.getQuote('SPY')).symbol, 'SPY');
  assert.equal((await client.getSymbolInfo('AAPL')).symbol, 'AAPL');
  assert.equal((await client.getSymbolInfo('SPY')).symbol, 'SPY');
  await client.getExchangeInfo();
  assert.deepEqual(businessParams(calls.at(-1)), {});
  const acknowledgement = await client.createMarketOrder({ symbol: 'SPY', amountInUSD: 100 });
  assert.equal(acknowledgement.status, 'S');
  assert.equal(calls.at(-1).query.symbol, 'SPY');
  assert.equal(client.symbol, undefined);

  const beforeMissing = calls.length;
  for (const invoke of [() => client.getQuote(), () => client.getSymbolInfo(), () => client.createMarketOrder({ amountInUSD: 100 }), () => client.createLimitOrder({ ...SIZED_LIMIT, symbol: undefined }), () => client.placeOrder({ ...LIMIT, symbol: undefined })]) {
    await assert.rejects(invoke, /symbol/);
  }
  assert.equal(calls.length, beforeMissing);
});

test('exchange info always fetches all symbols; symbol info caches each ticker and refreshes on request', async () => {
  const { client, calls } = harness();
  assert.deepEqual((await client.getExchangeInfo()).symbols.map(item => item.symbol), ['AAPL', 'SPY']);
  await client.getExchangeInfo();
  assert.deepEqual(calls.map(call => call.query.symbol), [undefined, undefined]);
  await client.getSymbolInfo('AAPL');
  await client.getSymbolInfo('AAPL');
  assert.equal(calls.filter(call => call.query.symbol === 'AAPL').length, 1);
  await client.getSymbolInfo('SPY');
  await client.getSymbolInfo('AAPL', { refresh: true });
  assert.deepEqual(calls.filter(call => call.path === 'market/exchangeInfo').map(call => call.query.symbol),
    [undefined, undefined, 'AAPL', 'SPY', 'AAPL']);
  await client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100 });
  assert.equal(calls.filter(call => call.path === 'market/exchangeInfo').length, 6,
    'Order placement must fetch current symbol rules despite a cache hit.');
  await client.getTokenizedAssets();
  await client.getTokenizedAssets();
  await client.getTokenizedAssets({ refresh: true });
  assert.equal(calls.filter(call => call.path === 'market/tokenized-assets').length, 2);
  await client.getQuote('AAPL');
  await client.getQuote('AAPL');
  assert.equal(calls.filter(call => call.path === 'market/quote').length, 2);
});

test('getExchangeInfo rejects removed symbol and refresh options before requesting metadata', async () => {
  const { client, calls } = harness();
  await assert.rejects(() => client.getExchangeInfo({ symbol: 'AAPL' }), /Unknown/);
  await assert.rejects(() => client.getExchangeInfo({ refresh: true }), /Unknown/);
  assert.equal(calls.length, 0);
});

test('key-only clients can read market data and renew listen keys but cannot sign private requests', async () => {
  const { client, calls } = harness({ options: { apiSecret: undefined } });
  await client.getExchangeInfo();
  await client.getTokenizedAssets();
  await client.getQuote('AAPL');
  await client.createListenKey({ recvWindow: 60000 });
  assert.equal(calls.at(-1).query.recvWindow, '60000');
  assert.equal(calls.at(-1).query.timestamp, String(NOW));
  assert.ok(calls.every(call => !('signature' in call.query)));
  await assert.rejects(() => client.getOpenOrders(), /apiSecret|sign adapter/);
  assert.equal(calls.length, 4);
  const missing = harness({ options: { apiKey: undefined } });
  await assert.rejects(() => missing.client.getQuote('AAPL'), /apiKey/);
  assert.equal(missing.calls.length, 0);
});

test('limit helpers round down exactly and submit USDC sizing without helper-only parameters', async () => {
  for (const side of ['BUY', 'SELL']) {
    const { client, calls } = harness();
    const input = Object.freeze({ ...SIZED_LIMIT, side, recvWindow: 4500, tokenize: false });
    const acknowledgement = await client.createLimitOrder(input);
    assert.equal(acknowledgement.status, 'S');
    assert.equal(acknowledgement.clientOrderId, SUPPLIED_ID);
    assert.deepEqual(businessParams(calls.at(-1)), {
      symbol: 'AAPL', side, orderType: 'LIMIT', quoteAsset: 'USDC',
      price: '180.5', quantity: '0.55401662', tradingSession: 'RTH', timeInForce: 'DAY',
      tokenize: 'false', clientOrderId: SUPPLIED_ID,
    });
    assert.equal(calls.at(-1).query.recvWindow, '4500');
    assert.deepEqual(calls.map(call => call.path), ['market/exchangeInfo', 'order/place']);
    assert.equal(input.amountInUSD, 100);
    assert.equal(input.entryPrice, '180.50');
  }
});

test('market buy uses USD notional while sell sizes against current bid with exact downward rounding', async () => {
  const buy = harness();
  await buy.client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 123.45, clientOrderId: SUPPLIED_ID });
  assert.deepEqual(businessParams(buy.calls.at(-1)), {
    symbol: 'AAPL', side: 'BUY', orderType: 'MARKET', quoteAsset: 'USDC',
    timeInForce: 'DAY', notional: '123.45', clientOrderId: SUPPLIED_ID,
  });
  assert.deepEqual(buy.calls.map(call => call.path), ['market/exchangeInfo', 'order/place']);
  const sell = harness();
  await sell.client.createMarketOrder({ symbol: 'AAPL', side: 'SELL', amountInUSD: 100, clientOrderId: SUPPLIED_ID });
  assert.deepEqual(businessParams(sell.calls.at(-1)), {
    symbol: 'AAPL', side: 'SELL', orderType: 'MARKET', quoteAsset: 'USDC',
    timeInForce: 'DAY', quantity: '0.55401662', clientOrderId: SUPPLIED_ID,
  });
  assert.deepEqual(sell.calls.map(call => call.path), ['market/exchangeInfo', 'market/quote', 'order/place']);
});

test('public order helpers reject non-USDC, invalid amount inputs and forbidden fields before placement', async () => {
  for (const quoteAsset of ['USD', 'USDT', 'usdc', null]) {
    const { client, calls } = harness();
    await assert.rejects(() => client.placeOrder({ ...LIMIT, quoteAsset }), /USDC/);
    await assert.rejects(() => client.createLimitOrder({ ...SIZED_LIMIT, quoteAsset }), /USDC/);
    await assert.rejects(() => client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100, quoteAsset }), /USDC/);
    assert.equal(calls.length, 0);
  }
  for (const amountInUSD of ['100', 0, -1, NaN, Infinity, undefined]) {
    const { client, calls } = harness();
    await assert.rejects(() => client.createLimitOrder({ ...SIZED_LIMIT, amountInUSD }), /amountInUSD/);
    await assert.rejects(() => client.createMarketOrder({ symbol: 'AAPL', amountInUSD }), /amountInUSD/);
    assert.equal(calls.length, 0);
  }
  const { client, calls } = harness();
  await assert.rejects(() => client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100, tradingSession: 'RTH' }), /Unknown/);
  await assert.rejects(() => client.createLimitOrder({ ...SIZED_LIMIT, quantity: '10' }), /Unknown/);
  await assert.rejects(() => client.placeOrder({ ...LIMIT, amountInUSD: 100 }), /Unknown/);
  assert.equal(calls.length, 0);
});

test('missing quotes and exchange rules prevent market-sell or limit mutations', async () => {
  for (const body of ['', '{}', '{"symbol":"SPY","bidPrice":"180.50"}', '{"symbol":"AAPL","bidPrice":"0"}']) {
    const { client, calls } = harness({ responder: (call, fallback) => call.path === 'market/quote' ? http(body) : fallback(call) });
    await assert.rejects(() => client.createMarketOrder({ symbol: 'AAPL', side: 'SELL', amountInUSD: 100 }));
    assert.ok(calls.every(call => call.init.method === 'GET'));
  }
  const missing = harness({ responder: (call, fallback) => call.path === 'market/exchangeInfo' ? http({ symbols: [] }) : fallback(call) });
  await assert.rejects(() => missing.client.createLimitOrder(SIZED_LIMIT), /No active exchange information/);
  assert.equal(missing.calls.length, 1);
  const malformed = harness({ responder: () => http({ unexpected: [] }) });
  await assert.rejects(() => malformed.client.getSymbolInfo('AAPL'), ResponseError);
  const emptyQuote = harness({ responder: () => http('') });
  assert.equal(await emptyQuote.client.getQuote('AAPL'), null);
});

test('Node entry generates IDs and custom runtimes require an ID when randomness is unavailable', async () => {
  const { client, calls } = harness();
  await client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100 });
  const generated = calls.at(-1).query.clientOrderId;
  assert.match(generated, /^[a-zA-Z0-9_-]{32,36}$/);
  const deterministic = harness({ options: { crypto: { subtle: webcrypto.subtle, randomUUID: () => GENERATED_ID } } });
  await deterministic.client.placeOrder({ ...LIMIT, clientOrderId: undefined });
  assert.equal(deterministic.calls.at(-1).query.clientOrderId, GENERATED_ID);
  const portable = harness({ Client: CoreBinanceStocks, options: { crypto: {}, sign: () => 'offline-signature' } });
  await assert.rejects(() => portable.client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100 }), /clientOrderId/);
  assert.ok(portable.calls.every(call => call.init.method === 'GET'));
  await portable.client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100, clientOrderId: SUPPLIED_ID });
  assert.equal(portable.calls.at(-1).query.clientOrderId, SUPPLIED_ID);
});

test('uncertain placements preserve caller or generated IDs and never resubmit', async () => {
  for (const clientOrderId of [SUPPLIED_ID, undefined]) {
    for (const outcome of ['timeout', 'server']) {
      const { client, calls } = harness({
        options: { crypto: { subtle: webcrypto.subtle, randomUUID: () => GENERATED_ID } },
        responder(call, fallback) {
          if (call.path !== 'order/place') return fallback(call);
          if (outcome === 'timeout') throw new Error('offline timeout');
          return http({ code: -1000, msg: 'Unknown execution outcome' }, 503);
        },
      });
      await assert.rejects(() => client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100, clientOrderId }), error => {
        assert.ok(error instanceof UnknownExecutionError);
        assert.equal(error.executionUnknown, true);
        assert.equal(error.clientOrderId, clientOrderId ?? GENERATED_ID);
        assert.equal(error.status, outcome === 'server' ? 503 : null);
        return true;
      });
      assert.equal(calls.filter(call => call.path === 'order/place').length, 1);
      await client.getOrder({ clientOrderId: clientOrderId ?? GENERATED_ID });
      assert.deepEqual(businessParams(calls.at(-1)), { clientOrderId: clientOrderId ?? GENERATED_ID });
    }
  }
});

test('malformed successful placement responses preserve generated reconciliation IDs without retrying', async () => {
  const { client, calls } = harness({
    options: { crypto: { subtle: webcrypto.subtle, randomUUID: () => GENERATED_ID } },
    responder: (call, fallback) => call.path === 'order/place' ? http({}) : fallback(call),
  });
  await assert.rejects(() => client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100 }), error => {
    assert.ok(error instanceof UnknownExecutionError);
    assert.equal(error.clientOrderId, GENERATED_ID);
    assert.equal(error.executionUnknown, true);
    assert.equal(error.status, 200);
    return true;
  });
  assert.equal(calls.filter(call => call.path === 'order/place').length, 1);
});

test('acknowledgements and optional order execution fields are returned without synthetic fills', async () => {
  const failed = harness({ responder: (call, fallback) => call.path === 'order/place' ? http({ status: 'F', orderId: 'order-001' }) : fallback(call) });
  assert.deepEqual(await failed.client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100 }), { status: 'F', orderId: 'order-001' });
  const { client } = harness();
  const order = await client.getOrder({ clientOrderId: SUPPLIED_ID });
  assert.equal(order.status, 'ACCEPTED');
  assert.equal('fee' in order, false);
  assert.equal('avgFilledPrice' in order, false);
  assert.deepEqual(order.trades, []);
  assert.deepEqual(await client.getConversionStatus({ issuerRequestId: 'missing', convertType: 'REDEEM' }), {});
});

test('disclaimer acceptance is explicit and cancel-all stays account-wide', async () => {
  const { client, calls } = harness();
  for (const params of [undefined, {}, { accepted: false }, { accepted: 'true' }, { accepted: 1 }]) {
    await assert.rejects(() => client.acceptDisclaimer(params));
  }
  assert.equal(calls.length, 0);
  assert.deepEqual(await client.acceptDisclaimer({ accepted: true }), { success: true });
  assert.deepEqual(businessParams(calls.at(-1)), {});
  assert.equal(calls.at(-1).path, 'account/disclaimer');
  await client.cancelAllOrders({ recvWindow: 1000 });
  assert.equal(calls.at(-1).query.recvWindow, '1000');
  assert.deepEqual(businessParams(calls.at(-1)), {});
  await assert.rejects(() => client.cancelAllOrders({ symbol: 'AAPL' }), /Unknown/);
  await assert.rejects(() => client.getOpenOrders({ symbol: 'AAPL' }), /Unknown/);
  assert.equal(calls.length, 2);
});

test('order/trade history sends current and receives page while validating time and pagination bounds', async () => {
  const { client, calls } = harness();
  const filters = { startTime: 0, endTime: NOW, current: 2, size: 100, symbol: 'SPY', side: 'SELL' };
  const result = await client.getOrderHistory({ ...filters, orderType: 'LIMIT', orderStatus: 'FILLED,CANCELED' });
  assert.deepEqual(result, { total: 0, page: 2, size: 100, rows: [] });
  assert.equal(calls.at(-1).query.current, '2');
  assert.equal(calls.at(-1).query.page, undefined);
  assert.match(calls.at(-1).url, /orderStatus=FILLED%2CCANCELED/);
  await client.getTradeHistory({ ...filters, orderId: 'order-001' });
  assert.equal(calls.at(-1).query.orderId, 'order-001');
  for (const method of ['getOrderHistory', 'getTradeHistory']) {
    for (const params of [
      {}, { endTime: NOW }, { startTime: 1 }, { startTime: NOW, endTime: 0 },
      { ...filters, startTime: -1 }, { ...filters, endTime: '100' },
      { ...filters, current: 0 }, { ...filters, current: 1.5 },
      { ...filters, size: 0 }, { ...filters, size: 101 }, { ...filters, page: 2 },
    ]) await assert.rejects(() => client[method](params));
  }
  await assert.rejects(() => client.getOrderHistory({ ...filters, orderStatus: 'ACCEPTED' }), /orderStatus/);
  await assert.rejects(() => client.getOrderHistory({ ...filters, orderStatus: 'FILLED, CANCELED' }), /orderStatus/);
  assert.equal(calls.length, 2);
});

test('wallet and portfolio methods paginate executions and report Funding Wallet USDC with bid values', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    executionId: `exec-${index}`, symbol: 'NVDA', side: 'BUY', qty: '0.01', quote: 'USDC',
  }));
  const { client, calls } = harness({
    responder(call, fallback) {
      if (call.path === 'trade/history') {
        const page = Number(call.query.current ?? 1);
        return http({ total: 101, page, size: 100, rows: page === 1 ? firstPage : [
          firstPage[0],
          { executionId: 'exec-sell', symbol: 'NVDA', side: 'SELL', qty: '0.125', quote: 'USDC' },
        ] });
      }
      if (call.path === 'market/quote') return http({ symbol: call.query.symbol, bidPrice: '300', askPrice: '301' });
      return fallback(call);
    },
  });
  assert.deepEqual(await client.getEquityWallet({ startTime: 0, endTime: NOW }), { NVDA: { amount: '0.875' } });
  const tradeCalls = calls.filter(call => call.path === 'trade/history');
  assert.deepEqual(tradeCalls.map(call => call.query.current), ['1', '2']);
  assert.ok(tradeCalls.every(call => call.query.size === '100' && call.query.startTime === '0' && call.query.endTime === String(NOW)));
  assert.deepEqual(await client.getFundingWallet(), {
    USDC: { free: '900', locked: '100', freeze: '0', withdrawing: '0', amount: '1000' },
  });
  assert.equal(calls.at(-1).path, 'asset/get-funding-asset');
  assert.deepEqual(businessParams(calls.at(-1)), { asset: 'USDC' });
  assert.deepEqual(await client.getPortfolio({ startTime: 0, endTime: NOW }), {
    totals: { totalUsd: 1262.5, positionsUsd: 262.5, cashUsd: 1000 },
    cash: { USDC: { amount: 1000, quote: 1, usd: 1000, weight: 0.7921 } },
    positions: { NVDA: {
      amount: 0.875, quote: 300, usd: 262.5, weight: 0.2079
    } },
  });
});

test('token conversion inputs, generated IDs and int64 cursor pagination survive the public API', async () => {
  const { client, calls } = harness({
    options: { crypto: { subtle: webcrypto.subtle, randomUUID: () => GENERATED_ID } },
    responder(call, fallback) {
      if (call.path === 'tokenized/history') return http('{"rows":[],"hasMore":true,"nextLastId":9223372036854775807}');
      return fallback(call);
    },
  });
  assert.deepEqual(await client.mintTokenized({ underlyingAsset: 'AAPL', underlyingAssetAmount: '1.000000001' }), { issuerRequestId: 'conversion-001', status: 'P' });
  assert.equal(calls.at(-1).query.underlyingAssetAmount, '1.000000001');
  assert.equal(calls.at(-1).query.clientOrderId, GENERATED_ID);
  await client.redeemTokenized({ tokenizedAsset: 'AAPLB', tokenizedAssetAmount: '0.100000001', clientOrderId: SUPPLIED_ID });
  assert.equal(calls.at(-1).query.tokenizedAssetAmount, '0.100000001');
  assert.equal(calls.at(-1).query.clientOrderId, SUPPLIED_ID);
  await client.redeemTokenized({ tokenizedAsset: 'AAPLB', tokenizedAssetAmount: '1' });
  assert.equal(calls.at(-1).query.clientOrderId, GENERATED_ID);
  const page = await client.getConversionHistory({ size: 100 });
  assert.equal(page.nextLastId, '9223372036854775807');
  await client.getConversionHistory({ lastId: page.nextLastId, size: 100 });
  assert.equal(calls.at(-1).query.lastId, '9223372036854775807');
  assert.equal(calls.at(-1).query.current, undefined);
  assert.equal(calls.at(-1).query.startTime, undefined);
  const count = calls.length;
  for (const lastId of [Number.MAX_SAFE_INTEGER + 1, '9223372036854775808', -1, '1.5']) {
    await assert.rejects(() => client.getConversionHistory({ lastId }), /lastId/);
  }
  for (const amount of ['0', '-1', '1e3', Infinity]) {
    await assert.rejects(() => client.mintTokenized({ underlyingAsset: 'AAPL', underlyingAssetAmount: amount }));
    await assert.rejects(() => client.redeemTokenized({ tokenizedAsset: 'AAPLB', tokenizedAssetAmount: amount }));
  }
  await assert.rejects(() => client.getConversionStatus({ issuerRequestId: 'conversion-001' }), /convertType/);
  await assert.rejects(() => client.getConversionHistory({ current: 1 }), /Unknown/);
  assert.equal(calls.length, count);
});

test('API failures retain metadata and rate-limit state blocks repeated requests locally', async () => {
  let currentTime = NOW;
  const { client, calls } = harness({
    options: { now: () => currentTime },
    responder: () => http({ code: -1003, msg: 'Too many requests' }, 429, { 'Retry-After': '2', 'X-SAPI-USED-IP-WEIGHT-1M': '99' }),
  });
  await assert.rejects(() => client.getQuote('AAPL'), error => {
    assert.ok(error instanceof BinanceAPIError);
    assert.ok(error instanceof RateLimitError);
    assert.equal(error.status, 429);
    assert.equal(error.code, -1003);
    assert.equal(error.msg, 'Too many requests');
    assert.equal(error.headers['retry-after'], '2');
    assert.equal(error.retryAfterMs, 2000);
    return true;
  });
  const state = client.getRateLimitState();
  assert.equal(state.lockedUntil, NOW + 2000);
  assert.equal(state.usage['x-sapi-used-ip-weight-1m'], '99');
  await assert.rejects(() => client.getQuote('AAPL'), error => error instanceof RateLimitError && error.local === true);
  assert.equal(calls.length, 1);
  currentTime += 2000;
  await assert.rejects(() => client.getQuote('AAPL'), RateLimitError);
  assert.equal(calls.length, 2);
});
