import BinanceStocksCore from "./BinanceStocksCore.js";
import { nodeApiClient } from "./node/nodeApiClient.js";


export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'node';
    }

    async apiClient(key, payload = {}) {

        return nodeApiClient(this, key, payload);
    }

}
