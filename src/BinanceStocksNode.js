import BinanceStocksCore from "./BinanceStocksCore.js";
import { endpoints } from "./utilities/endpointsMaster.js";
import { nodeFetch } from "./node/nodeFetch.js";

import * as endpointAsserts from './utilities/endpointAsserts.js';


export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'node';
    }

    async transport(key, payload) {

        try {

            if (typeof key !== 'string' || key === '' || !Object.hasOwn(endpointAsserts ?? {}, key)) {
                throw new Error('Invalid #core request.');
            }
        
            endpointAsserts[key](payload);
            
            const endpoint = endpoints[key];
            return await nodeFetch(this, endpoint, payload);
        } catch (err) {
            this.errorLogger(err)
            throw err
        }
    }

}
