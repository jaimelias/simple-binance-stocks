# AGENTS.md

`simple-binance-stocks` is an easy-to-use JavaScript library for trading Binance Stocks and ETFs. It is based on USDC and must work in Node.js and Google Apps Script.

## Before coding

- Read [docs/BINANCE_STOCKS_API.md](docs/BINANCE_STOCKS_API.md) and [docs/GOOGLE_APPS_SCRIPT.md](docs/GOOGLE_APPS_SCRIPT.md) before changing library code. Recheck the linked Binance endpoint reference and change log when changing an endpoint, validation rule, rate limit, or response parser.

## Product and API contract

- Use Binance Stocks REST routes under `/sapi/v1/equity/`. Accept plain uppercase US stock or ETF tickers such as `AAPL` and `SPY`.
- Use USDC as the library's quote and funding asset. Explicitly send `quoteAsset: 'USDC'` on order placement and reject other quote assets. Balance helpers, trading budgets, and examples must use and identify USDC.
- Preserve Binance's documented USD units for equity price and notional fields. Keep these values distinct from USDC balances and budgets; do not silently relabel or convert them.
- Follow the current endpoint-specific parameter and enum definitions. Validate order field combinations, trading sessions, precision, and symbol rules against the Stocks reference and exchange info. Preserve decimal values as strings or use exact decimal handling; avoid floating-point rounding in order amounts.
- Make state-changing actions explicit, including signing the US equity disclaimer. Do not accept it automatically on behalf of a caller.

## Order sizing with `amountInUSD`

- Preserve `amountInUSD` as the public input for monetary order sizing. It must be a finite JavaScript number greater than zero and represents the target USD order value before fees, funded in USDC. The target notional equals `amountInUSD`; `quoteAsset` remains `USDC`.
- For limit buys and sells, derive `quantity = amountInUSD / entryPrice` using the validated price that will be submitted. Round quantity down to the symbol's `stepSize` with exact decimal handling, then validate quantity, notional, and fractional-share rules. Reject invalid sizes instead of increasing the requested amount to meet minimums.
- For market buys, send the amount as Binance's `notional` parameter. For market sells, derive and round the quantity using a valid current quote; reject sizing when no valid quote is available. Follow the endpoint's required and forbidden fields, and never send `amountInUSD` itself as a Binance request parameter.
- Keep share-quantity calculations inside the order helpers. Market execution prices and fees can change the final amount spent or received, so `amountInUSD` is not a guaranteed final total.

## Implementation boundaries

- `index.js` supplies Node.js cryptography; `src/BinanceStocks.js` contains the portable public API. Keep route definitions in `src/endpoints.js`, HTTP and signing in `src/transport.js`, and sizing and trading-rule validation in `src/orders.js`.
- `src/decimal.js` provides exact decimal operations without external dependencies. `scripts/build.js` packages the local modules into the CommonJS and Apps Script artifacts; regenerate those artifacts after source changes.
- Keep request encoding, authentication, signing, HTTP transport, rate-limit handling, and error parsing in shared code with runtime-specific adapters. Keep Node-only dependencies out of code bundled for Apps Script.
- Apply each endpoint's security type: Stocks `MARKET_DATA` requires `X-MBX-APIKEY` but no signature; `TRADE` and `USER_DATA` require signed requests; `USER_STREAM` listen-key management uses an API key without a signature. Do not treat market data as anonymous.
- Sign the exact encoded parameters sent over the wire. Use millisecond timestamps and honor Binance's `recvWindow` rules. Do not log API keys, secrets, signatures, or full signed URLs.
- Preserve HTTP status, Binance `{code, msg}` errors, and useful response headers. Handle empty successful responses where documented, especially the latest-quote endpoint.
- Respect SAPI and endpoint-specific limits. Back off on `429` and use `Retry-After` when supplied. A timeout or `5xx` can leave a mutation's execution status unknown. For orders, retain a caller-supplied `clientOrderId` so status can be checked after an uncertain placement. Never automatically retry order placement or another state-changing request.
- Distinguish a place/cancel acknowledgement (`S` or `F`) from the later order lifecycle status. Expose response fields according to the current endpoint schema; do not assume fees or fill prices exist before a fill.
- Keep public method signatures explicit and document them. Update README examples when public behavior changes.

## Tests and delivery

- Build offline tests around the public API and the shared request boundary. Mock transport, time, and signing with dummy credentials; never load local secrets or submit live orders in tests.
- Cover USDC quote enforcement, `amountInUSD` sizing and rounding, order validation and payload mapping, exact signed payloads, security types, error and rate-limit behavior, unknown mutation outcomes, and both Node.js and Apps Script adapters. Verify the built Apps Script artifact as well as service mocks.
- `npm test`: build both distributions and run all offline tests with `node:test`.
- `node --test test/orders.test.js`: run focused sizing and order-validation checks. `npm run build`: regenerate `dist/index.cjs` and `dist/google-apps-script-build.js`.
