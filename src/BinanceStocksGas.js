import BinanceStocksCore from "./BinanceStocksCore.js";
import { gasApiClient } from "./gas/gasApiClient.js";

export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'gas';
    }

    async apiClient(key, payload = {}) {

        return gasApiClient(this, key, payload);
    }
}
