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
- Existing placement methods perform SELL adjustment internally when sizing options or the explicitly configured client `estimatedExitBuffer` policy applies. The policy maps normalized symbols to positive plain decimal-string reserves below one share, defaults to disabled, and is copied and frozen. Compute its reserve as `ceil(configuredReserve / currentStepSize) * currentStepSize` with exact arithmetic; never infer a reserve or fractional permission from snapshot step precision. Apply automatic reserves only to estimated fractional exits, skipping quantities that become whole shares after step rounding. Monetary automatic buffering requires the target to reach the step-rounded `maxSellQuantity` cap; smaller or uncapped monetary sells are not eligible. Reject automatic reserves that consume the quantity or align to one share or more.
- `bufferSteps` is an optional nonnegative safe integer override; explicit zero disables automatic buffering and rounds only. Manual positive buffering rejects whole-share quantities. `maxSellQuantity` must be a positive plain decimal string. Reject either option on BUY orders. Cap first, then buffer and round down exactly. Never apply a positive buffer without an enabled policy or explicit manual value, increase a quantity to meet a minimum, or claim the result is a verified available balance.
- Preserve exact `placeOrder` quantities when no policy or sizing options apply. `quantityMode: 'EXACT'` must never resize or buffer and rejects sizing options; use it for already-finalized intents. All placement paths accept an optional `beforeSubmit(finalOrder)` function, awaited after final sizing, validation, and client order ID assignment and before the single submission. Pass a frozen final snapshot with `quantityMode: 'EXACT'` and without adjustment options; callback failure must prevent submission and preserve the original error and reconciliation ID. Persist this marker with immutable intents to prevent a second automatic buffer.
- Keep reconstructed wallet and portfolio amounts, cost basis, and PnL unbuffered. Portfolio positions expose the exact decimal-string estimate as `amountExact` alongside numeric `amount`; use the exact field for share caps.

## Implementation boundaries

- Implement only the current public API contract; remove superseded signatures and aliases.
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
- Update implementations and all call sites directly to the current public API signature.
- Make surgical, minimal edits whenever a change can be done that way, touching only the lines that need to change and avoiding rewrites of unrelated code.
- Prefer modern es6 optimized JS code with modern arrow functions.

## After Coding
- If required, update the `README.md` treating it as the public API contract.

## References

- For Binance Stocks API reference read `docs/schema.yaml`.

