import { ChainId, PriceSource, Confidence } from "../../interfaces/common.js";
import type { PricePoint } from "../../interfaces/common.js";
import { logger } from "../../logger.js";

const PLATFORM_MAP: Record<string, string> = {
  ethereum: "ethereum",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  base: "base",
  polygon: "polygon-pos",
  solana: "solana",
};

const NATIVE_IDS: Record<string, string> = {
  ethereum: "ethereum",
  arbitrum: "ethereum",
  optimism: "ethereum",
  base: "ethereum",
  polygon: "matic-network",
  solana: "solana",
};

export class CoinGeckoAdapter {
  private apiKey?: string;
  private baseUrl: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
    this.baseUrl = apiKey ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
  }

  private async fetch(path: string): Promise<any> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) headers["x-cg-pro-api-key"] = this.apiKey;

    const res = await fetch(`${this.baseUrl}${path}`, { headers });
    if (res.status === 429) throw new Error("CoinGecko rate limited");
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
    return res.json();
  }

  async getCurrentPrice(chain: ChainId, tokenAddress: string): Promise<PricePoint | null> {
    try {
      if (tokenAddress === "native") {
        const id = NATIVE_IDS[chain];
        if (!id) return null;
        const data = await this.fetch(`/simple/price?ids=${id}&vs_currencies=usd`);
        if (!data[id]?.usd) return null;
        return {
          usdPrice: data[id].usd.toString(),
          timestamp: Math.floor(Date.now() / 1000),
          source: PriceSource.COINGECKO,
          confidence: Confidence.HIGH,
        };
      }

      const platform = PLATFORM_MAP[chain];
      if (!platform) return null;
      const data = await this.fetch(`/simple/token_price/${platform}?contract_addresses=${tokenAddress}&vs_currencies=usd`);
      const tokenData = data[tokenAddress.toLowerCase()];
      if (!tokenData?.usd) return null;

      return {
        usdPrice: tokenData.usd.toString(),
        timestamp: Math.floor(Date.now() / 1000),
        source: PriceSource.COINGECKO,
        confidence: Confidence.HIGH,
      };
    } catch (err) {
      logger.warn({ chain, tokenAddress, err }, "CoinGecko price failed");
      return null;
    }
  }

  async getHistoricalPrice(coingeckoId: string, timestamp: number): Promise<PricePoint | null> {
    try {
      // Convert unix timestamp to DD-MM-YYYY
      const date = new Date(timestamp * 1000);
      const dateStr = `${date.getUTCDate().toString().padStart(2, "0")}-${(date.getUTCMonth() + 1).toString().padStart(2, "0")}-${date.getUTCFullYear()}`;

      const data = await this.fetch(`/coins/${coingeckoId}/history?date=${dateStr}`);
      if (!data?.market_data?.current_price?.usd) return null;

      return {
        usdPrice: data.market_data.current_price.usd.toString(),
        timestamp,
        source: PriceSource.COINGECKO,
        confidence: Confidence.MEDIUM,
      };
    } catch (err) {
      logger.warn({ coingeckoId, timestamp, err }, "CoinGecko historical price failed");
      return null;
    }
  }
}
