import BinanceStocksCore from "./BinanceStocksCore.js";
import { endpoints } from "./utilities/endpointsMaster.js";
import { gasFetch } from "./gas/gasFetch.js";

import * as endpointAsserts from './utilities/endpointAsserts.js';

export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'gas';
    }

    transport(key, payload) {
        try {
            endpointAsserts[key](payload);
            const endpoint = endpoints[key];
            return gasFetch(this, endpoint, payload);
        } catch (err) {
            this.errorLogger(err)
            throw err;
        }
    }
}
