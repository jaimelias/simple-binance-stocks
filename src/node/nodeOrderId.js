/** Generate one identifier for an order's submission and reconciliation. */
export const createClientOrderId = () => crypto.randomUUID()
