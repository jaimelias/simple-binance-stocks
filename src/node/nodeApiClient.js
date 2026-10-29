import { nodeFetch } from "./nodeFetch.js";
import { endpoints } from "../utilities/endpointsMaster.js";
import * as endpointAsserts from '../utilities/endpointAsserts.js';
import { consumeOrderGuard } from '../utilities/orderPreparation.js';
import { logError } from '../utilities/logError.js';


export const nodeApiClient = async (main, key, payload) => {

    try {

        if (typeof key !== 'string' || key === '' || !Object.hasOwn(endpointAsserts ?? {}, key)) {
            throw new Error('Invalid core request.');
        }
    
        if (key === 'placeOrder' && !consumeOrderGuard(main, payload)) {
            throw new TypeError('Use placeOrder, createLimitOrder or createMarketOrder to submit guarded orders');
        }
        endpointAsserts[key](payload);
        
        const endpoint = endpoints[key];

        return await nodeFetch(main, endpoint, payload);
    } catch (err) {
        await logError(main, err, key, payload)
        throw err
    }
}
