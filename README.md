# simple-binance-stocks

JavaScript client for Binance Stocks and ETFs in Node.js, Cloudflare Workers, and Google Apps Script (GAS). Orders use USD prices and are funded in USDC. The shared API lives in `src/BinanceStocksCore.js`; the runtime classes handle HTTP, signatures, and client order IDs.

**Wallet and portfolio results are estimates.** Equity holdings are reconstructed from fills in a selected time window. Funding cash includes locked funds, and the report uses current bids and a USDC reporting value of USD 1. These results are not an authoritative holding statement, spendable balance, historical valuation, or guaranteed liquidation value.

## Setup

Install the package in your Node.js project:

```sh
npm install simple-binance-stocks
```

The package uses ES modules. Add `"type": "module"` to your project's `package.json`, or use a `.mjs` file. Import the default export and provide credentials from your environment:

```js
import BinanceStocks from 'simple-binance-stocks'

const client = new BinanceStocks({
  API_KEY: process.env.BINANCE_API_KEY,
  API_SECRET: process.env.BINANCE_API_SECRET,
  // baseUrl: 'https://your-proxy.example',
  errorLogger: error => console.error(error.message)
})
```

`baseUrl` defaults to `https://api.binance.com`. Keep credentials private. There is no constructor `recvWindow` option.

`errorLogger(error)` defaults to `console.error` and accepts synchronous or async callbacks in Node.js, Cloudflare Workers, and GAS. The library awaits the callback before propagating the original failure. A callback that throws or rejects is ignored; its failure never replaces or wraps the original error. Logging covers API adapter errors and order quote-validation errors. Public input validation, symbol-rule validation, and wallet/report reconstruction errors outside the adapters are not automatically logged.

For placement failures, `error.clientOrderId` is attached before logging; cancellation failures receive `error.orderId` before logging. The logger and caller receive the same error object. If that object cannot accept the identifier, such as a frozen error, the library preserves and logs it without adding the field. Quote failures before placement have no generated placement identifier. Async callbacks should settle promptly because the failing operation waits for them.

For Cloudflare Workers, use the same package entry point. It uses native `fetch`, `TextEncoder`, and Web Crypto (`crypto.subtle` and `crypto.randomUUID()`), so the library does not require `nodejs_compat`. Store `BINANCE_API_KEY` and `BINANCE_API_SECRET` as Worker secrets and pass them from `env`. Call API methods inside a `fetch` or `scheduled` handler:

```js
import BinanceStocks from 'simple-binance-stocks'

export default {
  async fetch(request, env) {
    const client = new BinanceStocks({
      API_KEY: env.BINANCE_API_KEY,
      API_SECRET: env.BINANCE_API_SECRET
    })
    return Response.json(await client.getPortfolio())
  }
}
```

For GAS, run `npm install` and `npm run build` from a repository checkout, then load the generated `dist/BinanceStocksGas.min.js` in your Apps Script project. It exposes `BinanceStocks`; instantiate it with the same options, obtaining secrets from your chosen GAS secret storage. Use `await` in an async entry function. All thirteen trading, history, wallet, and portfolio methods return Promises in both runtimes. GAS uses `UrlFetchApp` and `Utilities` internally.

Client methods use standard class receiver binding. Call them on the client instance, or bind them when passing them as callbacks, for example `client.getQuote.bind(client)`.

Every endpoint receives `X-MBX-APIKEY`. `TRADE` and `USER_DATA` requests receive a fresh timestamp and HMAC signature. `USER_STREAM` requests receive a fresh timestamp without a signature. Signed and `USER_STREAM` calls accept a per-call `recvWindow`: a safe integer from 1 to 60000 milliseconds, default 5000. `MARKET_DATA` requests omit the timestamp, receive window, and signature.

## Existing market methods

| Method | Result |
| --- | --- |
| `getQuote(symbol)` | Promise of the raw quote response, or `null` for a successful empty response. Quotes include `bidPrice` and `askPrice` decimal strings when available. |
| `getSymbolInfo(symbol)` | Promise of the matching exchange-info rule object, or `undefined` if absent. Fetches fresh exchange info on every call; matching is case sensitive. |
| `getNyMarketSession()` | Synchronous session object for now; contract below. |

