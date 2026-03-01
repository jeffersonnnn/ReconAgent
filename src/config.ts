import { ChainId } from "./interfaces/common.js";
import type { ReconAgentInput, AccountingConfig, ReconciliationConfig, WalletConfig } from "./interfaces/input.js";

export interface ReconAgentConfig {
  // RPC endpoints
  alchemy: {
    apiKey: string;
    urls: Partial<Record<ChainId, string>>;
  };
  helius: {
    apiKey: string;
    rpcUrl: string;
  };

  // Pricing
  coingeckoApiKey?: string;

  // Storage
  sqlitePath: string;

  // Agent
  pollIntervalMs: number;
  logLevel: string;

  // Delivery
  slackWebhookUrl?: string;

  // Recon input (wallets, rules, accounting config)
  input: ReconAgentInput;
}

const DEFAULT_ACCOUNTING_CONFIG: AccountingConfig = {
  baseCurrency: "USD",
  bridgeTreatment: "transfer",
  stakingIncomeTreatment: "other_income",
  gasTreatment: "capitalize_on_acquisition",
  costBasisMethod: "fifo",
  dustThresholdUsd: "0.01",
};

const DEFAULT_RECONCILIATION_CONFIG: ReconciliationConfig = {
  dustThresholdUsd: "0.01",
  bridgeMatchWindowSeconds: 3600, // 1 hour
  rebasingTokens: [],
  balanceSnapshotIntervalMs: 300_000, // 5 minutes
};

export function loadConfig(): ReconAgentConfig {
  const env = process.env;

  return {
    alchemy: {
      apiKey: env.ALCHEMY_API_KEY ?? "",
      urls: {
        ethereum: env.ALCHEMY_ETHEREUM_URL ? `${env.ALCHEMY_ETHEREUM_URL}${env.ALCHEMY_API_KEY ?? ""}` : undefined,
        arbitrum: env.ALCHEMY_ARBITRUM_URL ? `${env.ALCHEMY_ARBITRUM_URL}${env.ALCHEMY_API_KEY ?? ""}` : undefined,
        optimism: env.ALCHEMY_OPTIMISM_URL ? `${env.ALCHEMY_OPTIMISM_URL}${env.ALCHEMY_API_KEY ?? ""}` : undefined,
        base: env.ALCHEMY_BASE_URL ? `${env.ALCHEMY_BASE_URL}${env.ALCHEMY_API_KEY ?? ""}` : undefined,
        polygon: env.ALCHEMY_POLYGON_URL ? `${env.ALCHEMY_POLYGON_URL}${env.ALCHEMY_API_KEY ?? ""}` : undefined,
      },
    },
    helius: {
      apiKey: env.HELIUS_API_KEY ?? "",
      rpcUrl: env.HELIUS_RPC_URL ?? "",
    },
    coingeckoApiKey: env.COINGECKO_API_KEY,
    sqlitePath: env.SQLITE_PATH ?? "./recon-agent.db",
    pollIntervalMs: parseInt(env.POLL_INTERVAL_MS ?? "60000", 10),
    logLevel: env.LOG_LEVEL ?? "info",
    slackWebhookUrl: env.SLACK_WEBHOOK_URL,
    input: {
      wallets: parseWallets(env.RECON_WALLETS),
      chains: [],
      classificationRules: [],
      accountingConfig: DEFAULT_ACCOUNTING_CONFIG,
      deliveryConfig: {},
      reconciliationConfig: DEFAULT_RECONCILIATION_CONFIG,
    },
  };
}

// Parse RECON_WALLETS env var: "address:chain:label,address:chain:label,..."
function parseWallets(raw?: string): WalletConfig[] {
  if (!raw) return [];
  return raw.split(",").map((entry) => {
    const [address, chain, ...labelParts] = entry.trim().split(":");
    return {
      address: address.trim(),
      chain: (chain?.trim() ?? "ethereum") as ChainId,
      label: labelParts.join(":").trim() || address.slice(0, 10),
    };
  }).filter((w) => w.address.length > 0);
}

export const MODEL_VERSION = "recon-agent-v1.0.0";
