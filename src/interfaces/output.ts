import type {
  ChainId,
  TransactionType,
  TokenAmount,
  PricePoint,
  Confidence,
  JournalSide,
  PriceSource,
  ReconciliationStatus,
} from "./common.js";

// Fully classified transaction
export interface ClassifiedTransaction {
  id: string; // deterministic: chain:txHash:logIndex
  chain: ChainId;
  txHash: string;
  blockNumber: number;
  blockTimestamp: number; // unix seconds
  from: string;
  to: string;
  wallet: string; // the monitored wallet address
  type: TransactionType;
  subType?: string; // e.g. "uniswap_v3_exact_input"
  protocol?: string; // e.g. "uniswap_v3", "aave_v3", "lido"
  tokensIn: PricedTokenAmount[];
  tokensOut: PricedTokenAmount[];
  gasFee: PricedTokenAmount;
  gasCapitalized: boolean; // true if gas added to acquisition cost basis
  classification: ClassificationAudit;
  rawData: Record<string, unknown>; // original chain data for audit
}

// Token amount with USD pricing
export interface PricedTokenAmount {
  token: TokenAmount["token"];
  amount: string;
  rawAmount: string;
  usdValue: string; // decimal string
  price: PricePoint;
}

// Full audit trail for every classification decision
export interface ClassificationAudit {
  method: "user_rule" | "protocol_pattern" | "heuristic" | "manual_override";
  ruleId?: string;
  confidence: Confidence;
  rationale: string;
  modelVersion: string; // e.g. "recon-agent-v1.0.0"
  dataLineage: DataLineage;
  timestamp: number;
}

export interface DataLineage {
  rpcSource: string; // e.g. "alchemy", "helius"
  blockConfirmations: number;
  priceSource: PriceSource;
  enrichmentSteps: string[]; // e.g. ["abi_decode", "receipt_analysis", "internal_tx_fetch"]
}

// Double-entry journal entry
export interface JournalEntry {
  id: string;
  transactionId: string; // links to ClassifiedTransaction.id
  date: string; // ISO date YYYY-MM-DD
  timestamp: number;
  memo: string;
  lines: JournalLine[];
  metadata: {
    chain: ChainId;
    txHash: string;
    wallet: string;
    transactionType: TransactionType;
    protocol?: string;
  };
}

export interface JournalLine {
  accountCode: string;
  accountName: string;
  side: JournalSide;
  amount: string; // decimal string USD
  tokenAmount?: string; // original token quantity
  tokenSymbol?: string;
}

// Human override for low-confidence or incorrect classifications
export interface HumanOverride {
  transactionId: string;
  previousType: TransactionType;
  newType: TransactionType;
  reason: string;
  overriddenBy: string;
  timestamp: number;
}

// Reconciliation report
export interface ReconciliationReport {
  timestamp: number;
  wallet: string;
  chain: ChainId;
  ledgerBalance: Record<string, string>; // token → decimal string balance
  onChainBalance: Record<string, string>;
  discrepancies: Discrepancy[];
  bridgeLegsMatched: number;
  bridgeLegsUnmatched: number;
  rebasingAdjustments: RebasingAdjustment[];
  status: ReconciliationStatus;
  summary: string;
}

export interface Discrepancy {
  token: string;
  ledgerBalance: string;
  onChainBalance: string;
  differenceUsd: string;
  status: ReconciliationStatus;
  notes: string;
}

export interface RebasingAdjustment {
  token: string;
  previousBalance: string;
  currentBalance: string;
  delta: string;
  deltaUsd: string;
  syntheticTxId: string; // generated yield_claim transaction id
}
