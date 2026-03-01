import type { ChainId, TransactionType, Confidence } from "./common.js";

// Top-level configuration for a recon run
export interface ReconAgentInput {
  wallets: WalletConfig[];
  chains: ChainId[];
  classificationRules: ClassificationRule[];
  accountingConfig: AccountingConfig;
  deliveryConfig: DeliveryConfig;
  reconciliationConfig: ReconciliationConfig;
}

// Wallet to monitor
export interface WalletConfig {
  address: string;
  chain: ChainId;
  label: string;
  entity?: string; // legal entity name for multi-entity orgs
  costBasisMethod?: "fifo" | "specific_id";
}

// User-defined classification rule (highest priority)
export interface ClassificationRule {
  id: string;
  name: string;
  priority: number; // lower = higher priority
  conditions: RuleCondition[];
  classification: TransactionType;
  confidence: Confidence;
}

export interface RuleCondition {
  field: "to" | "from" | "contract" | "method_id" | "chain" | "token_symbol" | "value_gte" | "value_lte";
  operator: "eq" | "neq" | "contains" | "in" | "gte" | "lte";
  value: string | string[];
}

// Accounting configuration
export interface AccountingConfig {
  baseCurrency: string; // "USD"
  bridgeTreatment: "transfer" | "disposal_acquisition";
  stakingIncomeTreatment: "revenue" | "other_income";
  gasTreatment: "capitalize_on_acquisition" | "always_expense";
  costBasisMethod: "fifo" | "specific_id";
  dustThresholdUsd: string; // decimal string, e.g. "0.01"
  chartOfAccountsOverrides?: Record<string, string>;
}

// Delivery configuration
export interface DeliveryConfig {
  slack?: {
    webhookUrl: string;
    channels: {
      anomalies?: boolean;
      dailyDigest?: boolean;
      reconciliation?: boolean;
    };
  };
}

// Reconciliation configuration
export interface ReconciliationConfig {
  dustThresholdUsd: string;
  bridgeMatchWindowSeconds: number; // time window for bridge leg correlation
  rebasingTokens: string[]; // addresses of rebasing tokens to track
  balanceSnapshotIntervalMs: number;
}
