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

`estimatedExitBuffer` optionally configures automatic fractional-exit reserves once on the client. It is a plain symbol-to-reserve map, such as `{ OKTA: '0.00000001' }`, and defaults to an empty map with automatic buffering disabled. Reserves are share quantities, not USD amounts: each must be a positive plain decimal string less than one share. Symbol keys are trimmed and uppercased; duplicate normalized keys reject. The client keeps a frozen copy, so later mutations of the supplied map do not change its policy. A configured symbol classifies its raw direct SELL quantities as estimated exits; use this policy only for that workflow and use `quantityMode: 'EXACT'` for finalized quantities.

`errorLogger(error)` defaults to `console.error` and accepts synchronous or async callbacks in Node.js, Cloudflare Workers, and GAS. The library awaits the callback before propagating the original failure. A callback that throws or rejects is ignored; its failure never replaces or wraps the original error. Logging covers API adapter errors, order quote-validation errors, and `beforeSubmit` failures. Public input validation, symbol-rule validation, and wallet/report reconstruction errors outside the adapters are not automatically logged.

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

Instance methods use standard class receiver binding. Call them on the client instance, or bind them when passing them as callbacks, for example `client.getQuote.bind(client)`.

Every endpoint receives `X-MBX-APIKEY`. `TRADE` and `USER_DATA` requests receive a fresh timestamp and HMAC signature. `USER_STREAM` requests receive a fresh timestamp without a signature. Signed and `USER_STREAM` calls accept a per-call `recvWindow`: a safe integer from 1 to 60000 milliseconds, default 5000. `MARKET_DATA` requests omit the timestamp, receive window, and signature.

## Market methods

| Method | Result |
| --- | --- |
| `getQuote(symbol)` | Promise of the raw quote response, or `null` for a successful empty response. Quotes include `bidPrice` and `askPrice` decimal strings when available. |
| `getExchangeInfo()` | Promise of the raw exchange-info response, including `timezone` and `symbols`. Fetches fresh exchange info on every call. |
| `getSymbolInfo(symbol)` | Promise of the matching exchange-info rule object, or `undefined` if absent. Fetches fresh exchange info on every call; matching is case sensitive. |
| `BinanceStocks.getNyMarketSession(date = new Date())` | Static method returning a synchronous session object for the supplied date; contract below. |

Call the market-data getters on the client instance and the session helper on the class:

```js
const exchangeInfo = await client.getExchangeInfo()
const session = BinanceStocks.getNyMarketSession(new Date())
```

The session helper evaluates a supplied `Date`, defaulting to the current time. Calendar flags and session hours use `America/New_York`.

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

## Orders

`createLimitOrder(options)`, `createMarketOrder(options)`, and `placeOrder(params)` each fetch one fresh symbol-rule snapshot and submit at most once. They return the raw placement acknowledgement, such as `{ status: 'S', orderId, clientOrderId }`. Extra response fields, missing optional fields, and decimal strings are preserved. `{ status: 'F', ... }` is a valid failed acknowledgement and resolves normally. `S` means accepted; it does not prove a fill.

Symbol rules require positive plain decimal strings for `stepSize`, `maxQty`, and `maxNotional`, and a nonnegative plain decimal string for `minNotional`. `minQty` is optional: omission or `undefined` means no quantity floor is supplied. When present, it must be a finite nonnegative plain decimal string (`'0'` is valid) no greater than `maxQty`; `null`, numbers, negative values, and malformed strings are rejected. No synthetic minimum is added, and `getSymbolInfo()` preserves the raw symbol row. Quantities must still be positive, exactly aligned to `stepSize`, and within `maxQty` and any supplied `minQty`; known notionals must satisfy their bounds. Tradability and applicable LIMIT session/fractional rules still apply in both Node.js and GAS. `OFFMARKET`, `NONE`, unsupported tradability values, and disallowed order directions reject. A small `stepSize` does not imply fractional permission: LIMIT orders check the applicable `fractionable` or `fractionableEh` flag and session support. MARKET orders retain their existing validation contract and never send `tradingSession`.

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
| `bufferSteps` | SELL only. Optional nonnegative safe integer that overrides the client reserve policy for that call. Explicit `0` disables automatic buffering and performs step rounding only; a positive value subtracts that many current symbol steps. Manual positive buffering rejects whole-share quantities. |
| `maxSellQuantity` | SELL only. Optional positive plain decimal string used as a share cap before buffering and final step rounding. Numbers, zero, signs, whitespace, and exponent notation are rejected. |
| `beforeSubmit` | Optional synchronous or async function, awaited once with the read-only final order after validation and client ID assignment, before submission. A thrown or rejected failure prevents submission. |

