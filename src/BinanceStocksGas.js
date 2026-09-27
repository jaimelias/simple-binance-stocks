import BinanceStocksCore from "./BinanceStocksCore.js";
import { endpoints } from "./utilities/endpoints.js";
import { gasFetch } from "./gas/gasFetch.js";

import * as binancePayloadAsserts from './utilities/binancePayloadAsserts.js';

export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'gas';
    }

    transport(key, payload) {
        try {
            binancePayloadAsserts[ke](payload);
            const endpoint = endpoints[key];
            return gasFetch(this, endpoint, payload);
        } catch (err) {
            this.errorLogger(err)
            throw err;
        }
    }
}
