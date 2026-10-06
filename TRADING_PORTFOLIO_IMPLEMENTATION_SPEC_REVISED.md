# Trading and Portfolio Methods — Implementation Specification for the Current Repository

This document replaces `TRADING_PORTFOLIO_IMPLEMENTATION_SPEC.md` as implementation guidance for the current `simple-binance-stocks` checkout. It does not claim that the requested methods already exist.

## 1. Sources, scope, and current baseline

Follow the repository's `AGENTS.md` and use `docs/schema.yaml` for Binance Stocks request and response fields. The repository's `README.md` is currently empty; write the public API contract there as part of the implementation. The Funding Wallet route is an existing, explicit exception to the equity-route prefix, defined in `src/utilities/endpointsMaster.js`.

The current public client has `getQuote(symbol)`, `getSymbolInfo(symbol)`, and `getNyMarketSession()`. Preserve their signatures, return values, and exports. The twelve methods below are new public methods in this checkout, although their endpoint definitions and some payload assertions already exist. Do not invent an “original output contract” for a method that is not implemented.

Add one helper for each new method and delegate from `src/BinanceStocksCore.js`; the Node.js and GAS subclasses inherit the common API. Keep platform-specific HTTP and cryptography in `src/node` and `src/gas`. Use ES modules and the existing module conventions. Add concise JSDoc to new or changed functions. Make focused edits; do not create legacy implementations or compatibility shims.

| Public method | Helper file |
| --- | --- |
| `createLimitOrder` | `src/actions/createLimitOrder.js` |
| `createMarketOrder` | `src/actions/createMarketOrder.js` |
| `placeOrder` | `src/actions/placeOrder.js` |
| `cancelOrder` | `src/actions/cancelOrder.js` |
| `cancelAllOrders` | `src/actions/cancelAllOrders.js` |
| `getOrder` | `src/getters/getOrder.js` |
| `getOpenOrders` | `src/getters/getOpenOrders.js` |
| `getOrderHistory` | `src/getters/getOrderHistory.js` |
| `getTradeHistory` | `src/getters/getTradeHistory.js` |
| `getEquityWallet` | `src/getters/getEquityWallet.js` |
| `getFundingWallet` | `src/getters/getFundingWallet.js` |
| `getPortfolio` | `src/getters/getPortfolio.js` |

## 2. Shared request and public API rules

Every new public method must return a `Promise` in Node.js and GAS. Make the core delegating methods or helpers `async` so this holds even though the current GAS transport is synchronous internally. Direct endpoint methods return the parsed Binance response unchanged: retain field names, decimal strings, `null`, absent optional fields, extra fields, and array or pagination shape. Do not replace acknowledgements with booleans or inferred order lifecycle states.

Send `X-MBX-APIKEY` on every exposed REST endpoint. Sign `TRADE` and `USER_DATA` calls with the existing runtime crypto adapter and a transport-generated timestamp. `MARKET_DATA` and `USER_STREAM` calls use the API key without a signature. The current Node.js and GAS transports sign all calls; correct that behavior in both adapters while preserving their public response and error behavior. Use the existing endpoint metadata to select security behavior. Do not expose the API secret in logs or errors.

The current transports also overwrite caller-supplied `recvWindow` with `5000`. Change both to retain a validated per-call override, defaulting to `5000` when omitted. The current constructor has no `recvWindow` option, so do not describe or require one. Validate supplied windows as safe integers from `1` through `60000` using the existing endpoint assertions. Add the transport-generated timestamp only to signed requests. Preserve current error logging through `errorLogger` and the current rejection behavior; there is no existing cooldown system or structured error metadata to preserve. Do not introduce automatic request retries or order polling.

Normalize tickers to uppercase at the boundary of the **new** methods, after requiring a nonempty string. Do not depend on constructor-level symbol state. Do not change the existing `getQuote` or `getSymbolInfo` public signatures. `getSymbolInfo(symbol)` currently fetches `exchangeInfo` on every call and has no cache or `{ refresh: true }` option. Use it with the normalized symbol, without a refresh argument, to obtain fresh rules for each placement. Reject missing or malformed symbol rules before submitting an order. Reuse that one fetched rule object within a logical placement; do not call the public `placeOrder` in a way that causes a second rules fetch. Shared internal preparation may accept a rule snapshot, but the public `placeOrder` must always validate and fetch rules itself.

Use `src/utilities/decimal.js` for exact nonnegative decimal arithmetic. Convert numeric inputs to their JavaScript decimal representation before decimal calculations. Never use binary floating-point intermediate division or step rounding for order sizing. The existing `Decimal.minus()` cannot represent a negative result; wallet aggregation must account for that explicitly. Its division operation yields an integer quotient, so implement four-place portfolio weight rounding with exact scaled integer arithmetic or a focused extension of this utility; do not assume a general fractional division method already exists.

