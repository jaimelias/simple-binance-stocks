# simple-binance-stocks

A JavaScript library for Binance Stocks and ETFs, with a shared asynchronous API for Node.js and Google Apps Script. Order funding uses **USDC**. Equity prices and notionals retain Binance's documented **USD** units. The library and build use no external packages.

The library covers the 16 Binance Stocks REST endpoints under `/sapi/v1/equity/`: market data, order placement and queries, cancellations, tokenized conversions, disclaimer acceptance, and listen-key creation or renewal.

## Requirements

- A Binance API key with access to Stocks. Market data and listen-key requests require the key; trading and account queries also require a signing secret or custom signer.
- An eligible account with the US equity disclaimer accepted before trading. Acceptance is an explicit operation; constructing a client never accepts it.
- Node.js 20 or later, or Google Apps Script with the V8 runtime.

Use plain uppercase tickers such as `AAPL` and `SPY`. Symbol availability and trading rules come from Binance's exchange information.

## Node.js

From this checkout:

```sh
npm run build
npm test
```

```js
import BinanceStocks from 'simple-binance-stocks';

const stocks = new BinanceStocks({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  symbol: 'AAPL',
});

const quote = await stocks.getQuote();
console.log(quote); // Binance's quote object, or null when no quote is available.

const rules = await stocks.getSymbolInfo();
console.log(rules);
```

CommonJS is also supported after building:

```js
const BinanceStocks = require('simple-binance-stocks');
```

When trying the examples directly inside this repository, use `import BinanceStocks from './index.js'` for ESM. Keep credentials outside source files. A client with only `apiKey` can call market-data methods and `createListenKey()`.

## Order sizing

`amountInUSD` is a **finite JavaScript number greater than zero** describing the target USD order value before fees. Orders are funded in USDC, and every placement explicitly sends `quoteAsset: 'USDC'`. Other quote assets are rejected. The library does not convert a USDC wallet balance into USD or promise a final spend of exactly `amountInUSD`.

The convenience helpers calculate share quantities internally:

| Order | Binance request sizing |
| --- | --- |
| Limit buy or sell | Divide `amountInUSD` by the validated `entryPrice`, then round quantity down to the symbol's `stepSize`. |
| Market buy | Send `amountInUSD` as `notional`. |
| Market sell | Fetch a current quote, calculate quantity from its bid price, then round down to `stepSize`. Reject when no valid quote is available. |

The calculated size must satisfy symbol quantity, notional, tradability, session, and fractional-share rules. The helpers reject invalid sizes instead of increasing the requested amount to meet a minimum. Binance remains authoritative for changing price bands, `maxNumOrders`, current market conditions, and account restrictions. Decimal calculations use exact arithmetic; decimal response fields remain strings. `amountInUSD` is never sent as a Binance parameter.

### Limit order

The following call places a real order when run with valid trading credentials:

```js
const acknowledgement = await stocks.createLimitOrder({
  side: 'BUY',
  amountInUSD: 100,
  entryPrice: '180.50',
  tradingSession: 'RTH',
  timeInForce: 'DAY',
  clientOrderId: 'stock-example-limit-buy-000000001',
});

const order = await stocks.getOrder({ orderId: acknowledgement.orderId });
console.log(order.status);
```

`tradingSession` is required for limit orders: `RTH`, `EXTENDED`, or `24H`. Limit prices permit at most two decimal places. `GTC` applies only to limit orders; fractional `GTC` orders require `EXTENDED` or `24H` and support from the symbol's rules. Set `side: 'SELL'` to size a limit sell the same way.

### Market order

```js
const acknowledgement = await stocks.createMarketOrder({
  side: 'BUY',
  amountInUSD: 100,
  clientOrderId: 'stock-example-market-buy-00000001',
});
```

Set `side: 'SELL'` to derive the quantity from a current quote. Market execution prices and fees can change the final amount spent or received. Market orders do not accept `price` or `tradingSession`.