Options must be plain objects. Unsupported fields are rejected; fields with `undefined` values are treated as omitted. Explicit `null` values for `side`, `timeInForce`, and `quoteAsset` are rejected in both Node.js and GAS. Enumerations are case sensitive. Prices, quantities, and notionals accept positive plain decimal strings or finite positive numbers, and numbers are converted to their JavaScript decimal representation. Decimal strings are preferred when preserving input precision matters. LIMIT prices must have at most two decimal places, including trailing decimal zeros in a string; prices are never rounded.

### Monetary convenience methods

`createLimitOrder({ symbol, amountInUSD, entryPrice, tradingSession, rejectMarketable = false, maxSpreadPercent = 2, ...commonOptions })`

`amountInUSD` must be a finite JavaScript **number greater than zero**; numeric strings are rejected. It is the target USD order value before fees, funded in USDC, without currency conversion. The method computes `floor(amountInUSD / entryPrice / stepSize) × stepSize` using exact decimal arithmetic. Both BUY and SELL use the validated price that will be submitted. A SELL then applies any `maxSellQuantity`, eligible client reserve or manual buffer, and final step rounding. Automatic buffering requires a share cap and a monetary target that reaches the cap rounded down to the current step; smaller targets and uncapped monetary sells receive no automatic buffer. The final quantity is validated; zero or a quantity/notional below the symbol minimum is rejected rather than increased.

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

A BUY sends `amountInUSD` as decimal-string `notional`, without deriving quantity. Both sides fetch one quote for the required spread check. A SELL reuses that quote to size down using its valid positive `bidPrice` and the symbol step size, then applies any explicit share cap and eligible buffer before final validation. Automatic buffering has the same full-cap requirement as LIMIT monetary sells. Missing or invalid bids reject SELL sizing. When present, `quote.symbol` must be a nonempty string matching the order symbol after trimming and uppercasing; invalid or mismatched symbols reject before submission. The method rejects `price`, `entryPrice`, `tradingSession`, `quantity`, `notional`, and GTC. Market requests have no session field; session-specific fractional acceptance is left to Binance.

```js
const ack = await client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100, maxSpreadPercent: 0.1 })
```

`createLimitOrder`, `createMarketOrder`, `placeOrder`, and `sellPositions` always enforce `maxSpreadPercent`, default `2` (2%); `0.1` means 0.1%. Omission and `undefined` use the default. Zero, `null`, strings, `NaN`, infinities, and numbers outside `0 < maxSpreadPercent <= 2` are rejected. Before submission, reject when `200 × (askPrice − bidPrice) / (askPrice + bidPrice) > maxSpreadPercent`, using exact decimals. Equality passes, including exactly 2% at the default. Missing, invalid, nonpositive or crossed prices, an invalid/mismatched quote symbol when present, or a failed quote request also reject. Each order uses one quote, shared with SELL sizing or LIMIT `rejectMarketable` checks. Quote validation failures reach `errorLogger` and reject without submission or automatic retry. The guard never changes sizing or prices or sends `maxSpreadPercent` to Binance. Raw `apiClient('placeOrder', ...)` calls are rejected; use a placement method. This checks the quoted spread, not quote age, market hours, available size, execution slippage or fair value.

The monetary helpers never send `amountInUSD` or `entryPrice` to Binance. Final spend or proceeds may differ because of rounding, a share cap or buffer, fees, and execution price. These helpers do not fetch the equity wallet to authorize a SELL; callers can supply its exact reconstructed quantity, or a portfolio position's `amountExact`, as `maxSellQuantity`. `sellPositions` obtains its position estimates from the wallet.

### Explicit placement

`placeOrder({ symbol, orderType, quantityMode, maxSpreadPercent = 2, ...fields, ...commonOptions })`

