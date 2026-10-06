# simple-binance-stocks

JavaScript client for Binance Stocks and ETFs in Node.js and Google Apps Script (GAS). Orders use USD prices and are funded in USDC. The shared API lives in `src/BinanceStocksCore.js`; the runtime classes handle HTTP, signatures, and client order IDs.

**Wallet and portfolio results are estimates.** Equity holdings are reconstructed from fills in a selected time window. Funding cash includes locked funds, and the report uses current bids and a USDC reporting value of USD 1. These results are not an authoritative holding statement, spendable balance, historical valuation, or guaranteed liquidation value.

## Setup

Import the Node.js entry point and provide your credentials from your environment:

```js
import BinanceStocks from './src/BinanceStocksNode.js'

const client = new BinanceStocks({
  API_KEY: process.env.BINANCE_API_KEY,
  API_SECRET: process.env.BINANCE_API_SECRET,
  // baseUrl: 'https://your-proxy.example',
  errorLogger: error => console.error(error.message)
})
```

`baseUrl` defaults to `https://api.binance.com`. `errorLogger` defaults to `console.error` and receives errors from the API adapters before they are rethrown. Keep credentials private. There is no constructor `recvWindow` option.

For GAS, run `npm run build` and load the generated `dist/BinanceStocksGas.min.js` in your Apps Script project. It exposes `BinanceStocks`; instantiate it with the same options, obtaining secrets from your chosen GAS secret storage. Use `await` in an async entry function. All twelve trading, history, wallet, and portfolio methods return Promises in both runtimes. GAS uses `UrlFetchApp` and `Utilities` internally.

Every endpoint receives `X-MBX-APIKEY`. `TRADE` and `USER_DATA` requests receive a fresh timestamp and HMAC signature. `MARKET_DATA` and `USER_STREAM` requests are unsigned. Signed calls accept a per-call `recvWindow`: a safe integer from 1 to 60000 milliseconds, default 5000.

## Existing market methods

| Method | Result |
| --- | --- |
| `getQuote(symbol)` | Promise of the raw quote response, or `null` for a successful empty response. Quotes include `bidPrice` and `askPrice` decimal strings when available. |
| `getSymbolInfo(symbol)` | Promise of the matching exchange-info rule object, or `undefined` if absent. Fetches fresh exchange info on every call; matching is case sensitive. |
| `getNyMarketSession()` | Synchronous market-session helper. It does not model exchange holidays or early closes and does not authorize an order. |

These methods retain their existing signatures and response behavior. The new methods trim and uppercase ticker inputs; existing market methods retain their original symbol handling.

## Orders

`createLimitOrder(options)`, `createMarketOrder(options)`, and `placeOrder(params)` each fetch one fresh symbol-rule snapshot and submit at most once. They return the raw placement acknowledgement, such as `{ status: 'S', orderId, clientOrderId }`. Extra response fields, missing optional fields, and decimal strings are preserved. `{ status: 'F', ... }` is a valid failed acknowledgement and resolves normally. `S` means accepted; it does not prove a fill.

All placement methods accept these common options:

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

Options must be plain objects. Unsupported fields are rejected; fields with `undefined` values are treated as omitted. Enumerations are case sensitive. Prices, quantities, and notionals accept positive plain decimal strings or finite positive numbers, and numbers are converted to their JavaScript decimal representation. Decimal strings are preferred when preserving input precision matters. LIMIT prices must have at most two decimal places, including trailing decimal zeros in a string; prices are never rounded.

### Monetary convenience methods

`createLimitOrder({ symbol, amountInUSD, entryPrice, tradingSession, rejectMarketable = false, ...commonOptions })`

`amountInUSD` must be a finite JavaScript **number greater than zero**; numeric strings are rejected. It is the target USD order value before fees, funded in USDC, without currency conversion. The method computes `floor(amountInUSD / entryPrice / stepSize) × stepSize` using exact decimal arithmetic. Both BUY and SELL use the validated price that will be submitted. A rounded quantity of zero or a quantity/notional below the symbol minimum is rejected rather than increased.

`tradingSession` is required: `RTH`, `EXTENDED`, or `24H`. Requested extended and overnight sessions must be supported by the symbol. Fractional LIMIT orders must have the applicable regular or extended fractional support. Fractional GTC requires EXTENDED or 24H. Binance remains authoritative for current session availability, price bands, account restrictions, and execution.

Set the optional boolean `rejectMarketable: true` to fetch one quote after sizing and rule validation, immediately before submission. BUY rejects when `entryPrice >= askPrice`; SELL rejects when `entryPrice <= bidPrice`. Comparisons use exact decimals. A missing or invalid required quote price, a mismatched quote symbol when present, or a failed quote request also rejects the order before submission. The guard never adjusts price or quantity, retries, or sends `rejectMarketable` to Binance. Omission or `false` skips the quote check. This option belongs to `createLimitOrder`; direct `placeOrder` and `createMarketOrder` do not accept it.

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

