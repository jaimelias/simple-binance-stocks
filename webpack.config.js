import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

export default {
  context: __dirname,
  // The Node.js entry imports node:crypto. Apps Script uses Utilities instead.
  entry: './src/googleAppsScript.js',
  output: {
    filename: 'BinanceStocks.min.js',
    path: resolve(__dirname, 'dist'),
    library: { name: 'BinanceStocks', type: 'var', export: 'default' },
    // Apps Script loads one script and has no browser or Node chunk loader.
    chunkFormat: false,
    chunkLoading: false
  },
  mode: 'production',
  target: 'es2020',
  devtool: false,
  optimization: {
    minimizeOptions: {
      // Error.name is derived from the class name in the shared error classes.
      javascript: { keep_classnames: true }
    }
  }
};
