import BinanceStocksCore from "./BinanceStocksCore.js";
import { getSignature } from "./node/nodeCrypto.js";
import { nodeFetch } from "./node/nodeFetch.js";

export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'node';
    }

    async transport(key, payload) {
        const endpoint = endpoints[key];
        return await nodeFetch(this, endpoint, payload);
    }

}