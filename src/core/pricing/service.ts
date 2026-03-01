import { ChainId, PriceSource, Confidence } from "../../interfaces/common.js";
import type { PricePoint } from "../../interfaces/common.js";
import type { StorageAdapter } from "../../storage/adapter.js";
import { DefiLlamaAdapter } from "./defillama.js";
import { CoinGeckoAdapter } from "./coingecko.js";
import { OnChainPricingAdapter } from "./onchain.js";
import { PriceCache } from "./cache.js";
import { logger } from "../../logger.js";

// Known stablecoins (address → true)
const STABLECOINS = new Set([
  // Ethereum
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "0x4fabb145d64652a948d72533023f6e7a623c7c53", // BUSD
  "0x853d955acef822db058eb8505911ed77f175b99e", // FRAX
  // Solana
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (Solana)
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT (Solana)
]);

const DE_PEG_THRESHOLD = 0.02; // 2% deviation from $1.00

export class PricingService {
  private llama: DefiLlamaAdapter;
  private coingecko: CoinGeckoAdapter;
  private onchain: OnChainPricingAdapter;
  private cache: PriceCache;

  constructor(
    storage: StorageAdapter,
    opts: { coingeckoApiKey?: string; evmRpcUrl?: string }
  ) {
    this.llama = new DefiLlamaAdapter();
    this.coingecko = new CoinGeckoAdapter(opts.coingeckoApiKey);
    this.onchain = new OnChainPricingAdapter(opts.evmRpcUrl ?? "");
    this.cache = new PriceCache(storage);
  }

  async getPrice(chain: ChainId, tokenAddress: string, timestamp: number): Promise<PricePoint> {
    const addr = tokenAddress.toLowerCase();

    // 1. Stablecoin shortcut
    if (STABLECOINS.has(addr)) {
      return this.stablecoinPrice(chain, addr, timestamp);
    }

    // 2. Check cache
    const cached = await this.cache.get(chain, addr, timestamp);
    if (cached) {
      return {
        usdPrice: cached.priceUsd,
        timestamp,
        source: PriceSource.CACHE,
        confidence: Confidence.HIGH,
      };
    }

    // 3. Receipt tokens (wstETH, rETH) — on-chain exchange rate
    if (this.onchain.isReceiptToken(addr)) {
      const price = await this.priceReceiptToken(chain, addr, timestamp);
      if (price) {
        await this.cache.set(chain, addr, timestamp, price.usdPrice, price.source);
        return price;
      }
    }

    // 4. DeFi Llama (primary)
    const isRecent = Math.abs(Date.now() / 1000 - timestamp) < 300; // within 5 min
    const llamaPrice = isRecent
      ? await this.llama.getCurrentPrice(chain, addr)
      : await this.llama.getHistoricalPrice(chain, addr, timestamp);

    if (llamaPrice) {
      await this.cache.set(chain, addr, timestamp, llamaPrice.usdPrice, llamaPrice.source);
      return llamaPrice;
    }

    // 5. CoinGecko fallback
    const cgPrice = await this.coingecko.getCurrentPrice(chain, addr);
    if (cgPrice) {
      await this.cache.set(chain, addr, timestamp, cgPrice.usdPrice, cgPrice.source);
      return cgPrice;
    }

    // 6. No price found
    logger.warn({ chain, tokenAddress: addr, timestamp }, "no price found");
    return {
      usdPrice: "0",
      timestamp,
      source: PriceSource.MANUAL,
      confidence: Confidence.LOW,
    };
  }

  private async stablecoinPrice(chain: ChainId, tokenAddress: string, timestamp: number): Promise<PricePoint> {
    // Check for de-peg by querying actual price
    const actualPrice = await this.llama.getCurrentPrice(chain, tokenAddress);
    if (actualPrice && Math.abs(parseFloat(actualPrice.usdPrice) - 1.0) > DE_PEG_THRESHOLD) {
      logger.warn({ tokenAddress, price: actualPrice.usdPrice }, "stablecoin de-peg detected");
      await this.cache.set(chain, tokenAddress, timestamp, actualPrice.usdPrice, actualPrice.source);
      return actualPrice;
    }

    return {
      usdPrice: "1.00",
      timestamp,
      source: PriceSource.STABLECOIN_PEG,
      confidence: Confidence.HIGH,
    };
  }

  private async priceReceiptToken(chain: ChainId, tokenAddress: string, timestamp: number): Promise<PricePoint | null> {
    const underlyingId = this.onchain.getUnderlyingId(tokenAddress);
    if (!underlyingId) return null;

    // Get underlying price
    let underlyingPrice: PricePoint | null = null;
    if (underlyingId === "native") {
      underlyingPrice = await this.getPrice(chain, "native", timestamp);
    } else {
      // underlyingId is in "chain:address" format
      const [underChain, underAddr] = underlyingId.split(":");
      underlyingPrice = await this.llama.getHistoricalPrice(underChain as ChainId, underAddr, timestamp);
    }

    if (!underlyingPrice || underlyingPrice.usdPrice === "0") return null;

    return this.onchain.getReceiptTokenPrice(tokenAddress, underlyingPrice.usdPrice, timestamp);
  }
}
