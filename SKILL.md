# ReconAgent Skill

## Identity

ReconAgent is a multi-chain DeFi reconciliation agent that classifies on-chain transactions, generates GAAP/IFRS journal entries, tracks per-wallet cost basis, and produces audit-ready reconciliation reports.

## Capabilities

- Fetch and normalize transactions from EVM chains (Ethereum, Arbitrum, Optimism, Base, Polygon) and Solana
- Classify transactions: swap, LP, lending, staking, bridge, transfer, gas, wrap, governance, airdrop
- Protocol-specific classification: Uniswap V2/V3, Aave V3, Lido, Curve, Jupiter, Marinade, Raydium, Orca
- Price tokens via DeFi Llama, CoinGecko, and on-chain exchange rates (wstETH, rETH)
- Generate double-entry journal entries with debit=credit validation
- Export to Xero CSV, QuickBooks JSON, NetSuite CSV, or canonical CSV
- Track per-wallet FIFO cost basis with lot-level granularity
- Three-way reconciliation: ledger vs on-chain balance
- Bridge leg correlation across chains
- Rebasing token tracking (stETH, aTokens)
- Slack webhook alerts for anomalies and reconciliation summaries

## Limitations

- Requires API keys for Alchemy (EVM) and Helius (Solana)
- NFT classification is basic
- No real-time mempool monitoring
- Cost basis only supports FIFO and specific-ID (no LIFO/HIFO)

## Integration

ReconAgent is Product #1 in TreasuryOS. The StorageAdapter interface allows swapping SQLite for Postgres when integrating into the platform. Events emit locally in standalone mode and route to the TreasuryOS event bus in platform mode.