The standalone `getNyMarketSession(date = new Date())` evaluates a supplied `Date`. Calendar flags and session hours use `America/New_York`.

| Output | Contract |
| --- | --- |
| `session` | `'pre-market'`, `'regular-market'`, `'post-market'`, or `'closed'`. |
| `isDST` | Boolean: New York is UTC−4 at the evaluated instant. |
| `isHoliday` | Boolean: observed recurring full-day NYSE holiday; false on weekends. |
| `isWeekday`, `isWeekend` | Complementary booleans: Monday–Friday / Saturday–Sunday, independent of holidays. |
| `market`, `preMarket`, `regularMarket`, `postMarket` | `{ isOpen, last, next }` windows: 04:00–20:00, 04:00–09:30, 09:30–16:00, 16:00–20:00 respectively. |
| `HOUR_IN_S`, `HOUR_IN_MS`, `DAY_IN_S`, `DAY_IN_MS` | Numbers: `3600`, `3600000`, `86400`, `86400000` respectively. |

Each window's `isOpen` is boolean: opening inclusive, closing exclusive. `last` is its most recently opened occurrence; `next` opens strictly after the evaluated instant. Both skip weekends and holidays and contain:

| Field | Contract |
| --- | --- |
| `opensAt`, `closesAt` | Numeric Unix timestamps in milliseconds. |
| `timeToOpen` | Milliseconds until opening for `next`; always `0` for `last`. |
| `openHour`, `openMinute` | Numeric UTC opening hour and minute for that occurrence, accounting for DST. |
| `closeHour`, `closeMinute` | Numeric UTC closing hour and minute for that occurrence, accounting for DST. |

Weekends and holidays return `'closed'` with every `isOpen: false`. Uses modern recurring NYSE holidays; excludes early closes and ad-hoc closures. No network calls or order authorization.

These methods retain their existing signatures. The new methods trim and uppercase ticker inputs; existing market methods retain their original symbol handling.

## Orders

`createLimitOrder(options)`, `createMarketOrder(options)`, and `placeOrder(params)` each fetch one fresh symbol-rule snapshot and submit at most once. They return the raw placement acknowledgement, such as `{ status: 'S', orderId, clientOrderId }`. Extra response fields, missing optional fields, and decimal strings are preserved. `{ status: 'F', ... }` is a valid failed acknowledgement and resolves normally. `S` means accepted; it does not prove a fill.

Symbol rules require positive plain decimal strings for `stepSize`, `maxQty`, and `maxNotional`, and a nonnegative plain decimal string for `minNotional`. `minQty` is optional: omission or `undefined` means no quantity floor is supplied. When present, it must be a finite nonnegative plain decimal string (`'0'` is valid) no greater than `maxQty`; `null`, numbers, negative values, and malformed strings are rejected. No synthetic minimum is added, and `getSymbolInfo()` preserves the raw symbol row. Quantities must still be positive, exactly aligned to `stepSize`, and within `maxQty` and any supplied `minQty`; known notionals must satisfy their bounds. Tradability and applicable LIMIT session/fractional rules still apply in both Node.js and GAS.

These three placement methods accept these common options:

| Option | Contract |
| --- | --- |
| `symbol` | Required nonempty ticker string, normalized to uppercase. |
| `side` | `BUY` (default) or `SELL`. |
| `timeInForce` | `DAY` (default) or `GTC`. `GTC` requires LIMIT. |
| `quoteAsset` | `USDC` (default); every request sends it. Other values are rejected. |
| `walletType` | Optional `CARD` or `MAIN`. Omission keeps the server default. SELL always settles to CARD, so SELL with MAIN is rejected. |
| `tokenize` | Optional boolean; explicit `false` is preserved. Omission keeps the server default. |
| `clientOrderId` | Optional string matching `/^[A-Za-z0-9_-]{32,36}$/`. When omitted, the client generates one UUID for the submission. |
| `recvWindow` | Optional signed-request window in milliseconds. |
| `maxSpreadPercent` | Finite JavaScript number with `0 < maxSpreadPercent <= 2`, in percentage points; omitted or `undefined` uses `2` (2%). Always enforced for BUY and SELL. |