Use `USDC` as the quote and funding asset. Every placement sends `quoteAsset: 'USDC'`; reject another supplied quote asset. Prices and notionals are USD-denominated values funded in USDC. Do not infer a currency conversion from a USDC balance.

For placements, validate `side` (`BUY` or `SELL`, default `BUY`), `timeInForce` (`DAY` or `GTC`, default `DAY`), `tokenize` (boolean, preserving explicit `false`), `walletType` (`CARD` or `MAIN`), and `clientOrderId` (`/^[A-Za-z0-9_-]{32,36}$/`). `GTC` is limited to LIMIT orders. A SELL settles to CARD according to the schema; reject `walletType: 'MAIN'` on SELL so callers cannot believe it redirects proceeds. `walletType: 'CARD'` may be forwarded on SELL. Omitted `tokenize` and wallet selection retain the server defaults.

The checkout has no client order ID generator. Add a small runtime-specific UUID generator using Node.js crypto in `src/node` and `Utilities.getUuid()` in `src/gas`, exposed to the shared placement helper through the corresponding client class or adapter. A generated 36-character UUID satisfies the validator. Generate one ID before each logical placement when the caller omits it; preserve a supplied valid ID. Submit only once. If a transport or response failure makes the outcome uncertain, attach the same `clientOrderId` to the propagated error without replacing its message or type. Do not generate a second ID or retry. For cancellation, retain the submitted `orderId` on an uncertain failure. Document that an accepted acknowledgement does not prove a fill or completed cancellation.

Use `src/utilities/endpointAsserts.js` as the final payload gate before signing. Update it only for fields actually needed by the new methods. Convert supported public numeric `price`, `quantity`, and `notional` inputs to positive decimal strings before this gate; the existing endpoint assertions require decimal strings. Never forward helper-only fields or arbitrary object properties. Do not change unrelated endpoint contracts.

Symbol-rule validation must use the fields actually present in `docs/schema.yaml`: `tradability`, `stepSize`, `minQty`, `maxQty`, `minNotional`, `maxNotional`, `fractionable`, `fractionableEh`, `extendedSession`, and `overnightSupported` as applicable. Validate side, exact quantity increment and bounds, known notional bounds, and fractional support when the requested session makes the relevant flag clear. A notional MARKET BUY is classified as fractional by the schema, but MARKET requests have no `tradingSession`; do not invent a session or derive a share quantity merely to prevalidate it. Leave session-specific fractional acceptance of MARKET orders to Binance. For a LIMIT order, require the requested session enum and applicable symbol support. The existing `getNyMarketSession()` omits exchange holidays and early closes; do not use it as an authoritative reason to reject an otherwise valid order. Binance remains authoritative for live session availability, price bands, account restrictions, and execution.

## 3. `amountInUSD` convenience sizing

`amountInUSD` is required by `createLimitOrder()` and `createMarketOrder()`. It must satisfy `typeof value === 'number' && Number.isFinite(value) && value > 0`. Reject numeric strings and all other types. It represents the target USD order value before fees. It is never sent as a Binance parameter and is not accepted by the direct `placeOrder()` method.

For both LIMIT sides, validate the submitted `entryPrice` first, then calculate `quantity = floor(amountInUSD / entryPrice / stepSize) × stepSize` with exact decimal arithmetic. For MARKET SELL, fetch one current quote, require a valid positive `bidPrice`, and use that bid in the same formula. Reject a zero rounded quantity and any failed quantity, estimated notional, or applicable fractional rule. Never round up or increase the target to satisfy a minimum. A MARKET BUY sends the decimal representation of `amountInUSD` as `notional` and no `quantity`; validate its known notional bounds and leave session-specific fractional eligibility to Binance. A quote is unnecessary for BUY sizing. Final spend or proceeds may differ because of fees, rounding, and execution price.

## 4. Trading methods

### `createLimitOrder(options)`

Require `symbol`, `amountInUSD`, `entryPrice`, and `tradingSession`. Accept optional `side`, `timeInForce`, `walletType`, `tokenize`, `clientOrderId`, and `recvWindow`. Accept a positive decimal string or finite positive number for `entryPrice`; reject more than two decimal places rather than rounding. Require `tradingSession` to be `RTH`, `EXTENDED`, or `24H`. A fractional `GTC` order requires `EXTENDED` or `24H` and applicable symbol support.

