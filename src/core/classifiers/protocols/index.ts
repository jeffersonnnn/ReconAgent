import { TransactionType, Confidence } from "../../../interfaces/common.js";
import type { DataLineage } from "../../../interfaces/output.js";
import type { RawTransaction } from "../../connectors/types.js";
import { MODEL_VERSION } from "../../../config.js";
import type { ClassificationResult } from "../engine.js";
import { getProtocolFromTransaction } from "../../connectors/evm-enricher.js";

// Known protocol router/contract addresses
const UNISWAP_V2_ROUTERS = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
  "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f", // SushiSwap
]);

const UNISWAP_V3_ROUTERS = new Set([
  "0xe592427a0aece92de3edee1f18e0157c05861564",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // UniversalRouter
]);

const AAVE_V3_POOLS = new Set([
  "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", // Ethereum
  "0x794a61358d6845594f94dc1db02a252b5b4814ad", // Arbitrum/Optimism/Polygon
  "0xa238dd80c259a72e81d7e4664a9801593f98d1c5", // Base
]);

const LIDO_CONTRACTS = new Set([
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // stETH
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", // wstETH
]);

const CURVE_POOLS_PREFIX = "0x"; // Curve has many pools, check by method ID

// Bridge protocols
const BRIDGE_CONTRACTS = new Set([
  "0x3154cf16ccdb4c6d922629664174b904d80f2c35", // Base Bridge
  "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1", // Optimism Bridge
  "0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a", // Arbitrum Bridge
  "0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf", // Polygon Bridge
]);