Options must be plain objects. Unsupported fields are rejected; fields with `undefined` values are treated as omitted. Explicit `null` values for `side`, `timeInForce`, and `quoteAsset` are rejected in both Node.js and GAS. Enumerations are case sensitive. Prices, quantities, and notionals accept positive plain decimal strings or finite positive numbers, and numbers are converted to their JavaScript decimal representation. Decimal strings are preferred when preserving input precision matters. LIMIT prices must have at most two decimal places, including trailing decimal zeros in a string; prices are never rounded.

### Monetary convenience methods

`createLimitOrder({ symbol, amountInUSD, entryPrice, tradingSession, rejectMarketable = false, maxSpreadPercent = 2, ...commonOptions })`

`amountInUSD` must be a finite JavaScript **number greater than zero**; numeric strings are rejected. It is the target USD order value before fees, funded in USDC, without currency conversion. The method computes `floor(amountInUSD / entryPrice / stepSize) × stepSize` using exact decimal arithmetic. Both BUY and SELL use the validated price that will be submitted. A rounded quantity of zero or a quantity/notional below the symbol minimum is rejected rather than increased.

`tradingSession` is required: `RTH`, `EXTENDED`, or `24H`. Requested extended and overnight sessions must be supported by the symbol. Fractional LIMIT orders must have the applicable regular or extended fractional support. Fractional GTC requires EXTENDED or 24H. Binance remains authoritative for current session availability, price bands, account restrictions, and execution.

Set the optional boolean `rejectMarketable: true` to check the same quote used by the required spread guard, after sizing and rule validation. BUY rejects when `entryPrice >= askPrice`; SELL rejects when `entryPrice <= bidPrice`. Comparisons use exact decimals. A missing or invalid required quote price, a mismatched quote symbol when present, or a failed quote request also rejects the order before submission. The guard never adjusts price or quantity, retries, or sends `rejectMarketable` to Binance. Omission or `false` skips the marketability check. This option belongs to `createLimitOrder`; direct `placeOrder` and `createMarketOrder` do not accept it.

