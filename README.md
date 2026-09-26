# simple-binance-stocks

A JavaScript library for Binance Stocks and ETFs, with a shared asynchronous API for Node.js and Google Apps Script. Order funding uses **USDC**. Equity prices and notionals retain Binance's documented **USD** units. The library has no external runtime dependencies; webpack builds the Google Apps Script artifact.

The library covers the 16 Binance Stocks REST endpoints under `/sapi/v1/equity/`: market data, order placement and queries, cancellations, tokenized conversions, disclaimer acceptance, and listen-key creation or renewal. It also reads USDC from Binance's Funding Wallet endpoint.

## Requirements

- A Binance API key and signing secret with access to Stocks, or an API key and custom signer. This library signs every REST request.
- An eligible account with the US equity disclaimer accepted before trading. Acceptance is an explicit operation; constructing a client never accepts it.
- Node.js 20 or later, or Google Apps Script with the V8 runtime.

Use plain uppercase tickers such as `AAPL` and `SPY`. Symbol availability and trading rules come from Binance's exchange information.

## Node.js

Node.js uses the ESM entry at `index.js` directly and requires no build.

```js
import BinanceStocks from 'simple-binance-stocks';

const stocks = new BinanceStocks({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
});

const quote = await stocks.getQuote('AAPL');
console.log(quote); // Binance's quote object, or null when no quote is available.

const rules = await stocks.getSymbolInfo('SPY');
console.log(rules);
```

When trying the examples directly inside this repository, use `import BinanceStocks from './index.js'` for ESM. Keep credentials outside source files. A client with only `apiKey` cannot send requests. The constructor does not accept a `symbol`; pass a ticker to each symbol-specific call. The same client can query or trade multiple tickers.

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
  symbol: 'AAPL',
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
  symbol: 'AAPL',
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
    symbol: 'AAPL',
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

Every network method returns a Promise. Options shown as `{}` may be omitted. Direct endpoint methods return Binance response data without converting decimal strings into floating-point values. Wallet methods return calculated decimal amounts as strings; `getPortfolio()` returns numbers for its simple report.

### Client options

```js
const stocks = new BinanceStocks({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  quoteAsset: 'USDC',          // Default; other assets are rejected.
  recvWindow: 5000,            // Milliseconds; maximum 60000.
  baseUrl: 'https://api.binance.com',
  rateLimitFallbackMs: 60000,
});
```

The Node.js entry point supplies native HTTP and cryptography adapters. For testing or another host, the constructor also accepts `fetch`, `crypto`, `now`, and `sign`. A custom `sign(payload)` callback must sign the exact encoded string passed to it and return the signature expected by Binance. HMAC-SHA256 is included; alternate signing schemes require an appropriate custom signer. Request timestamps are generated automatically. The default clock is the host clock, so keep it synchronized.

#### `baseUrl` and HTTPS proxies

`baseUrl` defaults to `https://api.binance.com`. Set it to the HTTPS origin of a reverse proxy when requests must pass through your own server:

```js
const stocks = new BinanceStocks({
  apiKey,
  apiSecret,
  baseUrl: 'https://stocks-proxy.example.com',
});
```

The value must be an HTTPS origin. A hostname, optional port, and optional trailing slash are accepted; credentials, a path, query string, or fragment are rejected. The client appends the documented endpoint path (`/sapi/v1/equity/...` or `/sapi/v1/asset/get-funding-asset`) and its encoded parameters to that origin. `baseUrl` does not configure an HTTP or SOCKS forward proxy.

A reverse proxy must forward the request method, path, raw query string, and `X-MBX-APIKEY` header without changing the signed query bytes. Return the upstream status, body, and response headers, especially `Retry-After` and rate-limit usage headers. The API secret stays in the client for signing, but the proxy receives the API key and signed requests, so use a trusted proxy. The client rejects HTTP redirects.

