import BinanceStocks from './BinanceStocks.js'
import * as errors from './errors.js'
import { getNyMarketSession } from './getNyMarketSession.js'

// Keep a directly constructible global and expose error types on that constructor.
Object.assign(BinanceStocks, {...errors, getNyMarketSession})

export default BinanceStocks
