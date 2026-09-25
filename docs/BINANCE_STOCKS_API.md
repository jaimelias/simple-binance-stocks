# Binance Stocks API notes

Implementation reference for `AGENTS.md`, checked against the official Binance pages on 2026-09-24. Binance can change the API; verify the relevant endpoint page and [change log](https://developers.binance.com/en/docs/products/stocks/change-log) before implementing or modifying a route. The [REST catalog](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api) links to separate [market data](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/market-data), [trade](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/trade), [tokenized](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/tokenized), [account](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/account), and [user data streams](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/user-data-streams) references. The [Funding Wallet](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/asset#funding-wallet) is a separate Wallet route.

## Project currency contract

- USDC is this library's quote and funding asset. Order helpers must explicitly submit `quoteAsset: 'USDC'` and reject other quote assets before sending a request.
- Balance helpers, trading budgets, and examples must select and identify USDC. Do not automatically substitute another asset.
- Binance documents equity prices and notionals in USD. Preserve those units and decimal values in API responses; distinguish them from USDC balances and budgets. Any conversion must be explicit and documented. See [Stocks general info](https://developers.binance.com/en/docs/products/stocks/general-info).

## Scope and request rules

- [Introduction](https://developers.binance.com/en/docs/products/stocks/introduction): Stocks and ETFs share the `/sapi/v1/equity/*` REST family. Symbols are bare US tickers such as `AAPL` or `SPY`.
- [Stocks general info](https://developers.binance.com/en/docs/products/stocks/general-info): Use uppercase symbols and enum values. Binance defaults order `quoteAsset` to `USDC`; this library sends it explicitly as required above. Limit prices allow at most two decimal places. Timestamps are Unix milliseconds. The account must accept the US equity disclaimer before placing orders, or Binance returns `486410`.
- [Shared SAPI general info](https://developers.binance.com/en/docs/products/common/sapi/general-info): The primary base URL is `https://api.binance.com`. GET parameters go in the query string; mutating requests may use a query string or a form-encoded body. Signed requests send `X-MBX-APIKEY`, a timestamp, and a signature over the exact encoded parameter payload. The [Stocks quick start](https://developers.binance.com/en/docs/products/stocks/quick-start) specifies HMAC-SHA256 or Ed25519 signing. `recvWindow` defaults to 5000 ms and cannot exceed 60000 ms. Keep signing and serialization together so they cannot diverge.
- Security is per endpoint. [Stocks market data](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/market-data) requires `X-MBX-APIKEY` but no signature. [Trade and user-data routes](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/trade) are signed. [Listen-key management](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/user-data-streams) uses the API key without a signature. Do not infer security from HTTP method alone.

## Metadata cache

- `getExchangeInfo()` fetches the full, unfiltered `GET /sapi/v1/equity/market/exchangeInfo` response on every call; do not cache it. `getSymbolInfo(symbol)` uses that endpoint's `symbol` filter and caches valid, nonempty rules per ticker for at most 300 seconds. Cache `GET /sapi/v1/equity/market/tokenized-assets` for at most 21,600 seconds. Include the HTTPS base URL and relevant endpoint and symbol in cache keys. The `refresh` option on `getSymbolInfo()` and `getTokenizedAssets()` bypasses cached data. Keep quotes, histories and wallet reads uncached.
- Node.js may use per-client in-memory storage. Google Apps Script may use `CacheService.getScriptCache()`; its [cache reference](https://developers.google.com/apps-script/reference/cache/cache) limits each entry to 100 KB, permits at most 21,600 seconds, and allows early eviction. Return oversized metadata without caching it.
- Cache hits must not bypass the API-key requirement for Stocks MARKET_DATA. Exchange rules can change, so order validation should request current exchange information instead of relying on the metadata cache.

## Derived wallets and valuation

- [Equity Trade History](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/trade) is signed `GET /sapi/v1/equity/trade/history`. It requires `startTime` and `endTime`, has `current` pages starting at 1 and `size` up to 100, and returns `{ total, page, size, rows }`. Each per-fill row has `executionId`, `symbol`, `side` and decimal-string `qty`. A trade-derived share estimate must paginate all pages, deduplicate by execution ID, and add BUY or subtract SELL quantities exactly.
- That calculation is not an authoritative equity balance. It omits an opening balance outside the chosen history window and can drift after tokenization, transfers, settlement or other account adjustments. Label it as an estimate. The Stocks REST catalog does not expose a current equity-position route.
- [Funding Wallet](https://developers.binance.com/en/docs/catalog/core-trading-wallet/api/rest-api/asset#funding-wallet) is signed `POST /sapi/v1/asset/get-funding-asset` and can filter by `asset: 'USDC'`. It returns an array whose entries include `asset`, `free`, `locked`, `freeze` and `withdrawing` decimal strings. A USDC holding can report `amount = free + locked` using exact decimal arithmetic; do not add frozen or withdrawing amounts to that total without a documented accounting rule. This is not the Spot `/api/v3/account` balance.
- `getPortfolio()` returns `{ totals: { totalUsd, positionsUsd, cashUsd }, cash: { USDC: { amount, quote, usd, weight } }, positions: { [ticker]: { amount, quote, usd, weight } } }` with numeric report values. It multiplies estimated shares by a fresh latest-quote `bidPrice` in Binance's documented USD units. Each `weight` divides the item's USD value by `totals.totalUsd`; round ratios to four decimal places using exact decimal arithmetic before converting to report numbers. Missing or invalid quotes yield null quote and value fields; `totals.totalUsd`, `totals.positionsUsd`, and all weights are null when valuation is incomplete, while `totals.cashUsd` remains known. Zero denominators yield null weights. Treat `cash.USDC.quote = 1` and `cash.USDC.usd = cash.USDC.amount` as an explicit 1:1 reporting assumption, distinct from an exchange conversion. Keep wallet decimals as strings so callers can use exact amounts when needed.

## Order behavior

The [Place Equity Order reference](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/trade) defines these required and forbidden fields:

| Side | Type | Required | Forbidden |
| --- | --- | --- | --- |
| `BUY` | `LIMIT` | `price`, `quantity`, `tradingSession` | `notional` |
| `SELL` | `LIMIT` | `price`, `quantity`, `tradingSession` | `notional` |
| `BUY` | `MARKET` | `notional` | `price`, `quantity`, `tradingSession` |
| `SELL` | `MARKET` | `quantity` | `price`, `notional`, `tradingSession` |

- [Common definitions](https://developers.binance.com/en/docs/products/stocks/common-definition): `GTC` applies only to limit orders; a fractional `GTC` order requires `EXTENDED` or `24H`. The place/cancel response's `S` or `F` is an acknowledgement, while order detail and history report lifecycle values such as `ACCEPTED`, `PARTIALLY_FILLED`, and `FILLED`.
- Fetch trading rules from `/market/exchangeInfo`, including `stepSize`, quantity, notional, tradability, and session flags. These values are often decimal strings. Preserve them without binary floating-point rounding.
- The [latest-quote reference](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/market-data) allows an HTTP 200 with an empty body when no quote is available. An unknown exchange-info symbol instead yields an empty `symbols` array. Parse each endpoint's success shape separately.
- Allow callers to provide and retain a `clientOrderId` before placement (the reference specifies `^[a-zA-Z0-9-_]{32,36}$`). Binance generates one when omitted, but a timed-out response may never reveal it. `/order/detail` accepts either `orderId` or `clientOrderId` for reconciliation after an ambiguous placement. Do not infer failure from a timeout or `5xx`, or assume a repeated placement is idempotent.

## Errors, limits, and changing responses

- [Stocks error codes](https://developers.binance.com/en/docs/products/stocks/error-code) include negative SAPI and equity-specific pre-check codes (such as `-26004` for some unknown-symbol requests), plus positive `486xxx` business errors. Preserve the numeric code and message rather than reducing errors to a boolean.
- [Shared SAPI limits](https://developers.binance.com/en/docs/products/common/sapi/general-info) and route-specific UID caps both matter. Back off on `429`; check `Retry-After` when present. Avoid fixed assumptions about all routes having one limit.
- The [2026-07-30 change log](https://developers.binance.com/en/docs/products/stocks/change-log) raises tokenized redeem to 200 requests/minute, although Stocks general info still lists 50. Prefer the current endpoint reference and change log when pages disagree; do not bake this value into an unchangeable policy.
- The [2026-08-12 change log](https://developers.binance.com/en/docs/products/stocks/change-log) removes `fee` from trade-history rows and the order-detail `trades` array. Top-level order-detail `fee` and `avgFilledPrice` are present only after a fill. Model optional fields accordingly.
- [Tokenized conversion](https://developers.binance.com/en/docs/catalog/advanced-trading-stocks-trading/api/rest-api/tokenized) has its own request IDs and status endpoints; do not treat a mint/redeem acknowledgement as completed conversion. Pagination and ordering differ by endpoint, so follow each response schema.
