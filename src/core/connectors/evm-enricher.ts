import { parseAbiItem, decodeAbiParameters, decodeFunctionData } from "viem";
import { TokenCategory } from "../../interfaces/common.js";
import type { RawTransaction, TokenTransfer } from "./types.js";
import { logger } from "../../logger.js";

// Known method signatures (first 4 bytes)
const KNOWN_METHODS: Record<string, { name: string; protocol?: string }> = {
  // Uniswap V2
  "0x38ed1739": { name: "swapExactTokensForTokens", protocol: "uniswap_v2" },
  "0x8803dbee": { name: "swapTokensForExactTokens", protocol: "uniswap_v2" },
  "0x7ff36ab5": { name: "swapExactETHForTokens", protocol: "uniswap_v2" },
  "0x18cbafe5": { name: "swapExactTokensForETH", protocol: "uniswap_v2" },
  "0xe8e33700": { name: "addLiquidity", protocol: "uniswap_v2" },
  "0xf305d719": { name: "addLiquidityETH", protocol: "uniswap_v2" },
  "0xbaa2abde": { name: "removeLiquidity", protocol: "uniswap_v2" },
  "0x02751cec": { name: "removeLiquidityETH", protocol: "uniswap_v2" },

  // Uniswap V3
  "0x414bf389": { name: "exactInputSingle", protocol: "uniswap_v3" },
  "0xc04b8d59": { name: "exactInput", protocol: "uniswap_v3" },
  "0xdb3e2198": { name: "exactOutputSingle", protocol: "uniswap_v3" },
  "0xf28c0498": { name: "exactOutput", protocol: "uniswap_v3" },
  "0xac9650d8": { name: "multicall", protocol: "uniswap_v3" },
  "0x5ae401dc": { name: "multicall_deadline", protocol: "uniswap_v3" },

  // Aave V3
  "0x617ba037": { name: "supply", protocol: "aave_v3" },
  "0x69328dec": { name: "withdraw", protocol: "aave_v3" },
  "0xa415bcad": { name: "borrow", protocol: "aave_v3" },
  "0x573ade81": { name: "repay", protocol: "aave_v3" },
  "0xe8eda9df": { name: "deposit", protocol: "aave_v3" },

  // Lido
  "0xa1903eab": { name: "submit", protocol: "lido" },
  "0x095ea7b3": { name: "approve" },
  "0xa22cb465": { name: "setApprovalForAll" },

  // Curve
  "0x3df02124": { name: "exchange", protocol: "curve" },
  "0xa6417ed6": { name: "exchange_underlying", protocol: "curve" },
  "0x0b4c7e4d": { name: "add_liquidity_2", protocol: "curve" },
  "0x4515cef3": { name: "add_liquidity_3", protocol: "curve" },
  "0xecb586a5": { name: "remove_liquidity_2", protocol: "curve" },

  // Wrapping
  "0xd0e30db0": { name: "deposit_weth" }, // WETH deposit
  "0x2e1a7d4d": { name: "withdraw_weth" }, // WETH withdraw

  // ERC20
  "0xa9059cbb": { name: "transfer" },
  "0x23b872dd": { name: "transferFrom" },
};

// Known protocol contract addresses (lowercase)
const KNOWN_CONTRACTS: Record<string, { protocol: string; name: string }> = {
  // Ethereum mainnet
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": { protocol: "uniswap_v2", name: "UniswapV2Router02" },
  "0xe592427a0aece92de3edee1f18e0157c05861564": { protocol: "uniswap_v3", name: "SwapRouter" },
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": { protocol: "uniswap_v3", name: "SwapRouter02" },
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": { protocol: "uniswap_v3", name: "UniversalRouter" },
  "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2": { protocol: "aave_v3", name: "Pool" },
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": { protocol: "lido", name: "stETH" },
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": { protocol: "lido", name: "wstETH" },
  "0xae78736cd615f374d3085123a210448e74fc6393": { protocol: "rocketpool", name: "rETH" },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { protocol: "weth", name: "WETH" },
  "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f": { protocol: "sushiswap", name: "SushiSwapRouter" },
  // Bridge contracts
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35": { protocol: "base_bridge", name: "L1StandardBridge" },
  "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1": { protocol: "optimism_bridge", name: "L1StandardBridge" },
  "0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a": { protocol: "arbitrum_bridge", name: "Bridge" },
};

// Known receipt tokens
const RECEIPT_TOKENS: Set<string> = new Set([
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", // wstETH
  "0xae78736cd615f374d3085123a210448e74fc6393", // rETH
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // stETH
]);

// Stablecoin addresses
const STABLECOINS: Set<string> = new Set([
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
  "0x4fabb145d64652a948d72533023f6e7a623c7c53", // BUSD
  "0x853d955acef822db058eb8505911ed77f175b99e", // FRAX
]);

export function enrichTransaction(raw: RawTransaction): RawTransaction {
  const enriched = { ...raw };
  const enrichmentSteps: string[] = [];

  // Enrich method name
  if (raw.methodId && KNOWN_METHODS[raw.methodId]) {
    enriched.methodName = KNOWN_METHODS[raw.methodId].name;
    enrichmentSteps.push("method_decode");
  }

  // Enrich contract info
  const contractInfo = KNOWN_CONTRACTS[raw.to];
  if (contractInfo) {
    enriched.rawData = {
      ...enriched.rawData,
      knownProtocol: contractInfo.protocol,
      knownContractName: contractInfo.name,
    };
    enrichmentSteps.push("contract_identify");
  }

  // Enrich token categories
  for (const transfer of enriched.tokenTransfers) {
    const addr = transfer.token.address.toLowerCase();
    if (RECEIPT_TOKENS.has(addr)) {
      transfer.token.category = TokenCategory.RECEIPT_TOKEN;
    } else if (STABLECOINS.has(addr)) {
      transfer.token.category = TokenCategory.STABLECOIN;
    }
  }

  if (enrichmentSteps.length > 0) {
    enriched.rawData = { ...enriched.rawData, enrichmentSteps };
  }

  return enriched;
}

export function getProtocolFromTransaction(raw: RawTransaction): string | undefined {
  // Check contract address first
  const contractInfo = KNOWN_CONTRACTS[raw.to];
  if (contractInfo) return contractInfo.protocol;

  // Check method signature
  if (raw.methodId && KNOWN_METHODS[raw.methodId]?.protocol) {
    return KNOWN_METHODS[raw.methodId].protocol;
  }

  return undefined;
}

export function getMethodName(methodId: string): string | undefined {
  return KNOWN_METHODS[methodId]?.name;
}
