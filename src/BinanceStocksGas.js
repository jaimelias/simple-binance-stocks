import BinanceStocksCore from "./BinanceStocksCore.js";
import { endpoints } from "./utilities/endpoints.js";
import { getSignature } from "./gas/gasCrypto.js";

export default class BinanceStocks extends BinanceStocksCore {



    fetch(key, payload) {
       const endpoint = endpoints[key]
    }
}