import type { ChainId } from "./common.js";

// Persisted state for resumable processing
export interface ReconState {
  walletStates: WalletChainState[];
  lastRunTimestamp: number;
  lastReconciliationTimestamp: number;
  version: string;
}

export interface WalletChainState {
  wallet: string;
  chain: ChainId;
  lastProcessedBlock: number;
  lastProcessedTimestamp: number;
  lastProcessedSignature?: string; // Solana-specific
  transactionCount: number;
  errorCount: number;
  lastError?: string;
}
