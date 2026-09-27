import BinanceStocksCore from "./BinanceStocksCore.js";
import { endpoints } from "./utilities/endpoints.js";
import { gasFetch } from "./gas/gasFetch.js";
export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'gas';
    }

    fetch(key, payload) {
        try {
            const endpoint = endpoints[key];
            return gasFetch(this, endpoint, payload);
        } catch (err) {
            this.errorLogger(err)
            throw err;
        }
    }
}