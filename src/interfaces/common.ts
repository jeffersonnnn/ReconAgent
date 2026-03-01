// Chain identifiers
export enum ChainId {
  ETHEREUM = "ethereum",
  ARBITRUM = "arbitrum",
  OPTIMISM = "optimism",
  BASE = "base",
  POLYGON = "polygon",
  SOLANA = "solana",
}

// Transaction classification types
export enum TransactionType {
  SWAP = "swap",
  LP_ADD = "lp_add",
  LP_REMOVE = "lp_remove",
  LEND = "lend",
  BORROW = "borrow",
  REPAY = "repay",
  WITHDRAW_COLLATERAL = "withdraw_collateral",
  STAKE = "stake",
  UNSTAKE = "unstake",
  CLAIM_REWARD = "claim_reward",
  BRIDGE_OUT = "bridge_out",
  BRIDGE_IN = "bridge_in",
  TRANSFER_IN = "transfer_in",
  TRANSFER_OUT = "transfer_out",
  GAS = "gas",
  WRAP = "wrap",
  UNWRAP = "unwrap",
  GOVERNANCE_VOTE = "governance_vote",
  GOVERNANCE_DELEGATE = "governance_delegate",
  AIRDROP = "airdrop",
  CONTRACT_DEPLOY = "contract_deploy",
  APPROVAL = "approval",
  YIELD_CLAIM = "yield_claim",
  UNKNOWN = "unknown",
}

// Token categories for accounting treatment
export enum TokenCategory {
  NATIVE = "native",
  STABLECOIN = "stablecoin",
  ERC20 = "erc20",
  RECEIPT_TOKEN = "receipt_token", // wstETH, cTokens, aTokens, rETH
  LP_TOKEN = "lp_token",
  NFT = "nft",
  WRAPPED_NATIVE = "wrapped_native",
  GOVERNANCE = "governance",
  SPL_TOKEN = "spl_token",
}

// Confidence levels for classification
export enum Confidence {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
}

// Accounting method for cost basis
export enum CostBasisMethod {
  FIFO = "fifo",
  SPECIFIC_ID = "specific_id",
}

// Journal entry side
export enum JournalSide {
  DEBIT = "debit",
  CREDIT = "credit",
}

// Price source attribution
export enum PriceSource {
  DEFILLAMA = "defillama",
  COINGECKO = "coingecko",
  ONCHAIN_EXCHANGE_RATE = "onchain_exchange_rate",
  STABLECOIN_PEG = "stablecoin_peg",
  CACHE = "cache",
  MANUAL = "manual",
}

// Reconciliation status
export enum ReconciliationStatus {
  MATCHED = "matched",
  UNMATCHED = "unmatched",
  FLAGGED = "flagged",
  DUST = "dust",
}

// Export formats
export enum ExportFormat {
  CANONICAL_CSV = "canonical",
  XERO_CSV = "xero",
  QUICKBOOKS_JSON = "quickbooks",
  NETSUITE_CSV = "netsuite",
}

// Token info
export interface TokenInfo {
  address: string; // "native" for chain native tokens
  symbol: string;
  decimals: number;
  category: TokenCategory;
  chain: ChainId;
  coingeckoId?: string;
  defillamaId?: string; // "chain:address" format
}

// Token amount — always decimal strings, never floats
export interface TokenAmount {
  token: TokenInfo;
  amount: string; // decimal string, e.g. "1.500000000000000000"
  rawAmount: string; // raw integer string before decimal conversion
}

// Price point
export interface PricePoint {
  usdPrice: string; // decimal string
  timestamp: number; // unix seconds
  source: PriceSource;
  confidence: Confidence;
}
