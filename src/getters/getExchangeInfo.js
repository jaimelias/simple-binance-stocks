export const getExchangeInfo = async (main) => {

   if(!main.exchangeInfo) {
      return main.exchangeInfo = Object.freeze(await main.apiClient('exchangeInfo'));
   }

   return main.exchangeInfo;
   
}