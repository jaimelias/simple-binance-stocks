import { nodeFetch } from "./nodeFetch.js";
import { endpoints } from "../utilities/endpointsMaster.js";
import * as endpointAsserts from '../utilities/endpointAsserts.js';


export const nodeApiClient = async (main, key, payload) => {

    try {

        if (typeof key !== 'string' || key === '' || !Object.hasOwn(endpointAsserts ?? {}, key)) {
            throw new Error('Invalid core request.');
        }
    
        endpointAsserts[key](payload);
        
        const endpoint = endpoints[key];

        return await nodeFetch(main, endpoint, payload);
    } catch (err) {
        main.errorLogger(err)
        throw err
    }
}