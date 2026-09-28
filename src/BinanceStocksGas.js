import BinanceStocksCore from "./BinanceStocksCore.js";
import { gasTransport } from "./gas/gasTransport.js";

export default class BinanceStocks extends BinanceStocksCore {

    constructor(options = {}) {
        super(options, gasTransport)
    }

    engine() {
        return 'gas';
    }

}