| Combination | Required fields | Forbidden fields |
| --- | --- | --- |
| BUY LIMIT | `price`, `quantity`, `tradingSession` | `notional` |
| SELL LIMIT | `price`, `quantity`, `tradingSession` | `notional` |
| BUY MARKET | `notional` | `price`, `quantity`, `tradingSession` |
| SELL MARKET | `quantity` | `price`, `notional`, `tradingSession` |

`amountInUSD` and `entryPrice` are rejected by this method. Without a matching client policy or supplied SELL sizing options, quantities are preserved and must already match the exact step increment and symbol bounds. For a policy-configured symbol, a raw SELL quantity is treated as an estimated exit and prepared internally. `quantityMode: 'EXACT'` preserves an already-finalized order even on a policy-enabled client: it rejects `bufferSteps` and `maxSellQuantity` and validates without resizing or rounding. `quantityMode: 'ESTIMATED_EXIT'` explicitly identifies a SELL estimate and requires either a matching policy or manual `bufferSteps`; it rejects BUY orders. Other mode values reject. This option belongs to `placeOrder`.

Manual SELL sizing uses current rules; explicit `bufferSteps: 0` overrides the automatic policy and performs step rounding only. Known notionals are checked: LIMIT price × final quantity, MARKET BUY notional, and estimated bid notional for convenience or adjusted MARKET SELLs. For an unadjusted direct MARKET SELL, Binance validates its execution notional.

```js
const ack = await client.placeOrder({
  symbol: 'AAPL', orderType: 'LIMIT', side: 'SELL',
  quantity: '1.25', price: '180.50', tradingSession: 'EXTENDED',
  timeInForce: 'GTC', walletType: 'CARD', quantityMode: 'EXACT'
})
```

On a placement transport or response error, the propagated Error retains its identity/type/message and gains `clientOrderId` before `errorLogger` runs, when the error object permits that field. Use it with `getOrder({ clientOrderId: error.clientOrderId })` to reconcile an uncertain outcome before deciding on another order. There are no automatic retries, replacement IDs, fallback lookups, or polling.

### Direct estimated-position exits

The existing placement methods perform SELL preparation internally using the client reserve policy or supplied sizing options. They fetch the current symbol `stepSize`; callers do not supply it. `bufferSteps` and `maxSellQuantity` reject BUY orders, including `bufferSteps: 0`. The client policy never buffers BUY orders or unconfigured symbols. Quantities, reserve alignment, caps, and final rounding use exact decimal arithmetic:

```text
cappedQuantity = min(quantity, maxSellQuantity)  // when a cap is supplied
automaticBuffer = ceil(configuredReserve / stepSize) × stepSize
manualBuffer = stepSize × bufferSteps          // overrides the client policy
buffer = manualBuffer, eligible automaticBuffer, or zero
finalQuantity = floor((cappedQuantity − buffer) / stepSize) × stepSize
```

Automatic reserves are limited to deliberate estimated fractional exits. A quantity that becomes a whole share count after step rounding receives no positive automatic buffer, including `'3.000'` and a tiny excess that rounds to `'3'`. A rounded-up automatic reserve of one share or more rejects. Manual positive `bufferSteps` still rejects an effective whole-share quantity. A buffer that consumes the quantity, a rounded result of zero, or a final quantity below applicable minimums rejects without placement. Quantities are never increased to satisfy a minimum. All final step, quantity, notional, tradability, and applicable session/fractional checks remain enforced.

Configure the reserve once, then use the exact wallet amount directly without per-order `bufferSteps`:

```js
const client = new BinanceStocks({
  API_KEY: process.env.BINANCE_API_KEY,
  API_SECRET: process.env.BINANCE_API_SECRET,
  estimatedExitBuffer: { OKTA: '0.00000001' }
})
const wallet = await client.getEquityWallet()
const ack = await client.placeOrder({
  symbol: 'OKTA', side: 'SELL', orderType: 'MARKET',
  quantity: wallet.OKTA.amount
})
```

For a monetary exit based on a portfolio valuation, pass the exact share cap as well:

```js
const portfolio = await client.getPortfolio()
const position = portfolio.positions.OKTA
const ack = await client.createMarketOrder({
  symbol: 'OKTA', side: 'SELL', amountInUSD: position.usd,
  maxSellQuantity: position.amountExact
})
```

For a LIMIT SELL, use the same portfolio position with the required price and session:

