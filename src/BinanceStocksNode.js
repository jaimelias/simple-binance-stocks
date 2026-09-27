import BinanceStocksCore from "./BinanceStocksCore.js";
import { endpoints } from "./utilities/endpoints.js";
import { nodeFetch } from "./node/nodeFetch.js";

import * as binancePayloadAsserts from './utilities/binancePayloadAsserts.js';


export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'node';
    }

    async transport(key, payload) {

        binancePayloadAsserts[ke](payload);

        try {
            const endpoint = endpoints[key];
            return await nodeFetch(this, endpoint, payload);
        } catch (err) {
            this.errorLogger(err)
            throw err
        }
    }

}
