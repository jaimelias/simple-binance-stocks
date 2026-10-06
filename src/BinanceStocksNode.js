import BinanceStocksCore from "./BinanceStocksCore.js";
import { nodeApiClient } from "./node/nodeApiClient.js";
import { createClientOrderId } from "./node/nodeOrderId.js";


export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'node';
    }

    /** Supply a runtime UUID to the shared placement implementation. */
    createClientOrderId() { return createClientOrderId(); }

    async apiClient(key, payload = {}) {

        return nodeApiClient(this, key, payload);
    }

}
