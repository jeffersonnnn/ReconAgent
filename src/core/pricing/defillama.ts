import { ChainId, PriceSource, Confidence } from "../../interfaces/common.js";
import type { PricePoint } from "../../interfaces/common.js";
import { logger } from "../../logger.js";

// DeFi Llama chain name mapping
const CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  arbitrum: "arbitrum",
  optimism: "optimism",
  base: "base",
  polygon: "polygon",
  solana: "solana",
};

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
        continue;
      }
      if (!res.ok) throw new Error(`DeFi Llama API error: ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
}

export class DefiLlamaAdapter {
  // Get current price for a token
  async getCurrentPrice(chain: ChainId, tokenAddress: string): Promise<PricePoint | null> {
    const llamaChain = CHAIN_MAP[chain];
    if (!llamaChain) return null;

    const coinId = tokenAddress === "native"
      ? `coingecko:${this.getNativeCoingeckoId(chain)}`
      : `${llamaChain}:${tokenAddress}`;

    try {
      const data = await fetchWithRetry(`https://coins.llama.fi/prices/current/${coinId}`);
      const coin = data?.coins?.[coinId];
      if (!coin?.price) return null;

      return {
        usdPrice: coin.price.toString(),
        timestamp: Math.floor(coin.timestamp ?? Date.now() / 1000),
        source: PriceSource.DEFILLAMA,
        confidence: coin.confidence && coin.confidence > 0.9 ? Confidence.HIGH : Confidence.MEDIUM,
      };
    } catch (err) {
      logger.warn({ chain, tokenAddress, err }, "DeFi Llama current price failed");
      return null;
    }
  }

  // Get historical price at a specific timestamp
  async getHistoricalPrice(chain: ChainId, tokenAddress: string, timestamp: number): Promise<PricePoint | null> {
    const llamaChain = CHAIN_MAP[chain];
    if (!llamaChain) return null;

    const coinId = tokenAddress === "native"
      ? `coingecko:${this.getNativeCoingeckoId(chain)}`
      : `${llamaChain}:${tokenAddress}`;

    try {
      const data = await fetchWithRetry(`https://coins.llama.fi/prices/historical/${timestamp}/${coinId}`);
      const coin = data?.coins?.[coinId];
      if (!coin?.price) return null;

      return {
        usdPrice: coin.price.toString(),
        timestamp: Math.floor(coin.timestamp ?? timestamp),
        source: PriceSource.DEFILLAMA,
        confidence: Confidence.HIGH,
      };
    } catch (err) {
      logger.warn({ chain, tokenAddress, timestamp, err }, "DeFi Llama historical price failed");
      return null;
    }
  }

  // Batch price lookup
  async getBatchPrices(coins: Array<{ chain: ChainId; tokenAddress: string }>): Promise<Map<string, PricePoint>> {
    const result = new Map<string, PricePoint>();
    const coinIds = coins.map((c) => {
      const llamaChain = CHAIN_MAP[c.chain];
      if (!llamaChain) return null;
      return c.tokenAddress === "native"
        ? `coingecko:${this.getNativeCoingeckoId(c.chain)}`
        : `${llamaChain}:${c.tokenAddress}`;
    }).filter(Boolean) as string[];

    if (coinIds.length === 0) return result;

    try {
      const data = await fetchWithRetry(`https://coins.llama.fi/prices/current/${coinIds.join(",")}`);
      for (const [id, coin] of Object.entries(data?.coins ?? {}) as [string, any][]) {
        if (!coin?.price) continue;
        result.set(id, {
          usdPrice: coin.price.toString(),
          timestamp: Math.floor(coin.timestamp ?? Date.now() / 1000),
          source: PriceSource.DEFILLAMA,
          confidence: Confidence.HIGH,
        });
      }
    } catch (err) {
      logger.warn({ err }, "DeFi Llama batch price failed");
    }

    return result;
  }

  private getNativeCoingeckoId(chain: ChainId): string {
    switch (chain) {
      case ChainId.ETHEREUM:
      case ChainId.ARBITRUM:
      case ChainId.OPTIMISM:
      case ChainId.BASE:
        return "ethereum";
      case ChainId.POLYGON:
        return "matic-network";
      case ChainId.SOLANA:
        return "solana";
      default:
        return "ethereum";
    }
  }
}