### Direct order placement

Use `placeOrder(params)` when the application already has an explicit share quantity or market-buy notional. The library still checks the order combination and current exchange rules.

```js
const acknowledgement = await stocks.placeOrder({
  symbol: 'AAPL',
  side: 'BUY',
  orderType: 'LIMIT',
  quantity: '1',
  price: '180.50',
  tradingSession: 'RTH',
  timeInForce: 'DAY',
  quoteAsset: 'USDC',
  clientOrderId: 'stock-example-direct-buy-00000001',
});
```

| Combination | Required sizing fields | Forbidden fields |
| --- | --- | --- |
| `BUY LIMIT` | `price`, `quantity`, `tradingSession` | `notional` |
| `SELL LIMIT` | `price`, `quantity`, `tradingSession` | `notional` |
| `BUY MARKET` | `notional` | `price`, `quantity`, `tradingSession` |
| `SELL MARKET` | `quantity` | `price`, `notional`, `tradingSession` |

Prefer decimal strings for `price`, `quantity`, `notional`, and conversion amounts. The convenience helpers specifically require a number for `amountInUSD`.

## Acknowledgements and uncertain outcomes

Placement and cancellation return Binance's acknowledgement, where `status: 'S'` means accepted and `status: 'F'` means failed. An accepted acknowledgement does not mean an order filled. Query `getOrder()` for lifecycle states such as `ACCEPTED`, `PARTIALLY_FILLED`, or `FILLED`.

Order helpers and `placeOrder()` generate a `clientOrderId` when omitted and retain a supplied ID. Supply your own 32–36 character ID using letters, digits, underscores, or hyphens when you need to store it before the call. A timeout or server failure can occur after an order reaches Binance. The library does not automatically retry mutations. Reconcile an uncertain placement before submitting another order:

```js
const clientOrderId = 'stock-reconcile-limit-buy-000001';

try {
  await stocks.createLimitOrder({
    side: 'BUY',
    amountInUSD: 100,
    entryPrice: '180.50',
    tradingSession: 'RTH',
    clientOrderId,
  });
} catch (error) {
  // Save the ID with the operation. Inspect the failure before deciding next steps.
  // When execution is uncertain, query this ID instead of submitting again:
  // const order = await stocks.getOrder({ clientOrderId });
  throw error;
}
```

Responses preserve Binance's field names and optional fields. In order detail, `fee` and `avgFilledPrice` may be absent before a fill. Trade history and individual executions do not include a `fee` field.

## Public API

Every network method returns a Promise. Options shown as `{}` may be omitted. Methods return Binance response data without converting decimal strings into floating-point values.

### Client options

```js
const stocks = new BinanceStocks({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  symbol: 'AAPL',             // Optional default ticker.
  quoteAsset: 'USDC',          // Default; other assets are rejected.
  recvWindow: 5000,            // Milliseconds; maximum 60000.
  baseUrl: 'https://api.binance.com',
  rateLimitFallbackMs: 60000,
});
```

The Node.js entry point supplies native HTTP and cryptography adapters. For testing or another host, the constructor also accepts `fetch`, `crypto`, `now`, and `sign`. A custom `sign(payload)` callback must sign the exact encoded string passed to it and return the signature expected by Binance. HMAC-SHA256 is included; alternate signing schemes require an appropriate custom signer. Request timestamps are generated automatically. The default clock is the host clock, so keep it synchronized.

### Market data

| Method | Result |
| --- | --- |
| `getExchangeInfo({ symbol } = {})` | Exchange information, optionally filtered by ticker. An unknown filter can return an empty `symbols` array. |
| `getSymbolInfo(symbol = this.symbol)` | Rules for one ticker. |
| `getQuote(symbol = this.symbol)` | Latest quote object, or `null` for Binance's empty successful response. |
| `getTokenizedAssets()` | Tokenized-asset mappings. |

These endpoints use the API key without a signature. The client does not cache exchange information or quotes.

