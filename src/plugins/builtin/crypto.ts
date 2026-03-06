import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export class CryptoPlugin implements Plugin {
  name = 'crypto';
  description = 'Cryptocurrency prices, market data, and conversions';
  version = '1.0.0';

  async initialize(_conductor: Conductor): Promise<void> {}
  isConfigured(): boolean { return true; } // No API key needed

  getTools(): PluginTool[] {
    return [
      {
        name: 'crypto_price',
        description: 'Get current price of a cryptocurrency',
        inputSchema: {
          type: 'object',
          properties: {
            coin: { type: 'string', description: 'Coin ID (bitcoin, ethereum, etc.)' },
            currency: { type: 'string', description: 'Fiat currency (usd, eur, cad)', default: 'usd' },
          },
          required: ['coin'],
        },
        handler: async (input: { coin: string; currency?: string }) => {
          const currency = input.currency || 'usd';
          const res = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(input.coin)}&vs_currencies=${currency}&include_24hr_change=true&include_market_cap=true`
          );
          if (!res.ok) throw new Error(`CoinGecko API error: ${res.statusText}`);
          const data = await res.json() as any;
          const coinData = data[input.coin.toLowerCase()];
          if (!coinData) throw new Error(`Coin not found: ${input.coin}`);
          return {
            coin: input.coin,
            price: coinData[currency],
            change_24h: coinData[`${currency}_24h_change`],
            market_cap: coinData[`${currency}_market_cap`],
            currency,
          };
        },
      },
      {
        name: 'crypto_trending',
        description: 'Get trending cryptocurrencies',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const res = await fetch('https://api.coingecko.com/api/v3/search/trending');
          if (!res.ok) throw new Error(`CoinGecko API error: ${res.statusText}`);
          const data = await res.json() as any;
          return data.coins.map((c: any) => ({
            name: c.item.name,
            symbol: c.item.symbol,
            rank: c.item.market_cap_rank,
            price_btc: c.item.price_btc,
          }));
        },
      },
      {
        name: 'crypto_search',
        description: 'Search for a cryptocurrency by name or symbol',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
        handler: async (input: { query: string }) => {
          const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(input.query)}`);
          if (!res.ok) throw new Error(`CoinGecko API error: ${res.statusText}`);
          const data = await res.json() as any;
          return data.coins.slice(0, 10).map((c: any) => ({
            id: c.id,
            name: c.name,
            symbol: c.symbol,
            rank: c.market_cap_rank,
          }));
        },
      },
    ];
  }
}
