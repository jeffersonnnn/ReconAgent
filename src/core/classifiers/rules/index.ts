import { TransactionType, Confidence, TokenCategory } from "../../../interfaces/common.js";
import type { ClassificationAudit, DataLineage } from "../../../interfaces/output.js";
import type { RawTransaction } from "../../connectors/types.js";
import { MODEL_VERSION } from "../../../config.js";
import type { ClassificationResult } from "../engine.js";

// WETH addresses across chains
const WETH_ADDRESSES = new Set([
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // Ethereum
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // Arbitrum
  "0x4200000000000000000000000000000000000006", // Optimism/Base
  "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WMATIC on Polygon
]);

function makeAudit(confidence: Confidence, rationale: string, lineage: DataLineage, ruleId?: string): ClassificationAudit {
  return {
    method: "heuristic",
    ruleId,
    confidence,
    rationale,
    modelVersion: MODEL_VERSION,
    dataLineage: lineage,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

export function classifyByRules(raw: RawTransaction, lineage: DataLineage): ClassificationResult | null {
  // Failed transactions — classify as gas expense
  if (!raw.success) {
    return {
      type: TransactionType.GAS,
      subType: "failed_tx",
      audit: makeAudit(Confidence.HIGH, "failed transaction — gas expense only", lineage, "failed_tx"),
    };
  }

  // Approval-only transaction (approve method, no token transfers)
  if (raw.methodId === "0x095ea7b3" && raw.tokenTransfers.length === 0) {
    return {
      type: TransactionType.APPROVAL,
      audit: makeAudit(Confidence.HIGH, "ERC20 approve with no transfers", lineage, "approval"),
    };
  }

  // WETH wrap/unwrap
  if (raw.methodId === "0xd0e30db0" && WETH_ADDRESSES.has(raw.to)) {
    return {
      type: TransactionType.WRAP,
      subType: "weth_deposit",
      audit: makeAudit(Confidence.HIGH, "WETH deposit (wrap ETH)", lineage, "weth_wrap"),
    };
  }
  if (raw.methodId === "0x2e1a7d4d" && WETH_ADDRESSES.has(raw.to)) {
    return {
      type: TransactionType.UNWRAP,
      subType: "weth_withdraw",
      audit: makeAudit(Confidence.HIGH, "WETH withdraw (unwrap ETH)", lineage, "weth_unwrap"),
    };
  }

  // Simple native transfer (no method call, no token transfers)
  if ((!raw.methodId || raw.methodId === "0x") && raw.tokenTransfers.length === 0 && parseFloat(raw.value) > 0) {
    return {
      type: TransactionType.TRANSFER_OUT,
      audit: makeAudit(Confidence.HIGH, "simple native token transfer", lineage, "native_transfer"),
    };
  }

  // Simple ERC20 transfer (transfer method, single token transfer)
  if (raw.methodId === "0xa9059cbb" && raw.tokenTransfers.length === 1) {
    return {
      type: TransactionType.TRANSFER_OUT,
      subType: "erc20_transfer",
      audit: makeAudit(Confidence.HIGH, "ERC20 transfer() call", lineage, "erc20_transfer"),
    };
  }

  // Swap heuristic: tokens going both ways through the wallet
  const tokensIn = raw.tokenTransfers.filter((t) => t.to.toLowerCase() === raw.from.toLowerCase());
  const tokensOut = raw.tokenTransfers.filter((t) => t.from.toLowerCase() === raw.from.toLowerCase());
  if (tokensIn.length > 0 && tokensOut.length > 0) {
    return {
      type: TransactionType.SWAP,
      audit: makeAudit(Confidence.MEDIUM, "tokens flowing in and out — likely swap", lineage, "swap_heuristic"),
    };
  }

  // Tokens only coming in (not from self) — could be airdrop, claim, or transfer in
  if (tokensIn.length > 0 && tokensOut.length === 0) {
    // Check if it's a claim (wallet initiated the tx)
    if (raw.from.toLowerCase() === raw.from.toLowerCase()) {
      return {
        type: TransactionType.CLAIM_REWARD,
        audit: makeAudit(Confidence.LOW, "tokens received via initiated transaction — possibly a claim", lineage, "claim_heuristic"),
      };
    }
    return {
      type: TransactionType.TRANSFER_IN,
      audit: makeAudit(Confidence.MEDIUM, "tokens received with no outbound", lineage, "transfer_in_heuristic"),
    };
  }

  // Tokens only going out
  if (tokensOut.length > 0 && tokensIn.length === 0 && raw.methodId && raw.methodId !== "0xa9059cbb") {
    return {
      type: TransactionType.TRANSFER_OUT,
      audit: makeAudit(Confidence.LOW, "tokens sent via contract interaction", lineage, "transfer_out_heuristic"),
    };
  }

  // Contract deployment
  if (raw.contractAddress) {
    return {
      type: TransactionType.CONTRACT_DEPLOY,
      audit: makeAudit(Confidence.HIGH, "contract creation transaction", lineage, "contract_deploy"),
    };
  }

  // Solana-specific heuristics
  if (raw.chain === "solana") {
    return classifySolanaHeuristic(raw, lineage);
  }

  return null;
}

function classifySolanaHeuristic(raw: RawTransaction, lineage: DataLineage): ClassificationResult | null {
  const heliusType = (raw.rawData as any)?.heliusType as string | undefined;

  switch (heliusType) {
    case "SWAP":
      return {
        type: TransactionType.SWAP,
        protocol: (raw.rawData as any)?.protocol,
        audit: makeAudit(Confidence.HIGH, `Helius classified as SWAP`, lineage, "helius_swap"),
      };
    case "TRANSFER":
    case "TOKEN":
      return {
        type: TransactionType.TRANSFER_OUT,
        audit: makeAudit(Confidence.MEDIUM, `Helius classified as ${heliusType}`, lineage, "helius_transfer"),
      };
    case "STAKE_SOL":
      return {
        type: TransactionType.STAKE,
        audit: makeAudit(Confidence.HIGH, "Helius classified as STAKE_SOL", lineage, "helius_stake"),
      };
    case "UNSTAKE_SOL":
      return {
        type: TransactionType.UNSTAKE,
        audit: makeAudit(Confidence.HIGH, "Helius classified as UNSTAKE_SOL", lineage, "helius_unstake"),
      };
  }

  return null;
}
