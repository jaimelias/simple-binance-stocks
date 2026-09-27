import BinanceStocksCore from "./BinanceStocksCore.js";
import { endpoints } from "./utilities/endpoints.js";
import { gasFetch } from "./gas/gasFetch.js";
export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'gas';
    }

    transport(key, payload) {
        const endpoint = endpoints[key];
        return gasFetch(this, endpoint, payload);
    }
}