Submit `orderType: 'LIMIT'`, the validated `price`, calculated decimal-string `quantity`, `tradingSession`, `quoteAsset: 'USDC'`, and supported options through the common internal placement path. Do not send `amountInUSD`, `entryPrice`, or `notional`. Resolve to Binance's raw placement acknowledgement, including an `F` acknowledgement when returned as a valid response.

### `createMarketOrder(options)`

Require `symbol` and `amountInUSD`; accept optional `side`, `timeInForce`, `walletType`, `tokenize`, `clientOrderId`, and `recvWindow`. Reject supplied `price`, `entryPrice`, `tradingSession`, `quantity`, `notional`, and `GTC`. BUY sends `orderType: 'MARKET'` and decimal-string `notional`. SELL sends `orderType: 'MARKET'` and the rounded decimal-string `quantity` derived from one valid current bid. Both send `quoteAsset: 'USDC'`; neither sends `amountInUSD`. Resolve to the raw placement acknowledgement.

### `placeOrder(params)`

Use signed `POST /sapi/v1/equity/order/place`. Require `symbol`, `orderType`, and the combination-specific fields. Default `side` to `BUY`, `timeInForce` to `DAY`, and `quoteAsset` to `USDC` at the public boundary. Accept optional `walletType`, `tokenize`, `clientOrderId`, and `recvWindow`. Apply the shared fresh-rule validation. Do not silently resize a direct caller's explicit quantity.

| Combination | Required | Forbidden |
| --- | --- | --- |
| BUY LIMIT | `price`, `quantity`, `tradingSession` | `notional` |
| SELL LIMIT | `price`, `quantity`, `tradingSession` | `notional` |
| BUY MARKET | `notional` | `price`, `quantity`, `tradingSession` |
| SELL MARKET | `quantity` | `price`, `notional`, `tradingSession` |

Reject `amountInUSD` and `entryPrice` here. Validate LIMIT price precision and direct quantity step size without changing supplied values. Submit once and return the raw acknowledgement.

### `getOrder({ orderId, clientOrderId, recvWindow })`

Use signed `GET /sapi/v1/equity/order/detail`. Require at least one nonempty string identifier. If both are supplied, forward both, as the existing `orderDetail` validator permits; do not invent precedence or perform a fallback lookup. Return the raw detail object, including `qty`, optional `fee` and `avgFilledPrice`, and `trades` when present. Do not poll or require `symbol`.

### `getOpenOrders({ recvWindow } = {})`

Use signed `GET /sapi/v1/equity/order/open-orders` without a symbol filter. Return the raw array, including `[]` for a valid empty response. Propagate failures.

### `getOrderHistory(options)` and `getTradeHistory(options)`

Use signed `GET /sapi/v1/equity/order/history` and `GET /sapi/v1/equity/trade/history`, respectively. Require safe nonnegative integer `startTime` and `endTime` with `startTime <= endTime`. Accept `current` as a positive integer (default `1`) and `size` as an integer from `1` through `100` (default `20`). Order history may filter by `symbol`, `orderType`, `side`, and a comma-separated `orderStatus` using the values in the existing assertion. Trade history may filter by `symbol`, `side`, and `orderId`. Do not add placement defaults to omitted filters.

Each public method fetches exactly one requested page and returns the raw `{ total, page, size, rows }` object. The request field is `current`; the response field is `page`. Preserve row order, execution IDs, `qty`, decimal strings, and optional fields. A trade row is one fill, not one order.

### `cancelOrder({ orderId, recvWindow })` and `cancelAllOrders({ recvWindow } = {})`

Use the existing signed POST endpoint definitions. `cancelOrder` requires a nonempty `orderId` and returns the raw single-order acknowledgement with `status`. `cancelAllOrders` has no symbol or ID filter, calls the dedicated endpoint once, and returns its raw `{ success: boolean }` response. Do not synthesize a `status` for cancel-all, perform one-by-one cancellation, retry, or infer final per-order state from either acknowledgement.

## 5. Wallet estimates and portfolio report

### `getEquityWallet({ startTime, endTime, recvWindow } = {})`

Produce a **trade-derived estimate**, not an authoritative account balance. Default `startTime` to `0`; use `Date.now()` once for an omitted `endTime`. Validate the range with the history validator. Call `getTradeHistory()` with no symbol or side filter, `size: 100`, and sequential `current` pages until the fixed-window pagination is complete. Forward `recvWindow` to every page. Validate response metadata and detect empty, repeated, nonadvancing, inconsistent, or failed pages. Do not return partial results. There is no existing client cache, rate-limit cooldown, or resumable pagination facility; propagate failures and document that large histories may exceed runtime or API limits.

