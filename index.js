import { webcrypto } from 'node:crypto'
import CoreBinanceStocks from './src/BinanceStocks.js'

/** Node.js entry point. The shared core also runs in Google Apps Script. */
export default class BinanceStocks extends CoreBinanceStocks {
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Client options must be an object.')
    }
    super({ ...options, crypto: options.crypto ?? webcrypto })
  }
}

export {
  BinanceAPIError,
  RateLimitError,
  UnknownExecutionError,
  ResponseError,
  ValidationError
} from './src/errors.js'
