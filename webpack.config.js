import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  entry: './src/BinanceStocksGas.js',
  output: {
    filename: 'BinanceStocksGas.min.js',
    path: resolve(__dirname, 'dist'),
    library: { name: 'BinanceStocks', type: 'var', export: 'default' },
    // Apps Script loads one script and has no browser or Node chunk loader.
    chunkFormat: false,
    chunkLoading: false
  },
  mode: 'production',
  target: 'web',
};
