import { publicOptions, decimalValue } from '../utilities/publicInputs.js'
import { fundingWallet } from '../utilities/endpointAsserts.js'

/** Read USDC funding balances; amount includes both free and locked funds. */
export async function getFundingWallet(main, options = {}) {
  const payload = { ...publicOptions(options, ['recvWindow']), asset: 'USDC' }
  fundingWallet(payload)
  const response = await main.apiClient('fundingWallet', payload)
  if (!Array.isArray(response) || response.some(row => !row || typeof row !== 'object' ||
      Array.isArray(row) || typeof row.asset !== 'string' || !row.asset.trim())) {
    throw new TypeError('Malformed Funding Wallet response')
  }
  const records = response.filter(row => row.asset === 'USDC')
  if (records.length > 1) throw new TypeError('Duplicate USDC Funding Wallet records')
  const record = records[0] ?? { free: '0', locked: '0', freeze: '0', withdrawing: '0' }
  const parsed = {}
  const result = {}
  for (const field of ['free', 'locked', 'freeze', 'withdrawing']) {
    parsed[field] = decimalValue(record[field], `funding.${field}`, { positive: false, stringOnly: true })
    result[field] = record[field]
  }
  result.amount = parsed.free.plus(parsed.locked).toString()
  return { USDC: result }
}
