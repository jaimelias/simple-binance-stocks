export const getSymbolInfo = async (main, symbol) => {
    const exchange = await main.apiClient('exchangeInfo', {});
    const symbolInfo = exchange.symbols.find(o => o.symbol === symbol);
    return symbolInfo;
}