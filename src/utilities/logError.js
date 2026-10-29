/** Attach request identifiers and await logging without replacing the original failure. */
export const logError = async (main, error, key, payload) => {
  const field = key === 'placeOrder' ? 'clientOrderId' : key === 'cancelOrder' ? 'orderId' : undefined
  if (field && error !== null && (typeof error === 'object' || typeof error === 'function')) {
    try {
      if (payload?.[field] !== undefined) error[field] = payload[field]
    } catch {
      // Frozen errors still reach the logger and caller as the original object.
    }
  }
  try {
    await main.errorLogger(error)
  } catch {
    // Logger failures must not replace the API or quote-validation error.
  }
}