```js
const limitAck = await client.createLimitOrder({
  symbol: 'OKTA', side: 'SELL', amountInUSD: position.usd,
  entryPrice: '80.00', tradingSession: 'RTH',
  maxSellQuantity: position.amountExact
})
```

Choose the MARKET or LIMIT example for the intended order; they are alternative flows. The cap is needed because converting a portfolio's USD value at a different order price can otherwise request more shares than its reconstructed quantity. A cap is an upper bound: it does not force an entire position to sell when the monetary target sizes a smaller order, and the client policy does not automatically buffer that smaller target. A supplied `bufferSteps` overrides the policy, including zero to disable the automatic reserve for that call.

In the observed OKTA case, reconstructed holdings were `'27.44440023'`, the Binance App showed `'27.44440022'` available to sell, and the step was `'0.000000001'`. Rounding alone leaves `'27.44440023'`; one step leaves `'27.444400229'`. Configuring a reserve of `'0.00000001'` computes ten current steps and produces `'27.44440022'`. If the current step changes, the SDK computes the smallest whole-step reserve at least as large as the configured amount instead of assuming ten steps.

The reserve is a chosen conservative heuristic, not a balance-derived calculation or a proven universal bound. `.storage/exchangeInfo.json` contains symbol trading rules, not available-share balances or a documented maximum discrepancy; its observed tiny steps do not imply fractional permission. The SDK fetches current rules at placement and does not load that snapshot as runtime policy. Binance Stocks currently has no authoritative available-share balance endpoint. A cap or buffer uses an estimate and does not verify available shares, reserve them, or guarantee acceptance. Snapshot values such as MU's supplied `minQty` and SPCX's different `maxQty` are not universal trading rules.

`getEquityWallet()` and `getPortfolio()` retain unbuffered quantities, cost basis, and PnL. Use `getPortfolio().positions[symbol].amountExact` when passing an exact share cap; its numeric `amount` remains a reporting value.

### Persisting the final order

All placement methods, including `sellPositions`, accept `beforeSubmit(finalOrder)`. The SDK calls it once after sizing, final rule and quote checks, and client order ID assignment, then awaits successful completion before the single submission. `finalOrder` is a frozen snapshot of the submitted order fields plus the effective `maxSpreadPercent` and `quantityMode: 'EXACT'`. It excludes `bufferSteps`, `maxSellQuantity`, and `beforeSubmit`. Keep the `EXACT` marker when persisting or later passing the snapshot to `placeOrder`; it prevents a client reserve from buffering the final quantity a second time. This SDK marker is never sent to Binance. The placement method still returns Binance's raw acknowledgement.

Persist immutable intents from this callback rather than saving a pre-adjustment quantity. In this example, `intentStore` is the application's durable storage adapter:

```js
const ack = await client.placeOrder({
  symbol: 'OKTA', side: 'SELL', orderType: 'MARKET',
  quantity: wallet.OKTA.amount,
  beforeSubmit: async finalOrder => {
    await intentStore.save(finalOrder)
  }
})
```

The callback may be synchronous or async. Return values are ignored; throw or reject to prevent submission. A failure reaches `errorLogger` with `clientOrderId` attached when possible and propagates as the original error; no order is submitted. A callback must be a function when supplied: `null` and other values reject before API requests. Keep callbacks short because quotes and trading conditions can change while persistence is awaited. Persistence and the exchange request are not atomic: a successfully saved intent followed by a failed or uncertain submission requires reconciliation, without automatic retry, replacement order, cancellation, or polling. A persisted final snapshot can be passed to `placeOrder` for fresh validation and exact-quantity placement only after the application has reconciled any earlier submission.

### Selling positions

`sellPositions(null | [{ symbol }], { bufferSteps, beforeSubmit } = {})`

Uses one `getEquityWallet()` call with its default history window as the source of estimated positions and quantities. Pass explicit `null` to target every wallet position, or an array of plain `{ symbol }` objects to target only those symbols. Symbols are trimmed, uppercased, and deduplicated in first-occurrence order. Unsupported fields and invalid buffer options are rejected using the same options rules as other methods. Missing selections, `undefined`, and malformed entries reject before any API calls. An empty array returns `[]` without API calls.

The wallet call also fetches a current quote for every nonzero wallet position to estimate PnL, including symbols outside the selection. A failed history or wallet quote request rejects before any sells are submitted. Each selected order still obtains its own fresh spread-check quote.

