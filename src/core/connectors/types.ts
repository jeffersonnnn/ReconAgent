import type { ChainId, TokenAmount } from "../../interfaces/common.js";

// Chain-agnostic normalized transaction form
export interface RawTransaction {
  chain: ChainId;
  txHash: string;
  blockNumber: number;
  blockTimestamp: number; // unix seconds
  from: string;
  to: string;
  value: string; // native token value in decimal string
  gasUsed: string;
  gasPrice: string;
  gasFeeNative: string; // decimal string
  success: boolean;
  methodId?: string; // first 4 bytes of calldata
  methodName?: string; // decoded if ABI available
  contractAddress?: string; // if contract interaction
  tokenTransfers: TokenTransfer[];
  internalTransactions: InternalTransaction[];
  logs: DecodedLog[];
  rawData: Record<string, unknown>;
}

export interface TokenTransfer {
  token: TokenAmount["token"];
  from: string;
  to: string;
  amount: string; // decimal string
  rawAmount: string;
  logIndex: number;
}

export interface InternalTransaction {
  from: string;
  to: string;
  value: string; // decimal string native token
  type: "call" | "create" | "delegatecall" | "staticcall";
}

export interface DecodedLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
  eventName?: string;
  decodedArgs?: Record<string, unknown>;
}

// Connector interface — one per chain family
export interface ChainConnector {
  chain: ChainId;
  fetchTransactions(wallet: string, opts: FetchOptions): Promise<RawTransaction[]>;
  getBalance(wallet: string, tokenAddress: string): Promise<string>; // decimal string
  getCurrentBlock(): Promise<number>;
}

export interface FetchOptions {
  fromBlock?: number;
  toBlock?: number;
  fromSignature?: string; // Solana
  limit?: number;
}
