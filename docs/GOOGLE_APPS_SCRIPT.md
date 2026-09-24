# Google Apps Script compatibility

This library targets Node.js and the Google Apps Script V8 runtime. Keep shared trading and response logic independent of either host, and put HTTP, signing, time, and storage access behind runtime adapters.

## Runtime and build

- V8 supports modern JavaScript syntax, including arrow functions and `async`/`await`. Apps Script does not support ES module `import`/`export` directly, so bundle the library and its dependencies into a single script file for Apps Script. Keep Node-only modules and browser globals out of that bundle.
- Expose the bundled library under a stable global name. Define Apps Script entry points such as triggers, menus, `doGet`, and `doPost` as top-level `function` declarations so Apps Script can discover them.
- Avoid private class fields and static field declarations, which Apps Script V8 does not support. Use closures or `WeakMap` for credentials. The generated artifact exposes `BinanceStocks` and the exported error types through `BinanceStocksLibrary`.
- Apps Script has no global `fetch`, Node `crypto`, or standard timers. Its `UrlFetchApp` calls block even inside an `async` function. Use `Utilities.sleep` only when a bounded wait is needed; do not assume a Node-style event loop.

## HTTP and signing

- Use `UrlFetchApp.fetch` for Apps Script requests. Set `muteHttpExceptions: true`, then inspect `HTTPResponse.getResponseCode()` and `getContentText()` so Binance error bodies can be parsed and surfaced consistently with Node.js. Keep request encoding, headers, and error behavior aligned across adapters.
- For endpoints requiring HMAC-SHA256, sign the exact encoded request payload with `Utilities.computeHmacSha256Signature`, then convert its signed byte array to a lowercase two-digit hex string per byte. Keep API keys and signatures out of logs and errors.
- Retry only safe, idempotent reads when the failure is transient, with bounded backoff that respects rate limits. Do not automatically retry order submissions or other state-changing requests after an uncertain response; check their status before any manual retry.

## State and execution

- Read credentials from the appropriate `PropertiesService` store at runtime; never commit or bundle them. Script properties are shared with all users of a script, so restrict project access and use user properties when credentials belong to individual users.
- Respect Apps Script execution and URL Fetch quotas. Chunk long jobs and use installable or time-driven triggers when appropriate. Use `LockService` around shared mutable state that concurrent executions could change.
- Keep tests offline with mocked `UrlFetchApp`, `Utilities`, and `PropertiesService`. Also build and validate the generated Apps Script bundle: source-level mocks alone cannot catch missing globals, unresolved modules, or incorrect global exports.

## References

- [Apps Script V8 runtime and limitations](https://developers.google.com/apps-script/guides/v8-runtime)
- [URL Fetch service](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)
- [Utilities HMAC-SHA256](https://developers.google.com/apps-script/reference/utilities/utilities)
- [Properties service](https://developers.google.com/apps-script/guides/properties)
- [Lock service](https://developers.google.com/apps-script/reference/lock)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)