### Trading

| Method | Parameters |
| --- | --- |
| `createLimitOrder(options)` | `amountInUSD`, `entryPrice`, `tradingSession`; optional `symbol`, `side` (default `BUY`), `timeInForce` (default `DAY`), `walletType`, `tokenize`, `clientOrderId`, `recvWindow`. |
| `createMarketOrder(options)` | `amountInUSD`; optional `symbol`, `side` (default `BUY`), `timeInForce` (default `DAY`), `walletType`, `tokenize`, `clientOrderId`, `recvWindow`. |
| `placeOrder(params)` | `orderType` and the fields required by the combination above; optional `symbol` (client default), `side` (default `BUY`), `quoteAsset`, `timeInForce` (default `DAY`), `walletType`, `tokenize`, `clientOrderId`, `recvWindow`. |
| `getOrder({ orderId, clientOrderId, recvWindow })` | Provide an `orderId` or `clientOrderId`. |
| `getOpenOrders({ recvWindow } = {})` | All open orders for the account. |
| `getOrderHistory(options)` | Required `startTime`, `endTime`; optional `symbol`, `orderType`, `side`, `orderStatus`, `current`, `size`, `recvWindow`. |
| `getTradeHistory(options)` | Required `startTime`, `endTime`; optional `symbol`, `side`, `orderId`, `current`, `size`, `recvWindow`. |
| `cancelOrder({ orderId, recvWindow })` | Cancel one order. |
| `cancelAllOrders({ recvWindow } = {})` | Cancel all open orders for the account. This is not limited to the client's default symbol. |

