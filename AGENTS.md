# AGENTS.md

`simple-binance-stocks` is an easy-to-use JavaScript library for trading Binance Stocks and ETFs for Node.js and GAS (Google Apps Script).

## Product and API contract
- Use Binance Stocks REST routes under `/sapi/v1/equity/`.
- Use USDC as the library's quote and funding asset.
- Send `X-MBX-APIKEY` for every REST endpoint currently exposed by this library. Sign `TRADE` and `USER_DATA` requests; `MARKET_DATA` and `USER_STREAM` requests do not require a signature.

## Order sizing with `amountInUSD`

- Preserve `amountInUSD` as the public input for monetary order sizing. It must be a finite JavaScript number greater than zero and represents the target USD order value before fees, funded in USDC. The target notional equals `amountInUSD`; `quoteAsset` remains `USDC`.
- For limit buys and sells, derive `quantity = amountInUSD / entryPrice` using the validated price that will be submitted. Round quantity down to the symbol's `stepSize` with exact decimal handling, then validate quantity, notional, and fractional-share rules. Reject invalid sizes instead of increasing the requested amount to meet minimums.
- For market buys, send the amount as Binance's `notional` parameter. For market sells, derive and round the quantity using a valid current quote; reject sizing when no valid quote is available. Follow the endpoint's required and forbidden fields, and never send `amountInUSD` itself as a Binance request parameter.

## Implementation boundaries

- Do not create legacy support for implemented change3
- Core abstract class available in `src/BinanceStocksCore.js`.
- Node.js class available in `src/BinanceStocksNode.js`.
- GAS class available in `src/BinanceStocksGas.js`. This class main purpose is to generate the GAS produciton build `dist/BinanceStocksGas.min.js`
- It is not allowed to edit GAS produciton build, use command `npm run build` instead.
- `src/utilities/decimal.js` provides exact decimal operations without external dependencies.
- GAS specific files are stored in `src/gas` folder.
- Node.js specific files are stored in `src/node` folder.
- Binance Stocks API validation rules in `src/utilities/endpointAsserts.js`.
- Binance Stocks API config rules in `src/utilities/endpointsMaster.js`.
- Secrets `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `BINANCE_PROXY` are available for `read-only` (GET) test operation. It is not allowed perform any modify or update operations (DELETE, POST, PUT). It is not allowed to shared or log these secrets.

## Before Coding
- Rewrite code directly to the new signature, update all call sites, and never add backward-compatibility or legacy support.
- Make surgical, minimal edits whenever a change can be done that way, touching only the lines that need to change and avoiding rewrites of unrelated code.

## After Coding
- Update the `README.md` treating it as the public API contract.

## References

- For Binance Stocks API reference read `docs/schema.yaml`.

