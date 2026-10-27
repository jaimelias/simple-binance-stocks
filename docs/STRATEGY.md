# Trading Strategy

Status: interview draft. Strategy rules are pending unless explicitly marked as confirmed. This guide does not yet define an executable strategy.

## Purpose

Define the intended trading strategy, resolve ambiguous or contradictory rules, and document enough detail for a later implementation using `simple-binance-stocks`.

During this interview, changes are limited to this file. No live orders or account changes are part of the interview.

## Confirmed library constraints

These describe the existing library contract, not strategy choices:

- Orders trade Binance Stocks and ETFs, with USD prices and USDC as the quote and funding asset.
- Monetary sizing uses `amountInUSD`, a finite JavaScript number greater than zero representing the target USD order value before fees. Fees require separate funding consideration.
- LIMIT orders derive quantity from the submitted price and round down to the symbol's exact `stepSize`. Invalid sizes are rejected rather than increased to meet minimums.
- MARKET buys use notional. Monetary MARKET sells derive quantity from a valid bid and round down. Selling an exact share quantity is a separate supported placement path.
- Placement methods enforce a quoted-spread limit, defaulting to 2%. This does not guarantee an execution price or a resting LIMIT order.
- Placement and cancellation acknowledgements do not establish fills or final order states. Uncertain submissions require reconciliation before another order is considered.
- `getEquityWallet()` reconstructs estimated holdings from trade history. It does not account for every possible balance adjustment.
- `getFundingWallet().USDC.amount` and portfolio cash include locked funds; they are not spendable-cash balances.
- `getNyMarketSession()` handles recurring holidays and daylight saving time, but excludes early closes and ad-hoc closures. It does not authorize trading.
- Live credential testing is restricted to GET requests by `AGENTS.md`, including prohibition of the read-only Funding Wallet POST during tests.

## Strategy decisions

| Area | Decisions still needed |
| --- | --- |
| Objective | Intended trading approach and how success will be measured. |
| Instruments | Eligible stocks or ETFs and how symbols are selected. |
| Entry | Exact buy conditions, required data, and signal timing. |
| Exit | Exact sell conditions, exit quantity, and priority when conditions conflict. |
| Holding period | Expected duration and whether positions may remain open overnight. |
| Capital | Order sizing, cash reserve, position limits, and treatment of pending orders. |
| Execution | Order types, prices, allowed sessions, spread limit, and expiration policy. |
| Repeated signals | Whether additional buys, partial exits, and re-entry are allowed. |
| Order lifecycle | Partial fills, rejected orders, uncertain outcomes, cancellations, and reconciliation. |
| Runtime and state | Node.js or GAS, evaluation frequency, persistence, and overlapping runs. |
| Data failures | Missing or invalid quotes, incomplete holdings, and unavailable signals. |
| Validation | Worked scenarios and evidence required before implementation or live use. |

## Confirmed strategy rules

None yet. The interview will replace pending decisions with explicit rules and examples.

## References

- [Project instructions](../AGENTS.md)
- [Public library contract](../README.md)
- [Binance Stocks API schema](schema.yaml)
- [Shared API](../src/BinanceStocksCore.js)
- [Endpoint validation](../src/utilities/endpointAsserts.js)
- [Endpoint configuration](../src/utilities/endpointsMaster.js)
- [Exact decimal arithmetic](../src/utilities/decimal.js)
