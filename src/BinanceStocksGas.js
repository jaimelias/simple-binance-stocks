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

            // Or, if the key must exist as an own property
            if (typeof key !== 'string' || key === '' || !Object.hasOwn(endpointAsserts ?? {}, key)) {
                throw new Error('Invalid #core request.');
            }

            endpointAsserts[key](payload);
            const endpoint = endpoints[key];
            return gasFetch(this, endpoint, payload);
        } catch (err) {
            this.errorLogger(err)
            throw err;
        }
    }
}