Validate each row's `executionId`, ticker, side, positive decimal `qty`, and USDC quote if present. Deduplicate identical rows by `executionId` across pages, not by `orderId`; reject conflicting rows with the same execution ID. Keep separate exact-decimal BUY and SELL totals per ticker; only compare and subtract after reading every page. This avoids an intermediate negative result with the current nonnegative `Decimal` class. Omit a final zero. If SELL total exceeds BUY total, reject with a message that the selected trade window cannot establish a nonnegative holding estimate; do not claim the account itself is invalid or return zero. Return `{ SYMBOL: { amount: 'decimal string' } }` for the remaining estimated positions.

Trades alone cannot account for pre-window holdings, transfers, tokenized mint/redeem activity, settlement, and other adjustments. State this limitation in `README.md`. Never use this estimate to resize or authorize a SELL order.

### `getFundingWallet({ recvWindow } = {})`

Call the existing signed `fundingWallet` endpoint, `POST /sapi/v1/asset/get-funding-asset`, with `asset: 'USDC'`. It is a read operation with a POST HTTP method, as shown in [Binance's Funding Wallet documentation](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/asset#funding-wallet). Filter to the USDC record, validate its `free`, `locked`, `freeze`, and `withdrawing` decimal fields, and calculate `amount = free + locked` exactly. Return `{ USDC: { free, locked, freeze, withdrawing, amount } }` with decimal strings. A valid empty array produces five zero strings. Reject malformed responses or missing fields in a present USDC record. The `amount` includes locked funds and is not all spendable cash. Do not substitute a Spot Wallet endpoint.

### `getPortfolio({ startTime, endTime, recvWindow } = {})`

Build an **estimated current report** from `getEquityWallet()`, `getFundingWallet()`, and one current `getQuote(symbol)` call per nonzero estimated position. Pass the same history options to the equity estimate and `recvWindow` to signed wallet calls. History dates select fills; they do not select historical prices or a historical funding balance.

Use exact decimal operations before converting report values to JavaScript numbers. Require every converted non-null number to be finite; reject if a value is outside representable numeric range. Preserve as much decimal precision as JavaScript numbers allow; round only weights to four decimal places, with decimal half-up ties. For each position, use the positive `bidPrice` as `quote`, multiply by estimated share `amount` for `usd`, and calculate its fraction of `totalUsd`. Report `cash.USDC.amount` as Funding Wallet `free + locked`, `quote` as the explicit reporting assumption `1`, and `usd` as the same numeric amount. Sum positions and cash for totals. Always include `cash.USDC`. An empty portfolio has zero totals and null weights; cash-only with positive value has cash weight `1`.

If a successful quote response is null or has no valid positive bid, retain that position's `amount`, set its `quote` and `usd` to `null`, set `totals.positionsUsd` and `totals.totalUsd` to `null`, and set **all** weights to `null`. Retain available cash values and other positions' values. A rejected quote request is an error, not an unavailable successful quote; propagate it. The report is not an authoritative holding statement, spendable balance, historical valuation, or guaranteed liquidation value. Say this prominently in `README.md`.

Return this shape with numbers and specified nulls only:

```json
{
  "totals": { "totalUsd": 6805, "positionsUsd": 900, "cashUsd": 5905 },
  "cash": { "USDC": { "amount": 5905, "quote": 1, "usd": 5905, "weight": 0.8677 } },
  "positions": { "NVDA": { "amount": 3, "quote": 300, "usd": 900, "weight": 0.1323 } }
}
```

## 6. Verification and delivery

Test with mocked transport and dummy credentials. Cover both runtime entry points and all twelve Promise-returning methods; required and forbidden payload fields; exact sizing and no round-up; fresh rules; valid and invalid sessions; generated and supplied IDs; `tokenize: false`; no mutation retries; raw response shapes; page-by-page history; duplicate fills; temporary negative traversal; final negative window rejection; exact Funding Wallet sums; missing bids; all-cash and empty portfolios; and error propagation. Add explicit tests that the transport honors `recvWindow` overrides and signs only `TRADE`/`USER_DATA` while sending the API key for every endpoint.

The current `npm test` runs `test/test.js`, which uses live credentials for GET-only calls. Do not use live credentials for POST, PUT, or DELETE tests, including the read-only Funding Wallet POST. Do not log credentials. Keep new mutation and funding tests mocked. Run the relevant offline tests, and use `npm run build` for the GAS production bundle; never hand-edit `dist/BinanceStocksGas.min.js`.

Before finishing, update the currently empty `README.md` with the implemented signatures, defaults, request examples, response shapes, `amountInUSD` semantics, and wallet/portfolio limitations. Report what changed, what was tested, and any remaining limitations. Compare original and new output behavior only for methods that existed before this work; the twelve methods in this document have no existing public implementation in the current checkout.