This guard reduces accidental immediate executions but cannot guarantee a resting order. Binance documents quotes as potentially approximately five seconds old, and the market may move between checking and submission. The Stocks placement API does not document a post-only option. See [Latest Quote](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/market-data#latest-quote-market_data) and [Place Equity Order](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/trade#place-equity-order-trade).

```js
// Submits a real order when executed with live credentials.
const ack = await client.createLimitOrder({
  symbol: 'AAPL',
  side: 'BUY',
  amountInUSD: 100,
  entryPrice: '180.50',
  tradingSession: 'RTH',
  rejectMarketable: true,
  tokenize: false
})
```

`createMarketOrder({ symbol, amountInUSD, maxSpreadPercent = 2, ...commonOptions })`

A BUY sends `amountInUSD` as decimal-string `notional`, without deriving quantity. Both sides fetch one quote for the required spread check. A SELL reuses that quote to size down using its valid positive `bidPrice` and the symbol step size. Missing or invalid bids reject SELL sizing. When present, `quote.symbol` must be a nonempty string matching the order symbol after trimming and uppercasing; invalid or mismatched symbols reject before submission. The method rejects `price`, `entryPrice`, `tradingSession`, `quantity`, `notional`, and GTC. Market requests have no session field; session-specific fractional acceptance is left to Binance.

```js
const ack = await client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100, maxSpreadPercent: 0.1 })
```

`createLimitOrder`, `createMarketOrder`, `placeOrder`, and `sellPositions` always enforce `maxSpreadPercent`, default `2` (2%); `0.1` means 0.1%. Omission and `undefined` use the default. Zero, `null`, strings, `NaN`, infinities, and numbers outside `0 < maxSpreadPercent <= 2` are rejected. Before submission, reject when `200 × (askPrice − bidPrice) / (askPrice + bidPrice) > maxSpreadPercent`, using exact decimals. Equality passes, including exactly 2% at the default. Missing, invalid, nonpositive or crossed prices, an invalid/mismatched quote symbol when present, or a failed quote request also reject. Each order uses one quote, shared with SELL sizing or LIMIT `rejectMarketable` checks. Quote validation failures reach `errorLogger` and reject without submission or automatic retry. The guard never changes sizing or prices or sends `maxSpreadPercent` to Binance. Raw `apiClient('placeOrder', ...)` calls are rejected; use a placement method. This checks the quoted spread, not quote age, market hours, available size, execution slippage or fair value.

The monetary helpers never send `amountInUSD` or `entryPrice` to Binance. Final spend or proceeds may differ because of rounding, fees, and execution price. These helpers do not use the equity wallet to authorize or resize a SELL; `sellPositions` uses it as the source of positions and quantities.

### Explicit placement

`placeOrder({ symbol, orderType, maxSpreadPercent = 2, ...fields, ...commonOptions })`

| Combination | Required fields | Forbidden fields |
| --- | --- | --- |
| BUY LIMIT | `price`, `quantity`, `tradingSession` | `notional` |
| SELL LIMIT | `price`, `quantity`, `tradingSession` | `notional` |
| BUY MARKET | `notional` | `price`, `quantity`, `tradingSession` |
| SELL MARKET | `quantity` | `price`, `notional`, `tradingSession` |

`amountInUSD` and `entryPrice` are rejected by this method. Explicit quantities must already match the exact step increment and symbol bounds; the client never resizes them. Known notionals are checked: LIMIT price × quantity, MARKET BUY notional, and the estimated bid notional for convenience MARKET SELL. A direct MARKET SELL has no supplied price, so Binance validates its execution notional.

```js
const ack = await client.placeOrder({
  symbol: 'AAPL', orderType: 'LIMIT', side: 'SELL',
  quantity: '1.25', price: '180.50', tradingSession: 'EXTENDED',
  timeInForce: 'GTC', walletType: 'CARD'
})
```

On a placement transport or response error, the propagated Error retains its identity/type/message and gains `clientOrderId` before `errorLogger` runs, when the error object permits that field. Use it with `getOrder({ clientOrderId: error.clientOrderId })` to reconcile an uncertain outcome before deciding on another order. There are no automatic retries, replacement IDs, fallback lookups, or polling.

### Selling positions

`sellPositions(null | [{ symbol }])`

Uses one `getEquityWallet()` call with its default history window as the source of truth for positions and quantities. Pass explicit `null` to target every wallet position, or an array of plain `{ symbol }` objects to target only those symbols. Symbols are trimmed, uppercased, and deduplicated in first-occurrence order. Unsupported fields are rejected using the same options rules as other methods. Missing arguments, `undefined`, and malformed entries reject before any API calls. An empty array returns `[]` without API calls.

The wallet call also fetches a current quote for every nonzero wallet position to estimate PnL, including symbols outside the selection. A failed history or wallet quote request rejects before any sells are submitted. Each selected order still obtains its own fresh spread-check quote.

Each selected position is submitted sequentially through `placeOrder({ symbol, side: 'SELL', orderType: 'MARKET', quantity: position.amount })`, including the required 2% spread check. The decimal-string amount is passed unchanged; the quote validates the spread without USD sizing, rounding, or splitting. Existing placement defaults and validations apply, including `USDC`, `DAY`, exact step increments, and quantity bounds. Binance validates the execution notional. Spread failures are returned as per-position errors and processing continues.

```js
const results = await client.sellPositions(null)
```

Or sell only selected positions:

```js
const results = await client.sellPositions([{ symbol: 'AAPL' }, { symbol: 'NVDA' }])
```

Returns an array in wallet-key order for `null`, or normalized selection order for an array:

- `{ symbol, quantity, ack }` preserves the raw Binance acknowledgement, including failed acknowledgements with `status: 'F'`. `status: 'S'` means accepted, not filled.
- `{ symbol, quantity, error }` preserves the original error, including `error.clientOrderId` when available for reconciliation through `getOrder`.
- `{ symbol, skipped: 'NO_POSITION' }` reports a requested symbol absent from the wallet.

A wallet failure rejects the entire call before any orders are submitted. An empty wallet with `null` returns `[]`. Individual placement failures are collected and processing continues; earlier submissions are not rolled back. There are no automatic retries, cancellations, or fill polling. Reconcile uncertain submissions before submitting another sell for the same position.

### Detail and cancellation

| Method | Contract |
| --- | --- |
| `getOrder({ orderId, clientOrderId, recvWindow })` | Require at least one nonempty string identifier; forward both if provided. Return raw detail including `qty`, optional `fee`, `avgFilledPrice`, and `trades`. |
| `getOpenOrders({ recvWindow } = {})` | Return the raw open-order array, including `[]`. No symbol filter. |
| `cancelOrder({ orderId, recvWindow })` | Require a nonempty order ID; call the signed POST once and return the raw `{ orderId, status, ... }` acknowledgement. Request errors gain `orderId`. |
| `cancelAllOrders({ recvWindow } = {})` | Call the dedicated signed POST once and return raw `{ success: boolean, ... }`. No filters or per-order cancellation loop. |

Cancellation acknowledgement does not establish the final state of an order. Query detail explicitly when needed.

## History

`getOrderHistory(options)` and `getTradeHistory(options)` require safe nonnegative integer `startTime` and `endTime` in epoch milliseconds, with `startTime <= endTime`. Each call fetches exactly one page.

| Option | Default / allowed values |
| --- | --- |
| `current` | 1; positive safe integer. |
| `size` | 20; integer from 1 through 100. |
| `symbol`, `side` | Optional ticker and BUY/SELL filters; no implicit side filter. |
| `recvWindow` | Optional signed-request window. |
| `orderType` | Order history only: MARKET or LIMIT. |
| `orderStatus` | Order history only: comma-separated FILLED, PARTIALLY_FILLED, CANCELED, EXPIRED, REJECTED. |
| `orderId` | Trade history only: nonempty order ID string. |

```js
const trades = await client.getTradeHistory({
  startTime: 0, endTime: Date.now(), current: 1, size: 100, symbol: 'AAPL'
})
// { total, page, size, rows: [{ executionId, orderId, symbol, side, qty, ... }] }
```

The request field is `current`; the response field is `page`. Both methods return Binance's raw page, preserving row order and optional fields. Each trade row is one fill, and multiple fills can belong to one order. Direct endpoint query failures propagate.

## Wallets and portfolio

`getEquityWallet({ startTime = 0, endTime = Date.now(), recvWindow } = {})`

Fetches all sequential trade-history pages with `size: 100`, without symbol or side filters, then one current quote per nonzero estimated position. The end time is captured once. Pagination metadata must match the requested page and size and a stable total; incomplete, repeated, nonadvancing, inconsistent, malformed, or failed pages reject the operation rather than return a partial estimate. Identical complete rows are deduplicated by `executionId`; conflicting rows sharing an ID are rejected. The final distinct execution count must equal the reported total, so duplicate rows cannot conceal missing fills. Each fill requires positive decimal-string `qty` and `price`, and a nonnegative safe integer `executionAt`. BUY and SELL totals are aggregated exactly before subtraction. Zero final holdings are omitted.

All available wallet values are decimal strings. `costBasisUsd` is the remaining acquisition cost before fees, reconstructed using a moving weighted average after sorting fills by `executionAt`. BUY adds `qty × price`; SELL removes the proportional cost of the sold shares, without subtracting sale proceeds. Closing a position resets its cost basis before any later purchases. Proportional cost reductions and PnL percentages use half-up decimal division to 24 decimal places, extended for tiny quotients to retain at least 24 significant digits; amounts remain exact.

`unrealizedPnlUsd = amount × currentBid − costBasisUsd`. `unrealizedPnlPercent = unrealizedPnlUsd / costBasisUsd × 100`, so `'20'` means 20%. Both fields are estimates before fees, slippage, and taxes, using current bids rather than historical quotes. A successful quote response without a matching positive bid preserves the amount and known cost basis but returns `null` for both PnL fields. A failed quote request rejects the wallet.

```js
const equity = await client.getEquityWallet()
// {
//   NVDA: {
//     amount: '3', costBasisUsd: '750',
//     unrealizedPnlUsd: '150', unrealizedPnlPercent: '20'
//   }
// }
```

If total sells exceed total buys, the selected trade window cannot establish a nonnegative estimate and the method rejects. This does not imply the account balance is invalid. If the final amount is positive but chronological sells exceed the holdings established so far, or BUY and SELL fills share an execution timestamp without a documented ordering, the amount is retained while `costBasisUsd` and both PnL fields are `null`. Fills omit pre-window holdings, transfers, tokenized mint/redeem activity, settlement, corporate actions, and other adjustments. Even a window beginning at zero is only an estimate. Large histories may exceed API or runtime limits; there is no cache, cooldown, or pagination resume facility.

`getFundingWallet({ recvWindow } = {})`

Calls the signed Funding Wallet endpoint `POST /sapi/v1/asset/get-funding-asset` with `asset: 'USDC'`. This read operation is the library's explicit exception to the `/sapi/v1/equity/` route prefix. It validates the USDC decimal-string fields and computes `amount = free + locked` exactly. `freeze` and `withdrawing` are returned separately. No USDC record produces five zero strings; malformed USDC records are rejected.

```js
const funding = await client.getFundingWallet()
// { USDC: { free: '5900', locked: '5', freeze: '0', withdrawing: '0', amount: '5905' } }
```

`amount` includes locked funds and is not all spendable cash. This method does not substitute the Spot Wallet for the Funding Wallet.

`getPortfolio({ startTime, endTime, recvWindow } = {})`

Combines the same equity reconstruction and bid-based PnL calculation as `getEquityWallet()` with the current Funding Wallet. It fetches history once and one current quote per nonzero estimated position, sharing each quote between valuation and PnL. History options select fills, not historical prices or a historical funding balance. Positions are valued at positive bids; cash uses free + locked and the explicit USDC/USD reporting assumption of 1. Calculations use decimal arithmetic, with cost and percentage division rounded as described above, before conversion to finite JavaScript numbers; overflow and nonzero underflow are rejected. Numeric conversion may lose decimal precision. Weights are rounded to four decimal places with half-up ties and may not sum to exactly one.

Each position includes numeric `costBasisUsd`, `unrealizedPnlUsd`, and `unrealizedPnlPercent`, or `null` when unavailable. Global `totals.unrealizedPnlUsd` is the sum of open-position PnL; `totals.unrealizedPnlPercent` divides that sum by the combined remaining cost basis and multiplies by 100. It is not an average of position percentages, and cash is excluded. If any position lacks a valid bid or known cost basis, both global PnL fields are `null`, while other available position results are retained.

```js
const portfolio = await client.getPortfolio()
// {
//   totals: {
//     totalUsd: 6805, positionsUsd: 900, cashUsd: 5905,
//     unrealizedPnlUsd: 150, unrealizedPnlPercent: 20
//   },
//   cash: { USDC: { amount: 5905, quote: 1, usd: 5905, weight: 0.8677 } },
//   positions: {
//     NVDA: {
//       amount: 3, quote: 300, usd: 900, weight: 0.1323,
//       costBasisUsd: 750, unrealizedPnlUsd: 150, unrealizedPnlPercent: 20
//     }
//   }
// }
```

A successful quote response with no valid positive bid leaves that position's `amount` and known cost basis intact and sets its `quote`, `usd`, and PnL fields to `null`. A present `quote.symbol` that is invalid or does not match the position symbol after trimming and uppercasing has the same effect. It also sets `positionsUsd`, `totalUsd`, and every weight to `null`, preserving cash and other available position values. An unknown cost basis alone does not prevent market valuation or weight calculation. A rejected quote request rejects the report. Cash is always included; an empty portfolio has zero USD totals and null weights, while positive cash alone has weight 1. With no open positions, global unrealized PnL is `0` USD and its percentage is `null`. Reads occur sequentially and are not an atomic account snapshot.

## Verification and build

```sh
npm run test:offline
npm run build
```

The offline suite uses dummy credentials, mocked HTTP, and mocked GAS services to test both runtime entry points, signing, order validation/sizing, reconciliation errors, pagination, and reports. It makes no live requests.

The existing `npm test` command runs `test/test.js` and uses `.env` credentials for live GET quote and exchange-info requests. It is separate from the offline suite. Never use live credentials in POST, PUT, or DELETE tests, including the read-only Funding Wallet POST. Generate the GAS bundle through `npm run build`; do not edit it manually.
