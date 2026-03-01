import type { ChainId } from "../../interfaces/common.js";
import type { StorageAdapter } from "../../storage/adapter.js";

export class PriceCache {
  constructor(private storage: StorageAdapter) {}

  async get(chain: ChainId, tokenAddress: string, timestamp: number): Promise<{ priceUsd: string; source: string } | null> {
    return this.storage.getCachedPrice(chain, tokenAddress, timestamp);
  }

  async set(chain: ChainId, tokenAddress: string, timestamp: number, priceUsd: string, source: string): Promise<void> {
    await this.storage.cachePrice(chain, tokenAddress, timestamp, priceUsd, source);
  }
}
