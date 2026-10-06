import { randomUUID } from 'node:crypto'

/** Generate one identifier for an order's submission and reconciliation. */
export const createClientOrderId = () => randomUUID()
