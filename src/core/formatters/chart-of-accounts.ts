// Default chart of accounts for crypto/DeFi entities
// 1000-series: Assets
// 2000-series: Liabilities
// 3000-series: Equity
// 4000-series: Revenue
// 5000-series: Cost of Revenue
// 6000-series: Operating Expenses
// 7000-series: Other Income/Expense

export interface Account {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
}

export const DEFAULT_CHART: Record<string, Account> = {
  // Assets
  "1000": { code: "1000", name: "Digital Assets — Crypto Holdings", type: "asset" },
  "1010": { code: "1010", name: "Digital Assets — Stablecoins", type: "asset" },
  "1020": { code: "1020", name: "Digital Assets — Staked Assets", type: "asset" },
  "1030": { code: "1030", name: "Digital Assets — LP Tokens", type: "asset" },
  "1040": { code: "1040", name: "Digital Assets — Receipt Tokens", type: "asset" },
  "1050": { code: "1050", name: "Digital Assets — Wrapped Tokens", type: "asset" },
  "1060": { code: "1060", name: "Digital Assets — In Transit (Bridge)", type: "asset" },
  "1100": { code: "1100", name: "Lending Deposits", type: "asset" },
  "1200": { code: "1200", name: "Accounts Receivable — Rewards", type: "asset" },

  // Liabilities
  "2000": { code: "2000", name: "DeFi Borrowings", type: "liability" },
  "2100": { code: "2100", name: "Accrued Interest Payable", type: "liability" },

  // Revenue
  "4000": { code: "4000", name: "Staking Revenue", type: "revenue" },
  "4010": { code: "4010", name: "Lending Interest Revenue", type: "revenue" },
  "4020": { code: "4020", name: "LP Fee Revenue", type: "revenue" },
  "4030": { code: "4030", name: "Airdrop Revenue", type: "revenue" },
  "4040": { code: "4040", name: "Governance Rewards", type: "revenue" },

  // Gains/Losses
  "5000": { code: "5000", name: "Realized Gain on Digital Assets", type: "revenue" },
  "5010": { code: "5010", name: "Realized Loss on Digital Assets", type: "expense" },
  "5020": { code: "5020", name: "Impairment Loss on Digital Assets", type: "expense" },

  // Expenses
  "6000": { code: "6000", name: "Gas Fees — Network Transaction Costs", type: "expense" },
  "6010": { code: "6010", name: "Trading Fees", type: "expense" },
  "6020": { code: "6020", name: "Protocol Fees", type: "expense" },

  // Other
  "7000": { code: "7000", name: "Other Income — Staking", type: "revenue" },
  "7010": { code: "7010", name: "Other Income — Yield", type: "revenue" },
  "7020": { code: "7020", name: "Other Expense", type: "expense" },
};

export function getAccount(code: string, overrides?: Record<string, string>): Account {
  if (overrides?.[code]) {
    return { code, name: overrides[code], type: DEFAULT_CHART[code]?.type ?? "asset" };
  }
  return DEFAULT_CHART[code] ?? { code, name: `Unknown Account ${code}`, type: "asset" };
}
