import type { ChainId, CostBasisMethod } from "../interfaces/common.js";
import type { ClassifiedTransaction, JournalEntry, ReconciliationReport, HumanOverride } from "../interfaces/output.js";
import type { WalletChainState } from "../interfaces/state.js";

// Tax lot for cost basis tracking
export interface TaxLot {
  id: string;
  wallet: string;
  chain: ChainId;
  tokenAddress: string;
  tokenSymbol: string;
  acquiredAt: number; // unix seconds
  acquiredTxId: string;
  originalAmount: string; // decimal string
  remainingAmount: string; // decimal string
  costBasisUsd: string; // decimal string, total cost basis for this lot
  costBasisPerUnit: string; // decimal string
  method: CostBasisMethod;
  closed: boolean;
  closedAt?: number;
  closedTxId?: string;
}

// Bridge leg for cross-chain correlation
export interface BridgeLeg {
  id: string;
  direction: "outbound" | "inbound";
  chain: ChainId;
  txHash: string;
  wallet: string;
  tokenSymbol: string;
  amount: string;
  protocol: string;
  timestamp: number;
  matchedLegId?: string;
  matched: boolean;
}

// Immutable audit log entry
export interface AuditLogEntry {
  id: string;
  timestamp: number;
  eventType: string;
  transactionId?: string;
  wallet?: string;
  chain?: ChainId;
  details: Record<string, unknown>;
  modelVersion: string;
}

// Balance snapshot for reconciliation
export interface BalanceSnapshot {
  id: string;
  wallet: string;
  chain: ChainId;
  tokenAddress: string;
  tokenSymbol: string;
  balance: string; // decimal string
  balanceUsd: string;
  timestamp: number;
  source: "onchain" | "ledger";
}

// Storage adapter interface — SQLite now, Postgres later
export interface StorageAdapter {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Transactions
  saveTransaction(tx: ClassifiedTransaction): Promise<void>;
  getTransaction(id: string): Promise<ClassifiedTransaction | null>;
  getTransactionsByWallet(wallet: string, chain: ChainId, opts?: { from?: number; to?: number; limit?: number }): Promise<ClassifiedTransaction[]>;
  transactionExists(id: string): Promise<boolean>;

  // Journal entries
  saveJournalEntry(entry: JournalEntry): Promise<void>;
  getJournalEntries(opts: { wallet?: string; from?: number; to?: number; chain?: ChainId }): Promise<JournalEntry[]>;

  // Tax lots
  saveTaxLot(lot: TaxLot): Promise<void>;
  updateTaxLot(id: string, updates: Partial<Pick<TaxLot, "remainingAmount" | "closed" | "closedAt" | "closedTxId">>): Promise<void>;
  getOpenLots(wallet: string, tokenAddress: string, chain: ChainId): Promise<TaxLot[]>;
  getLotById(id: string): Promise<TaxLot | null>;

  // Bridge legs
  saveBridgeLeg(leg: BridgeLeg): Promise<void>;
  getUnmatchedBridgeLegs(wallet: string, opts?: { protocol?: string; within?: number }): Promise<BridgeLeg[]>;
  matchBridgeLegs(outboundId: string, inboundId: string): Promise<void>;

  // Audit log (append-only — no update/delete)
  appendAuditLog(entry: AuditLogEntry): Promise<void>;
  getAuditLog(opts: { transactionId?: string; wallet?: string; eventType?: string; from?: number; to?: number }): Promise<AuditLogEntry[]>;

  // Balance snapshots
  saveBalanceSnapshot(snapshot: BalanceSnapshot): Promise<void>;
  getLatestSnapshot(wallet: string, chain: ChainId, tokenAddress: string): Promise<BalanceSnapshot | null>;

  // Reconciliation reports
  saveReconciliationReport(report: ReconciliationReport): Promise<void>;
  getLatestReconciliationReport(wallet: string, chain: ChainId): Promise<ReconciliationReport | null>;

  // State
  saveWalletState(state: WalletChainState): Promise<void>;
  getWalletState(wallet: string, chain: ChainId): Promise<WalletChainState | null>;
  getAllWalletStates(): Promise<WalletChainState[]>;

  // Price cache
  cachePrice(chain: ChainId, tokenAddress: string, timestamp: number, priceUsd: string, source: string): Promise<void>;
  getCachedPrice(chain: ChainId, tokenAddress: string, timestamp: number, bucketSeconds?: number): Promise<{ priceUsd: string; source: string } | null>;

  // Human overrides
  saveOverride(override: HumanOverride): Promise<void>;
  getOverrides(transactionId: string): Promise<HumanOverride[]>;
}
