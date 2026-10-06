import BinanceStocksCore from "./BinanceStocksCore.js";
import { gasApiClient } from "./gas/gasApiClient.js";
import { createClientOrderId } from "./gas/gasOrderId.js";

export default class BinanceStocks extends BinanceStocksCore {

    engine() {
        return 'gas';
    }

    /** Supply a runtime UUID to the shared placement implementation. */
    createClientOrderId() { return createClientOrderId(); }

    async apiClient(key, payload = {}) {

        return gasApiClient(this, key, payload);
    }
}
