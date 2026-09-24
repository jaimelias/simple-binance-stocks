/** A Binance response error. Response metadata never includes request credentials. */
export class BinanceAPIError extends Error {
  constructor(message, { status = null, code = null, msg = null, headers = {}, path = null, method = null, response = null } = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.msg = msg;
    this.headers = headers;
    this.path = path;
    this.method = method;
    this.response = response;
  }
}

/** The client must wait until lockedUntil before sending another request. */
export class RateLimitError extends BinanceAPIError {
  constructor(message, { retryAfterMs = 0, lockedUntil = 0, local = false, ...details } = {}) {
    super(message, details);
    this.retryAfterMs = retryAfterMs;
    this.lockedUntil = lockedUntil;
    this.local = local;
  }
}

/** A mutation may have executed. Reconcile its status before retrying manually. */
export class UnknownExecutionError extends BinanceAPIError {
  constructor(message, { clientOrderId, orderId, issuerRequestId, ...details } = {}) {
    super(message, details);
    this.executionUnknown = true;
    if (clientOrderId !== undefined) this.clientOrderId = clientOrderId;
    if (orderId !== undefined) this.orderId = orderId;
    if (issuerRequestId !== undefined) this.issuerRequestId = issuerRequestId;
  }
}

/** The HTTP service did not provide a usable response. */
export class ResponseError extends BinanceAPIError {}

/** The request was rejected locally before submission. */
export class ValidationError extends TypeError {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}