Each selected position fetches one fresh symbol-rule snapshot, prepares its final quantity internally, and submits a MARKET SELL sequentially through the shared placement guard. Omitted or `undefined` `bufferSteps` uses the matching client policy for fractional estimates; without a matching policy it performs step rounding only. Automatic buffering skips quantities that become whole shares after alignment. Explicit `bufferSteps` overrides the policy: zero rounds only, while a positive value applies the manual buffer and rejects whole-share quantities. Existing defaults and validations apply, including `USDC`, `DAY`, tradability, exact step increments, `maxQty`, and any supplied `minQty`. The fresh spread-check quote also estimates the adjusted bid notional for `minNotional` and `maxNotional` validation. Sizes below minimums reject without placement or any increase; Binance still validates the execution notional. The required 2% spread protection, client order IDs, and error logging use the same path as other placements. A supplied `beforeSubmit` runs once for each final order that reaches submission; callback failures are returned as per-position errors and processing continues. Other per-position failures are also returned and processing continues.

```js
const results = await client.sellPositions(null)
```

Or sell only selected positions:

```js
const results = await client.sellPositions([{ symbol: 'AAPL' }, { symbol: 'NVDA' }])
```

With the client policy configured above, no per-call buffer is needed for a selected exit:

```js
const results = await client.sellPositions([{ symbol: 'OKTA' }])
// With the estimate and stepSize above, results[0].quantity is '27.44440022'.
```

Returns an array in wallet-key order for `null`, or normalized selection order for an array:

- `{ symbol, quantity, ack }` includes the actual submitted prepared quantity and preserves the raw Binance acknowledgement, including failed acknowledgements with `status: 'F'`. `status: 'S'` means accepted, not filled.
- `{ symbol, quantity, error }` preserves the original error, including `error.clientOrderId` when available for reconciliation through `getOrder`. `quantity` is the prepared quantity when preparation succeeded, or the original estimate if rule loading or preparation failed. An error may occur before any submission.
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

Combines the same equity reconstruction and bid-based PnL calculation as `getEquityWallet()` with the current Funding Wallet. It fetches history once and one current quote per nonzero estimated position, sharing each quote between valuation and PnL. History options select fills, not historical prices or a historical funding balance. Positions are valued at positive bids; cash uses free + locked and the explicit USDC/USD reporting assumption of 1. Calculations use decimal arithmetic, with cost and percentage division rounded as described above, before conversion to finite JavaScript numbers; overflow and nonzero underflow are rejected. Numeric conversion may lose decimal precision. Each position also has `amountExact`, the unbuffered reconstructed quantity as a decimal string, for exact share caps in SELL calls. The numeric `amount` and all cost, valuation, and PnL calculations remain unchanged. Weights are rounded to four decimal places with half-up ties and may not sum to exactly one.

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
//       amount: 3, amountExact: '3', quote: 300, usd: 900, weight: 0.1323,
//       costBasisUsd: 750, unrealizedPnlUsd: 150, unrealizedPnlPercent: 20
//     }
//   }
// }
```

A successful quote response with no valid positive bid leaves that position's `amount`, `amountExact`, and known cost basis intact and sets its `quote`, `usd`, and PnL fields to `null`. A present `quote.symbol` that is invalid or does not match the position symbol after trimming and uppercasing has the same effect. It also sets `positionsUsd`, `totalUsd`, and every weight to `null`, preserving cash and other available position values. An unknown cost basis alone does not prevent market valuation or weight calculation. A rejected quote request rejects the report. Cash is always included; an empty portfolio has zero USD totals and null weights, while positive cash alone has weight 1. With no open positions, global unrealized PnL is `0` USD and its percentage is `null`. Reads occur sequentially and are not an atomic account snapshot.

## Verification and build

```sh
npm run test:offline
npm run build
```

The offline suite uses dummy credentials, mocked HTTP, and mocked GAS services to test both runtime entry points, signing, order validation/sizing, reconciliation errors, pagination, and reports. It makes no live requests.

`npm test` runs `test/test.js`, uses `.env` credentials for a live GET exchange-info request, and saves the response to `.storage/exchangeInfo.json`. It is separate from the offline suite. Never use live credentials in POST, PUT, or DELETE tests, including the read-only Funding Wallet POST. Generate the GAS bundle through `npm run build`; do not edit it manually.
