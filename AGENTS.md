# AGENTS.md

`simple-binance-stocks` is an easy-to-use JavaScript library for trading Binance Stocks and ETFs. It is based on USDC and must work in Node.js and Google Apps Script.

## Product and API contract

- Use Binance Stocks REST routes under `/sapi/v1/equity/`.
- Use USDC as the library's quote and funding asset.
- Send `X-MBX-APIKEY` and a signature on every REST request.

## Order sizing with `amountInUSD`

- Preserve `amountInUSD` as the public input for monetary order sizing. It must be a finite JavaScript number greater than zero and represents the target USD order value before fees, funded in USDC. The target notional equals `amountInUSD`; `quoteAsset` remains `USDC`.
- For limit buys and sells, derive `quantity = amountInUSD / entryPrice` using the validated price that will be submitted. Round quantity down to the symbol's `stepSize` with exact decimal handling, then validate quantity, notional, and fractional-share rules. Reject invalid sizes instead of increasing the requested amount to meet minimums.
- For market buys, send the amount as Binance's `notional` parameter. For market sells, derive and round the quantity using a valid current quote; reject sizing when no valid quote is available. Follow the endpoint's required and forbidden fields, and never send `amountInUSD` itself as a Binance request parameter.

## Implementation boundaries

- `index.js` supplies Node.js cryptography; `src/BinanceStocks.js` contains the portable public API. Keep route definitions in `src/endpoints.js`, HTTP and signing in `src/transport.js`, and sizing and trading-rule validation in `src/orders.js`.
- `src/decimal.js` provides exact decimal operations without external dependencies. Node.js consumes the ESM entry at `index.js` directly. `webpack.config.js` builds `src/googleAppsScript.js` into `dist/BinanceStocks.min.js` exclusively for Google Apps Script; regenerate that artifact after source changes.
- It is not allowed to edit `dist/BinanceStocks.min.js`, all changes in should be executed with the command `npm run build`.
- Secrets `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `BINANCE_PROXY` are available for `read-only` (GET) test operation. It is not allowed perform any modify or update operations (DELETE, POST, PUT). It is not allowed to shared these secrets. 
- Sign the exact encoded parameters sent over the wire. Use millisecond timestamps and honor Binance's `recvWindow` rules. Do not log API keys, secrets, signatures, or full signed URLs.
