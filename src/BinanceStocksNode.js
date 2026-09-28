import BinanceStocksCore from "./BinanceStocksCore.js";
import { nodeTransport } from "./node/nodeTransport.js";


export default class BinanceStocks extends BinanceStocksCore {

    constructor(options = {}) {
        super(options, nodeTransport)
    }

    engine() {
        return 'node';
    }

}