`walletType` is `CARD` (Binance's default) or `MAIN` for buys; sells settle to `CARD`. `tokenize` defaults to `true` at Binance and only affects supported symbols. Check `getTokenizedAssets()` before relying on tokenized settlement.

History times are Unix milliseconds. Page numbers use `current`, starting at `1`; `size` defaults to `20` and cannot exceed `100`. Responses use `{ total, page, size, rows }`. Fetch additional pages explicitly. `orderStatus` is a comma-separated filter using `FILLED`, `PARTIALLY_FILLED`, `CANCELED`, `EXPIRED`, or `REJECTED`.

```js
const history = await stocks.getOrderHistory({
  startTime: Date.UTC(2026, 8, 1),
  endTime: Date.UTC(2026, 8, 23),
  symbol: 'AAPL',
  current: 1,
  size: 20,
});
```

### Tokenized conversions

| Method | Parameters |
| --- | --- |
| `mintTokenized(options)` | Required `underlyingAsset`, `underlyingAssetAmount`; optional `clientOrderId`, `recvWindow`. |
| `redeemTokenized(options)` | Required `tokenizedAsset`, `tokenizedAssetAmount`; optional `clientOrderId`, `recvWindow`. |
| `getConversionStatus(options)` | Required `issuerRequestId`, `convertType` (`MINT` or `REDEEM`); optional `recvWindow`. |
| `getConversionHistory(options = {})` | Optional `startTime`, `endTime`, `lastId`, `size`, `recvWindow`. |

Minting takes an underlying ticker such as `AAPL`; redemption takes the corresponding tokenized asset such as `AAPLB`. Binance resolves the destination asset. Amounts must be positive. Both helpers generate a `clientOrderId` when omitted. Automatic IDs use `crypto.randomUUID()`, `crypto.getRandomValues()`, or Apps Script's `Utilities.getUuid()`; custom runtimes without these must supply an ID.

Conversions are asynchronous: mint/redeem responses contain an `issuerRequestId` and a conversion status (`P`, `S`, or `F`). Query status explicitly; the library does not poll. A missing conversion can return `{}`. Conversion history uses `{ rows, hasMore, nextLastId }`; pass `nextLastId` as `lastId` to fetch another page. Large integer cursors are preserved as decimal strings; pass them back without converting them to JavaScript numbers. Page size defaults to `20`, with a maximum of `100`.

### Account and streams

| Method | Behavior |
| --- | --- |
| `acceptDisclaimer({ accepted: true, recvWindow })` | Explicitly records acceptance for the account. The client requires `accepted: true`; this confirmation is not sent as an API parameter. |
| `createListenKey({ recvWindow } = {})` | Creates a listen key or renews the active key for the account; returns `{ listenKey }`. Uses an API key and timestamp without a signature. |
| `getRateLimitState()` | Returns the client's current rate-limit state. |

Read the applicable Binance disclaimer before explicitly calling `acceptDisclaimer()`. A listen key is available for an external WebSocket consumer; this package does not open WebSocket connections. Binance's Stocks REST catalog does not provide balance, positions, or historical-candle endpoints, so those methods are not invented by this library.

## Errors and rate limits

The shared request layer preserves HTTP status, Binance error code/message, and useful response headers as `status`, `code`, `msg`, and `headers`. Transport errors for order placement retain the order's `clientOrderId`, including a generated ID, so the application can reconcile the result. Do not infer that a timed-out or failed server response means a mutation was rejected.

| Error type | Meaning |
| --- | --- |
| `BinanceAPIError` | An unsuccessful Binance response; includes response metadata. |
| `RateLimitError` | Binance rate limiting, or a request blocked by the client's existing cooldown; includes `retryAfterMs`, `lockedUntil`, and `local`. |
| `UnknownExecutionError` | A mutation may have executed; `executionUnknown` is `true`, with available reconciliation IDs. |
| `ResponseError` | A read failed or its response could not be parsed. |
| `ValidationError`, `TypeError`, `RangeError` | Invalid input or unsupported configuration. |

Error classes can be imported by name from the package or accessed as properties on the CommonJS export.

The client tracks rate-limit responses and honors `Retry-After` when provided, using `rateLimitFallbackMs` when a fallback is needed. It does not automatically retry requests. `getRateLimitState()` returns `{ lockedUntil, retryAfterMs, usage }`; wait for the cooldown before making another request after a rate-limit error. Endpoint and account limits still apply across other clients and processes.

Never log credentials, signatures, or signed request URLs. Application logging should select the specific response fields needed for diagnostics.

## Google Apps Script

Build the bundle with `npm run build`, then copy `dist/google-apps-script-build.js` into a script file in an Apps Script project using V8. The bundle exposes the `BinanceStocks` constructor and a `BinanceStocksLibrary` namespace containing its exports and error types. It has no Node.js runtime dependency.

Store `BINANCE_API_KEY` and `BINANCE_API_SECRET` in script properties for a private script project, or use user properties when each user has separate credentials.

```js
async function inspectStockQuote() {
  const properties = PropertiesService.getScriptProperties();
  const stocks = new BinanceStocks({
    apiKey: properties.getProperty('BINANCE_API_KEY'),
    apiSecret: properties.getProperty('BINANCE_API_SECRET'),
    symbol: 'AAPL',
  });

  const quote = await stocks.getQuote();
  console.log(quote);
}
```

Use top-level function declarations for Apps Script entry points. The adapter uses `UrlFetchApp` and `Utilities`; HTTP calls remain blocking within the Promise API. Respect Apps Script execution and URL Fetch quotas, and use `LockService` when multiple executions share trading state. See [Google Apps Script notes](docs/GOOGLE_APPS_SCRIPT.md).

## Development

```sh
npm run build
npm test
```

Tests run offline with dummy credentials and mocked HTTP, time, signing, and Apps Script services. The test command builds and checks the Apps Script artifact as well as the shared API and adapters. It does not load local trading credentials or submit live orders.

See [API implementation notes](docs/BINANCE_STOCKS_API.md) and [contributor instructions](AGENTS.md). The official [Stocks REST catalog](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api) and [change log](https://developers.binance.com/en/docs/products/stocks/change-log) define the upstream API contract.