function makeAudit(confidence: Confidence, rationale: string, lineage: DataLineage, protocol: string): ClassificationResult["audit"] {
  return {
    method: "protocol_pattern",
    confidence,
    rationale,
    modelVersion: MODEL_VERSION,
    dataLineage: lineage,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

export function classifyByProtocol(raw: RawTransaction, lineage: DataLineage): ClassificationResult | null {
  const to = raw.to.toLowerCase();
  const methodId = raw.methodId;

  // --- Uniswap V2 ---
  if (UNISWAP_V2_ROUTERS.has(to)) {
    if (methodId?.startsWith("0xe8e337") || methodId?.startsWith("0xf305d7")) {
      return { type: TransactionType.LP_ADD, protocol: "uniswap_v2", subType: "add_liquidity", audit: makeAudit(Confidence.HIGH, "Uniswap V2 addLiquidity", lineage, "uniswap_v2") };
    }
    if (methodId?.startsWith("0xbaa2ab") || methodId?.startsWith("0x02751c")) {
      return { type: TransactionType.LP_REMOVE, protocol: "uniswap_v2", subType: "remove_liquidity", audit: makeAudit(Confidence.HIGH, "Uniswap V2 removeLiquidity", lineage, "uniswap_v2") };
    }
    return { type: TransactionType.SWAP, protocol: "uniswap_v2", subType: "swap", audit: makeAudit(Confidence.HIGH, "Uniswap V2 swap", lineage, "uniswap_v2") };
  }

  // --- Uniswap V3 ---
  if (UNISWAP_V3_ROUTERS.has(to)) {
    return { type: TransactionType.SWAP, protocol: "uniswap_v3", subType: "swap", audit: makeAudit(Confidence.HIGH, "Uniswap V3 router interaction", lineage, "uniswap_v3") };
  }

  // --- Aave V3 ---
  if (AAVE_V3_POOLS.has(to)) {
    if (methodId === "0x617ba037" || methodId === "0xe8eda9df") {
      return { type: TransactionType.LEND, protocol: "aave_v3", subType: "supply", audit: makeAudit(Confidence.HIGH, "Aave V3 supply/deposit", lineage, "aave_v3") };
    }
    if (methodId === "0x69328dec") {
      return { type: TransactionType.WITHDRAW_COLLATERAL, protocol: "aave_v3", subType: "withdraw", audit: makeAudit(Confidence.HIGH, "Aave V3 withdraw", lineage, "aave_v3") };
    }
    if (methodId === "0xa415bcad") {
      return { type: TransactionType.BORROW, protocol: "aave_v3", subType: "borrow", audit: makeAudit(Confidence.HIGH, "Aave V3 borrow", lineage, "aave_v3") };
    }
    if (methodId === "0x573ade81") {
      return { type: TransactionType.REPAY, protocol: "aave_v3", subType: "repay", audit: makeAudit(Confidence.HIGH, "Aave V3 repay", lineage, "aave_v3") };
    }
    return { type: TransactionType.UNKNOWN, protocol: "aave_v3", audit: makeAudit(Confidence.MEDIUM, "Aave V3 pool interaction", lineage, "aave_v3") };
  }

  // --- Lido ---
  if (LIDO_CONTRACTS.has(to)) {
    if (methodId === "0xa1903eab") {
      return { type: TransactionType.STAKE, protocol: "lido", subType: "submit", audit: makeAudit(Confidence.HIGH, "Lido stETH submit (stake)", lineage, "lido") };
    }
    // wstETH wrap/unwrap
    if (to === "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0") {
      if (methodId === "0xea598cb0") { // wrap
        return { type: TransactionType.WRAP, protocol: "lido", subType: "wsteth_wrap", audit: makeAudit(Confidence.HIGH, "wstETH wrap", lineage, "lido") };
      }
      if (methodId === "0xde0e9a3e") { // unwrap
        return { type: TransactionType.UNWRAP, protocol: "lido", subType: "wsteth_unwrap", audit: makeAudit(Confidence.HIGH, "wstETH unwrap", lineage, "lido") };
      }
    }
  }

  // --- Bridge ---
  if (BRIDGE_CONTRACTS.has(to)) {
    return { type: TransactionType.BRIDGE_OUT, protocol: getBridgeProtocol(to), subType: "bridge_deposit", audit: makeAudit(Confidence.HIGH, "bridge deposit detected", lineage, "bridge") };
  }

  // --- Curve (method ID based) ---
  if (methodId === "0x3df02124" || methodId === "0xa6417ed6") {
    return { type: TransactionType.SWAP, protocol: "curve", subType: "exchange", audit: makeAudit(Confidence.MEDIUM, "Curve exchange method detected", lineage, "curve") };
  }
  if (methodId === "0x0b4c7e4d" || methodId === "0x4515cef3") {
    return { type: TransactionType.LP_ADD, protocol: "curve", subType: "add_liquidity", audit: makeAudit(Confidence.MEDIUM, "Curve add_liquidity method detected", lineage, "curve") };
  }

  // --- Solana protocols ---
  if (raw.chain === "solana") {
    return classifySolanaProtocol(raw, lineage);
  }

  return null;
}

function classifySolanaProtocol(raw: RawTransaction, lineage: DataLineage): ClassificationResult | null {
  const source = (raw.rawData as any)?.heliusSource as string | undefined;
  const protocol = (raw.rawData as any)?.protocol as string | undefined;

  if (protocol === "jupiter" || source === "JUPITER") {
    return { type: TransactionType.SWAP, protocol: "jupiter", subType: "aggregator_swap", audit: makeAudit(Confidence.HIGH, "Jupiter aggregator swap", lineage, "jupiter") };
  }
  if (protocol === "marinade" || source === "MARINADE_FINANCE") {
    const heliusType = (raw.rawData as any)?.heliusType;
    if (heliusType === "STAKE_SOL") {
      return { type: TransactionType.STAKE, protocol: "marinade", subType: "stake_sol", audit: makeAudit(Confidence.HIGH, "Marinade SOL stake", lineage, "marinade") };
    }
    if (heliusType === "UNSTAKE_SOL") {
      return { type: TransactionType.UNSTAKE, protocol: "marinade", subType: "unstake_sol", audit: makeAudit(Confidence.HIGH, "Marinade SOL unstake", lineage, "marinade") };
    }
  }
  if (protocol === "raydium" || source === "RAYDIUM") {
    return { type: TransactionType.SWAP, protocol: "raydium", subType: "swap", audit: makeAudit(Confidence.HIGH, "Raydium swap", lineage, "raydium") };
  }
  if (protocol === "orca" || source === "ORCA") {
    return { type: TransactionType.SWAP, protocol: "orca", subType: "swap", audit: makeAudit(Confidence.HIGH, "Orca swap", lineage, "orca") };
  }

  return null;
}

function getBridgeProtocol(address: string): string {
  switch (address) {
    case "0x3154cf16ccdb4c6d922629664174b904d80f2c35": return "base_bridge";
    case "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1": return "optimism_bridge";
    case "0x8315177ab297ba92a06054ce80a67ed4dbd7ed3a": return "arbitrum_bridge";
    case "0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf": return "polygon_bridge";
    default: return "unknown_bridge";
  }
}
