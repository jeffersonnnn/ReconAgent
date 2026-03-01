import { createPublicClient, http, parseAbiItem, formatEther, formatUnits } from "viem";
import { mainnet } from "viem/chains";
import { ChainId, PriceSource, Confidence } from "../../interfaces/common.js";
import type { PricePoint } from "../../interfaces/common.js";
import { logger } from "../../logger.js";

// Receipt token exchange rate contracts
const EXCHANGE_RATE_CONTRACTS: Record<string, {
  address: `0x${string}`;
  method: string;
  abi: any;
  underlying: string; // coingecko/llama id for underlying
  decimals: number;
}> = {
  // wstETH → stETH exchange rate
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": {
    address: "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0",
    method: "stEthPerToken",
    abi: [parseAbiItem("function stEthPerToken() view returns (uint256)")],
    underlying: "ethereum:0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // stETH
    decimals: 18,
  },
  // rETH → ETH exchange rate
  "0xae78736cd615f374d3085123a210448e74fc6393": {
    address: "0xae78736cd615f374d3085123a210448e74fc6393",
    method: "getExchangeRate",
    abi: [parseAbiItem("function getExchangeRate() view returns (uint256)")],
    underlying: "native", // ETH
    decimals: 18,
  },
};

// Compound cToken exchange rate
const CTOKEN_ABI = [parseAbiItem("function exchangeRateStored() view returns (uint256)")];

export class OnChainPricingAdapter {
  private rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  async getExchangeRate(tokenAddress: string): Promise<{ rate: string; underlying: string } | null> {
    const config = EXCHANGE_RATE_CONTRACTS[tokenAddress.toLowerCase()];
    if (!config) return null;

    try {
      const client = createPublicClient({ chain: mainnet, transport: http(this.rpcUrl) });
      const result = await client.readContract({
        address: config.address,
        abi: config.abi,
        functionName: config.method,
      }) as bigint;

      const rate = formatUnits(result, config.decimals);
      return { rate, underlying: config.underlying };
    } catch (err) {
      logger.warn({ tokenAddress, err }, "on-chain exchange rate failed");
      return null;
    }
  }

  // Price = exchangeRate * underlyingPrice
  async getReceiptTokenPrice(
    tokenAddress: string,
    underlyingPriceUsd: string,
    timestamp: number
  ): Promise<PricePoint | null> {
    const exchangeRate = await this.getExchangeRate(tokenAddress);
    if (!exchangeRate) return null;

    const price = parseFloat(exchangeRate.rate) * parseFloat(underlyingPriceUsd);
    return {
      usdPrice: price.toFixed(8),
      timestamp,
      source: PriceSource.ONCHAIN_EXCHANGE_RATE,
      confidence: Confidence.HIGH,
    };
  }

  isReceiptToken(tokenAddress: string): boolean {
    return tokenAddress.toLowerCase() in EXCHANGE_RATE_CONTRACTS;
  }

  getUnderlyingId(tokenAddress: string): string | null {
    const config = EXCHANGE_RATE_CONTRACTS[tokenAddress.toLowerCase()];
    return config?.underlying ?? null;
  }
}
