export const getExchangeInfo = async (main) => {
   return await main.apiClient('exchangeInfo', {});
}