The [Binance Stocks Quick Start](https://developers.binance.com/en/docs/products/stocks/quick-start) shows the production URL; the Stocks documentation does not currently describe a dedicated testnet. Changing `baseUrl` does not create a test environment. If the proxy forwards to production, order calls can place real trades. Use mocked transport for offline tests.

### Market data

| Method | Result |
| --- | --- |
| `getExchangeInfo()` | Full, unfiltered exchange information from Binance. Each call fetches current data. |
| `getSymbolInfo(symbol, { refresh } = {})` | Rules for one required ticker, fetched through the exchange-info symbol filter. Set `refresh: true` to bypass the per-symbol cache. |
| `getQuote(symbol)` | Latest quote object for one required ticker, or `null` for Binance's empty successful response. |
| `getTokenizedAssets({ refresh } = {})` | Tokenized-asset mappings. Set `refresh: true` to bypass cached data. |

The library signs these requests with the same `timestamp`, `recvWindow`, and `signature` parameters used for trading requests. Binance documents these routes as requiring an API key without a signature, so acceptance of the additional signing parameters should be checked against a live account before relying on this behavior. `getExchangeInfo()` accepts no symbol or refresh options; it fetches the full response each time and does not cache it. Valid, nonempty symbol rules from `getSymbolInfo()` are cached by ticker for up to 300 seconds; tokenized-asset mappings are cached for up to 21,600 seconds (six hours). The cache is per client in Node.js and script-wide through `CacheService` in Apps Script. `refresh: true` on a cached method fetches fresh data. Order methods always fetch current exchange rules before placement. Apps Script may evict entries early. Quotes are never cached.

### Trading

| Method | Parameters |
| --- | --- |
| `createLimitOrder(options)` | Required `symbol`, `amountInUSD`, `entryPrice`, `tradingSession`; optional `side` (default `BUY`), `timeInForce` (default `DAY`), `walletType`, `tokenize`, `clientOrderId`, `recvWindow`. |
| `createMarketOrder(options)` | Required `symbol`, `amountInUSD`; optional `side` (default `BUY`), `timeInForce` (default `DAY`), `walletType`, `tokenize`, `clientOrderId`, `recvWindow`. |
| `placeOrder(params)` | Required `symbol`, `orderType`, and the fields required by the combination above; optional `side` (default `BUY`), `quoteAsset`, `timeInForce` (default `DAY`), `walletType`, `tokenize`, `clientOrderId`, `recvWindow`. |
| `getOrder({ orderId, clientOrderId, recvWindow })` | Provide an `orderId` or `clientOrderId`. |
| `getOpenOrders({ recvWindow } = {})` | All open orders for the account. |
| `getOrderHistory(options)` | Required `startTime`, `endTime`; optional `symbol`, `orderType`, `side`, `orderStatus`, `current`, `size`, `recvWindow`. |
| `getTradeHistory(options)` | Required `startTime`, `endTime`; optional `symbol`, `side`, `orderId`, `current`, `size`, `recvWindow`. |
| `cancelOrder({ orderId, recvWindow })` | Cancel one order. |
| `cancelAllOrders({ recvWindow } = {})` | Cancel all open orders for the account, across all symbols. |

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

### Wallets and portfolio report

| Method | Result |
| --- | --- |
| `getEquityWallet({ startTime, endTime, recvWindow } = {})` | Trade-derived share estimate by ticker, for example `{ NVDA: { amount: '3' } }`. The default time range starts at Unix time `0` and ends at the current client time. |
| `getFundingWallet({ recvWindow } = {})` | Current Funding Wallet USDC, for example `{ USDC: { free: '900', locked: '100', freeze: '0', withdrawing: '0', amount: '1000' } }`. `amount` is `free + locked`. |
| `getPortfolio({ startTime, endTime, recvWindow } = {})` | `{ totals, cash, positions }` report combining those wallets with a fresh best bid quote for each equity. |

`getEquityWallet()` pages through `/sapi/v1/equity/trade/history` at 100 executions per page, adds BUY quantities, subtracts SELL quantities, and counts each `executionId` only once. It omits tickers whose net amount is zero. Its result is an **estimate from executions**, not a verified account balance. Holdings acquired before the requested history window, transfers, stock-token mint/redeem, settlement and other adjustments can make it differ from actual holdings. Use a `startTime` early enough to cover the trading history needed for the report. The method rejects incomplete pagination or a negative net share estimate. Neither wallet nor trade history is cached.

`getFundingWallet()` reads the signed `POST /sapi/v1/asset/get-funding-asset` endpoint with `asset: 'USDC'`. It reports the Binance **Funding Wallet**, not the Spot balance. An empty filtered response yields a zero USDC balance; a malformed response raises an error. `getPortfolio()` always includes `cash.USDC`, including when its amount is zero. Other assets in the Funding Wallet are excluded. Binance may default equity BUY funding to `CARD` and allows `MAIN`, so a report based on Funding Wallet USDC is not a complete account-wide cash balance.

```js
const portfolio = await stocks.getPortfolio();
// {
//   totals: { totalUsd: 6805, positionsUsd: 900, cashUsd: 5905 },
//   cash: {
//     USDC: { amount: 5905, quote: 1, usd: 5905, weight: 0.8677 }
//   },
//   positions: {
//     NVDA: { amount: 3, quote: 300, usd: 900, weight: 0.1323 }
//   }
// }
```

Each position's `usd` is its estimated share amount multiplied by the current best bid in Binance's USD price units. This is a current-value estimate, not historical purchase cost or a guaranteed sale price. `totals.positionsUsd` sums equity values, `totals.cashUsd` is the Funding Wallet USDC value, and `totals.totalUsd` sums both. Each `weight` is the item's `usd` divided by `totals.totalUsd`, rounded to four decimal places. If any equity quote is missing or invalid, `totals.totalUsd`, `totals.positionsUsd`, and all weights are `null`, because a complete valuation is unavailable; that position also has `quote: null` and `usd: null`. `totals.cashUsd` remains available. A zero denominator gives a `null` weight. `cash.USDC.usd` uses a simple 1:1 **reporting assumption**; the library does not convert Binance's USD prices into USDC. Portfolio values are JavaScript numbers for reporting and may lose decimal precision; use the wallet methods for exact decimal strings.

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
| `createListenKey({ recvWindow } = {})` | Creates a listen key or renews the active key for the account; returns `{ listenKey }`. The library sends an API key, timestamp, and signature. Binance documents this route as API-key-only, so verify acceptance of the additional signature with a live account. |
| `getRateLimitState()` | Returns the client's current rate-limit state. |

Read the applicable Binance disclaimer before explicitly calling `acceptDisclaimer()`. A listen key is available for an external WebSocket consumer; this package does not open WebSocket connections. Binance's Stocks REST catalog does not provide a current equity-position endpoint; `getEquityWallet()` therefore derives an estimate from trade history.

## Errors and rate limits

The shared request layer preserves HTTP status, Binance error code/message, and useful response headers as `status`, `code`, `msg`, and `headers`. Transport errors for order placement retain the order's `clientOrderId`, including a generated ID, so the application can reconcile the result. Do not infer that a timed-out or failed server response means a mutation was rejected.

| Error type | Meaning |
| --- | --- |
| `BinanceAPIError` | An unsuccessful Binance response; includes response metadata. |
| `RateLimitError` | Binance rate limiting, or a request blocked by the client's existing cooldown; includes `retryAfterMs`, `lockedUntil`, and `local`. |
| `UnknownExecutionError` | A mutation may have executed; `executionUnknown` is `true`, with available reconciliation IDs. |
| `ResponseError` | A read failed or its response could not be parsed. |
| `ValidationError`, `TypeError`, `RangeError` | Invalid input or unsupported configuration. |

In Node.js, import error classes by name from the package, such as `import { RateLimitError } from 'simple-binance-stocks'`. In Apps Script, access them on the constructor, such as `BinanceStocks.RateLimitError`.

The client tracks rate-limit responses and honors `Retry-After` when provided, using `rateLimitFallbackMs` when a fallback is needed. It does not automatically retry requests. `getRateLimitState()` returns `{ lockedUntil, retryAfterMs, usage }`; wait for the cooldown before making another request after a rate-limit error. Endpoint and account limits still apply across other clients and processes.

Never log credentials, signatures, or signed request URLs. Application logging should select the specific response fields needed for diagnostics.

## Google Apps Script

After installing development dependencies with `npm ci`, build with `npm run build`, then paste the contents of `dist/BinanceStocks.min.js` into a script file in an Apps Script project using V8. This production bundle is exclusively for Google Apps Script. It exposes the `BinanceStocks` constructor directly and error types such as `BinanceStocks.RateLimitError`.

Store `BINANCE_API_KEY` and `BINANCE_API_SECRET` in script properties for a private script project, or use user properties when each user has separate credentials.

```js
async function inspectStockQuote() {
  const properties = PropertiesService.getScriptProperties();
  const stocks = new BinanceStocks({
    apiKey: properties.getProperty('BINANCE_API_KEY'),
    apiSecret: properties.getProperty('BINANCE_API_SECRET'),
  });

  const quote = await stocks.getQuote('AAPL');
  console.log(quote);
}
```

Use top-level function declarations for Apps Script entry points. The adapter uses `UrlFetchApp` and `Utilities`; HTTP calls remain blocking within the Promise API. Respect Apps Script execution and URL Fetch quotas, and use `LockService` when multiple executions share trading state. See [Google Apps Script notes](docs/GOOGLE_APPS_SCRIPT.md).

## Development

Building and testing require Node.js 20.9 or later and the webpack development dependencies:

```sh
npm ci
npm run build
npm test
```

`webpack.config.js` bundles `src/googleAppsScript.js` into the single production file `dist/BinanceStocks.min.js`. It preserves error class names and requires no Node.js modules or browser chunk loader in Apps Script. Regenerate the artifact after changing library code.

Tests run offline with dummy credentials and mocked HTTP, time, signing, and Apps Script services. The test command builds and checks the Apps Script artifact as well as the shared API and adapters. It does not load local trading credentials or submit live orders.

See [API implementation notes](docs/BINANCE_STOCKS_API.md) and [contributor instructions](AGENTS.md). The official [Stocks REST catalog](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api) and [change log](https://developers.binance.com/en/docs/products/stocks/change-log) define the upstream API contract.