`createMarketOrder({ symbol, amountInUSD, ...commonOptions })`

A BUY sends `amountInUSD` as decimal-string `notional`, with no quote lookup or derived quantity. A SELL fetches one current quote and sizes down using its valid positive `bidPrice` and the symbol step size. Missing or invalid bids reject SELL sizing. The method rejects `price`, `entryPrice`, `tradingSession`, `quantity`, `notional`, and GTC. Market requests have no session field; session-specific fractional acceptance is left to Binance.

```js
const ack = await client.createMarketOrder({ symbol: 'AAPL', amountInUSD: 100 })
```

The helpers never send `amountInUSD` or `entryPrice` to Binance. Final spend or proceeds may differ because of rounding, fees, and execution price. The equity-wallet estimate is never used to authorize or resize a SELL.

### Explicit placement

`placeOrder({ symbol, orderType, ...fields, ...commonOptions })`

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

On a placement transport or response error, the propagated Error retains its type/message and gains `clientOrderId`. Use it with `getOrder({ clientOrderId: error.clientOrderId })` to reconcile an uncertain outcome before deciding on another order. There are no automatic retries, replacement IDs, fallback lookups, or polling.

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

Fetches all sequential trade-history pages with `size: 100`, without symbol or side filters. The end time is captured once. Pagination metadata must match the requested page and size and a stable total; incomplete, repeated, nonadvancing, inconsistent, malformed, or failed pages reject the operation rather than return a partial estimate. Identical complete rows are deduplicated by `executionId`; conflicting rows sharing an ID are rejected. BUY and SELL totals are aggregated exactly before subtraction. Zero final holdings are omitted.

```js
const equity = await client.getEquityWallet()
// { AAPL: { amount: '1.25' }, NVDA: { amount: '3' } }
```

If sells exceed buys, the selected trade window cannot establish a nonnegative estimate and the method rejects. This does not imply the account balance is invalid. Fills omit pre-window holdings, transfers, tokenized mint/redeem activity, settlement, and other adjustments. Even a window beginning at zero is only an estimate. Large histories may exceed API or runtime limits; there is no cache, cooldown, or pagination resume facility.

`getFundingWallet({ recvWindow } = {})`

Calls the signed Funding Wallet endpoint `POST /sapi/v1/asset/get-funding-asset` with `asset: 'USDC'`. This read operation is the library's explicit exception to the `/sapi/v1/equity/` route prefix. It validates the USDC decimal-string fields and computes `amount = free + locked` exactly. `freeze` and `withdrawing` are returned separately. No USDC record produces five zero strings; malformed USDC records are rejected.

```js
const funding = await client.getFundingWallet()
// { USDC: { free: '5900', locked: '5', freeze: '0', withdrawing: '0', amount: '5905' } }
```

`amount` includes locked funds and is not all spendable cash. This method does not substitute the Spot Wallet for the Funding Wallet.

`getPortfolio({ startTime, endTime, recvWindow } = {})`

Combines the equity estimate, current Funding Wallet, and one current quote per nonzero estimated position. History options select fills, not historical prices or a historical funding balance. Positions are valued at positive bids; cash uses free + locked and the explicit USDC/USD reporting assumption of 1. Values are calculated as exact decimals before conversion to finite JavaScript numbers; overflow and nonzero underflow are rejected. Only weights are rounded, to four decimal places with half-up ties. Rounded weights may not sum to exactly one.

```js
const portfolio = await client.getPortfolio()
// {
//   totals: { totalUsd: 6805, positionsUsd: 900, cashUsd: 5905 },
//   cash: { USDC: { amount: 5905, quote: 1, usd: 5905, weight: 0.8677 } },
//   positions: { NVDA: { amount: 3, quote: 300, usd: 900, weight: 0.1323 } }
// }
```

A successful quote response with no valid positive bid leaves that position's `amount` intact and sets its `quote` and `usd` to `null`. It also sets `positionsUsd`, `totalUsd`, and every weight to `null`, preserving cash and other available position values. A rejected quote request rejects the report. Cash is always included; an empty portfolio has zero totals and null weights, while positive cash alone has weight 1. Reads occur sequentially and are not an atomic account snapshot.

## Verification and build

```sh
npm run test:offline
npm run build
```

The offline suite uses dummy credentials, mocked HTTP, and mocked GAS services to test both runtime entry points, signing, order validation/sizing, reconciliation errors, pagination, and reports. It makes no live requests.

The existing `npm test` command runs `test/test.js` and uses `.env` credentials for live GET quote and exchange-info requests. It is separate from the offline suite. Never use live credentials in POST, PUT, or DELETE tests, including the read-only Funding Wallet POST. Generate the GAS bundle through `npm run build`; do not edit it manually.
