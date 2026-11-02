import assert from 'node:assert/strict'
import { loadEnvFile } from 'node:process'
import BinanceStocks from '../src/BinanceStocksNode.js'
import {saveFile} from '../scripts/fs.js'

const test = async () => {
  loadEnvFile('.env')

  const { BINANCE_API_KEY, BINANCE_API_SECRET, BINANCE_PROXY } = process.env

  assert.ok(BINANCE_API_KEY, 'BINANCE_API_KEY is missing from .env')
  assert.ok(BINANCE_API_SECRET, 'BINANCE_API_SECRET is missing from .env')

  const exchange = new BinanceStocks({
    API_KEY: BINANCE_API_KEY,
    API_SECRET: BINANCE_API_SECRET,
    baseUrl: BINANCE_PROXY || undefined,
    errorLogger: (err) => console.error(err)
  })

  const symbol = 'OKTA';


  const exchangeInfo = await exchange.getExchangeInfo()

  console.log(exchangeInfo.symbols.length)

  await saveFile({ fileName: 'exchangeInfo.json', pathName: '.storage', data: exchangeInfo })
  
  //const quote = await exchange.getQuote(symbol)
  // = await exchange.getSymbolInfo(symbol)
  //const portfolio = await exchange.getPortfolio()

  //console.log(symbolInfo)

  //console.dir({quote, symbolInfo, portfolio}, {depth: 5})

}

test()