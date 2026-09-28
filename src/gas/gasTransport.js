import { gasFetch } from "./gasFetch.js";
import { endpoints } from "../utilities/endpointsMaster.js";
import * as endpointAsserts from '../utilities/endpointAsserts.js';


export const gasTransport = (main, key, payload) => {

    try {

        // Or, if the key must exist as an own property
        if (typeof key !== 'string' || key === '' || !Object.hasOwn(endpointAsserts ?? {}, key)) {
            throw new Error('Invalid #core request.');
        }

        endpointAsserts[key](payload);
        const endpoint = endpoints[key];
        return gasFetch(main, endpoint, payload);
    } catch (err) {
        main.errorLogger(err)
        throw err;
    }

}