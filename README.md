# ReconAgent

Multi-chain DeFi reconciliation engine that watches blockchain wallets, classifies every transaction, generates double-entry journal entries (GAAP/IFRS), tracks per-wallet cost basis (FIFO), and produces audit-ready reconciliation reports.

Built with Bun + TypeScript. No build step.

---

## Why This Exists

Crypto reconciliation is broken. A single DeFi swap generates 3+ on-chain events. Each blockchain expresses metadata differently. Mapping transactions to general ledger accounts is manual and takes weeks per audit cycle. 94% of crypto finance teams still use Excel for month-end close.

Fireblocks paid $130M to acquire TRES Finance just to solve this problem. ReconAgent is an open-source engine that does it for the cost of an Alchemy API key.

ReconAgent is the core backend engine for **TreasuryOS** - an AI-native treasury control plane for crypto-native enterprises. The frontend (dashboard, alerts, weekly briefings) is being built on top of this engine. See [HANDOFF.md](./HANDOFF.md) for the full roadmap.

---

## What It Does

```
Wallet Addresses ──> Fetch Transactions ──> Classify ──> Price ──> Journal Entry ──> Cost Basis ──> Store
                          |                     |           |           |                |             |
                     EVM + Solana         3-tier engine  4-tier     Double-entry      FIFO lots     SQLite
                     (Alchemy/Helius)     (protocol +   waterfall  (GAAP/IFRS)      (per-wallet)   (WAL mode)
                                          heuristic)
                                                                        |
                                                              Reconciliation Engine
                                                              (3-way match + bridge + rebasing)
                                                                        |
                                                                Slack / CLI / Export
                                                              (Xero, QuickBooks, NetSuite)
```

**Chains supported:** Ethereum, Arbitrum, Optimism, Base, Polygon, Solana

**Protocols classified:** Uniswap V2/V3, Aave V3, Lido, Curve, Jupiter, Marinade, Raydium, Orca + heuristic fallback for unknown protocols

**24 transaction types recognized:** swap, lp_add, lp_remove, lend, borrow, repay, withdraw_collateral, stake, unstake, claim_reward, bridge_out, bridge_in, transfer_in, transfer_out, gas, wrap, unwrap, governance_vote, governance_delegate, airdrop, contract_deploy, approval, yield_claim, unknown

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- [Alchemy](https://www.alchemy.com/) API key (free tier works) for EVM chains
- [Helius](https://helius.dev/) API key (free tier works) for Solana

### Setup

```bash
# Clone
git clone https://github.com/jeffersonnnn/ReconAgent.git
cd ReconAgent

# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env and add your API keys

# Verify setup
bun run src/index.ts --mode=status
```

### Configure Wallets

Set `RECON_WALLETS` in your `.env` file as a comma-separated list:

```
RECON_WALLETS=0xYourAddress:ethereum:main-wallet,0xAnotherAddress:arbitrum:arb-treasury,SolanaPublicKey:solana:sol-wallet
```

Format: `address:chain:label` where chain is one of `ethereum`, `arbitrum`, `optimism`, `base`, `polygon`, `solana`.

---

## Usage

ReconAgent runs in 6 modes via the `--mode` flag:

### Check wallet status

```bash
bun run src/index.ts --mode=status
```

Shows last processed block, transaction count, and error count per wallet.

### Backfill historical transactions

```bash
# From a specific date
bun run src/index.ts --mode=backfill --from=2025-01-01

# From a specific block number
bun run src/index.ts --mode=backfill --from=19000000

# Filter to specific chain/wallet
bun run src/index.ts --mode=backfill --from=2025-01-01 --chain=ethereum --wallet=0xYourAddress
```

Processes all historical transactions, classifies them, generates journal entries, and tracks cost basis.

### Continuous monitoring

```bash
bun run src/index.ts --mode=recon
```

Polls for new transactions every 60 seconds (configurable via `POLL_INTERVAL_MS`). Handles SIGINT/SIGTERM gracefully.

### Run reconciliation

```bash
# All wallets
bun run src/index.ts --mode=reconcile

# Specific wallet
bun run src/index.ts --mode=reconcile --wallet=0xYourAddress --chain=ethereum
```

Performs three-way reconciliation (ledger balance vs on-chain balance), matches bridge legs across chains, and checks rebasing token adjustments.

### Export journal entries

```bash
# Xero CSV
bun run src/index.ts --mode=export --format=xero --output=./export.csv

# QuickBooks JSON
bun run src/index.ts --mode=export --format=quickbooks --output=./export.json

# NetSuite CSV
bun run src/index.ts --mode=export --format=netsuite --output=./export.csv

# Universal CSV (default)
bun run src/index.ts --mode=export --from=2025-01-01 --to=2025-12-31
```

### Override a classification

```bash
bun run src/index.ts --mode=override --tx=ethereum:0xabc123:0 --type=transfer_out --reason="manual correction: this was a payment, not a swap"
```

Overrides are stored in the audit log. The original classification is preserved.

---

## Architecture

```
src/
  index.ts                     Entry point - dispatches by --mode
  config.ts                    Env vars, defaults, wallet parsing
  logger.ts                    Pino structured logger

  interfaces/
    common.ts                  Enums + base types (ChainId, TransactionType, TokenCategory, etc.)
    input.ts                   Config types (WalletConfig, AccountingConfig, ClassificationRule)
    output.ts                  Output types (ClassifiedTransaction, JournalEntry, ReconciliationReport)
    state.ts                   Persistent state (WalletChainState)

  core/
    pipeline.ts                Main orchestrator: fetch > classify > price > journal > cost-basis > store

    connectors/
      types.ts                 ChainConnector interface + RawTransaction type
      evm.ts                   EVM connector (viem + Alchemy getAssetTransfers)
      solana.ts                Solana connector (@solana/web3.js + Helius parseTransactions)
      evm-enricher.ts          Protocol detection via method IDs + contract addresses

    classifiers/
      engine.ts                3-tier classification dispatcher
      protocols/index.ts       Protocol-specific patterns (Uniswap, Aave, Lido, Curve, Jupiter, etc.)
      rules/index.ts           Heuristic fallback rules (token flow pattern matching)

    pricing/
      service.ts               6-tier pricing waterfall
      defillama.ts             DeFi Llama adapter (primary, free, no key needed)
      coingecko.ts             CoinGecko adapter (fallback)
      onchain.ts               On-chain exchange rates for receipt tokens (wstETH, rETH)
      cache.ts                 Price cache (5-min buckets)

    formatters/
      journal.ts               Double-entry journal generator for all 24 tx types
      chart-of-accounts.ts     Default chart of accounts
      adapters/
        canonical.ts           Universal CSV
        xero.ts                Xero Manual Journal CSV
        quickbooks.ts          QuickBooks Journal Entry JSON
        netsuite.ts            NetSuite import CSV

    cost-basis/
      engine.ts                FIFO lot creation + consumption
      lot-tracker.ts           Open lot summary
      gain-loss.ts             Short/long term gain/loss calculator

    reconciliation/
      engine.ts                Orchestrates all 3 reconciliation methods
      three-way.ts             Ledger balance vs on-chain balance
      bridge-matcher.ts        Pairs outbound + inbound bridge legs across chains
      rebasing.ts              Detects stETH/aToken balance changes

  storage/
    adapter.ts                 StorageAdapter interface (swap SQLite for Postgres here)
    sqlite.ts                  Full SQLite implementation (bun:sqlite, WAL mode)
    migrations/001_init.sql    Database schema

  delivery/
    cli.ts                     CLI argument parsing
    slack.ts                   Slack webhook delivery (reconciliation reports, anomalies)

  events/
    emitter.ts                 Typed event bus
    types.ts                   Event types (transaction_classified, anomaly_detected, etc.)
```

---

## How Classification Works

ReconAgent classifies transactions using a 3-tier priority system. Each classification includes an audit trail with the method used, confidence level, and rationale.

**Tier 1 - User rules (highest priority)**
Custom rules you define in config. Matched by contract address, method ID, token, or chain. If a user rule matches, it wins.

**Tier 2 - Protocol patterns**
Hardcoded patterns for known DeFi protocols. Matches by contract address + method ID (first 4 bytes of calldata). Covers Uniswap V2/V3 (swap, add/remove liquidity), Aave V3 (supply, withdraw, borrow, repay), Lido (submit, wrap, unwrap), Curve, Jupiter, Marinade, Raydium, Orca, and known bridge contracts.

**Tier 3 - Heuristic rules (fallback)**
When no protocol is recognized, ReconAgent infers the type from token flow patterns:
- Tokens in AND out = SWAP
- Tokens in only = TRANSFER_IN or CLAIM_REWARD
- Tokens out only = TRANSFER_OUT
- Failed tx = GAS
- Approval call = APPROVAL
- WETH deposit/withdraw = WRAP/UNWRAP

If nothing matches, the transaction is classified as UNKNOWN with LOW confidence.

---

## How Pricing Works

6-tier waterfall, evaluated in order:

1. **Stablecoin detection** - USDC, USDT, DAI, etc. are priced at $1.00 (with 2% de-peg check)
2. **Cache lookup** - checks price cache (5-minute buckets)
3. **Receipt tokens** - queries on-chain exchange rate (wstETH.stEthPerToken(), rETH.getExchangeRate()) and multiplies by underlying price
4. **DeFi Llama** - primary source, free, no API key needed
5. **CoinGecko** - fallback, optional API key ($129/mo for Pro)
6. **No price found** - returns $0 with LOW confidence, emits price_missing event

---

## How Journal Entries Work

Every classified transaction generates a double-entry journal entry where debits = credits. The generator handles all 24 transaction types with proper accounting treatment:

- **Swaps**: debit asset received, credit asset sent, gas line, gain/loss balancing
- **Transfers in**: debit crypto asset (1000), credit external source
- **Staking**: credit staked-out asset, debit staked asset account (1020)
- **Rewards**: debit asset received, credit revenue (4000) or other income (7000)
- **Bridge out**: transfer treatment (1060 in-transit) or disposal treatment (5000 gain/loss)
- **Gas**: capitalized into cost basis if tx is an acquisition, otherwise expensed to 6000

Every journal entry is validated: if debits != credits (beyond $0.01 tolerance), it throws an error.

### Chart of Accounts

```
1000  Crypto Assets          1020  Staked Assets         1060  Assets in Transit
1010  Stablecoin Holdings    1030  LP Positions          1100  Lending Deposits
2000  DeFi Borrowing         4000  Staking Revenue       4030  Airdrop Income
5000  Realized Gain          5010  Realized Loss         6000  Gas/Network Fees
7000  Other Income                                       7010  Other Income - Yield
```

Override any account code via `chartOfAccountsOverrides` in your accounting config.

---

## How Cost Basis Works

FIFO (First In, First Out) lot tracking per wallet, per token, per chain.

**Acquisitions** (create lots): swap-in, transfer_in, claim_reward, airdrop, bridge_in, unstake, withdraw_collateral, lp_remove, unwrap, yield_claim

**Disposals** (consume lots): swap-out, transfer_out, bridge_out, stake, lend, repay, lp_add, wrap

Gas is capitalized into the cost basis of acquired tokens when the transaction is an acquisition (tokens received). Otherwise it's expensed.

Gain/loss is calculated per lot consumed: `proceeds - costBasis`. Holding period determines short-term (<1 year) vs long-term classification for tax purposes. Compliant with IRS Revenue Procedure 2024-28 for per-wallet tracking.

---

## How Reconciliation Works

Three independent checks run per wallet:

**1. Three-way match**
Computes expected balance from stored transactions (tokens in - tokens out - gas), fetches actual on-chain balance, compares. Discrepancies above the dust threshold ($0.01 default) are flagged.

**2. Bridge leg matching**
Pairs outbound bridge transactions with inbound legs across chains. Matching criteria: same token symbol, same wallet, amount within 5%, within time window (1 hour default), same bridge protocol. Unmatched legs are flagged.

**3. Rebasing token check**
For tokens like stETH and aTokens that change balance without transactions, compares current balance to last snapshot. Detects yield accrual and creates synthetic adjustment records.

---

## Environment Variables

```bash
# Required for EVM chains
ALCHEMY_API_KEY=your_key_here

# Required for Solana
HELIUS_API_KEY=your_key_here

# Optional - fallback pricing
COINGECKO_API_KEY=

# Optional - Slack alerts
SLACK_WEBHOOK_URL=

# Wallets to monitor (required)
RECON_WALLETS=0xAddr:ethereum:label,0xAddr2:arbitrum:label2

# Storage
SQLITE_PATH=./recon-agent.db

# Agent behavior
POLL_INTERVAL_MS=60000
LOG_LEVEL=info
```

See [.env.example](./.env.example) for the full template.

---

## Key Design Decisions

**Decimal strings for all money.** Every monetary value (token amounts, USD prices, cost basis, journal lines) is a string like `"1500.00"`, never a JavaScript `number`. This prevents floating-point precision errors in accounting. Parse only at display time.

**Append-only audit log.** Database triggers prevent UPDATE and DELETE on the audit_log table. Every classification, override, lot disposal, and reconciliation is logged permanently with model version, timestamp, and full context.

**StorageAdapter interface.** All database access goes through a clean interface (`storage/adapter.ts`). The current implementation is SQLite. Swapping to Postgres means implementing the same methods against pg - no other code changes needed.

**Event-driven extensibility.** The pipeline emits typed events (transaction_classified, anomaly_detected, reconciliation_complete, etc.) through a local event bus. Currently wired to Slack delivery. Designed to route to a platform-wide event bus when integrated into TreasuryOS.

---

## Database

SQLite with WAL mode (concurrent reads, single writer). Schema defined in `src/storage/migrations/001_init.sql`.

**Core tables:**

| Table | Purpose |
|---|---|
| `transactions` | Classified transactions with tokens_in/out, gas, classification audit |
| `journal_entries` | Double-entry journal entries with lines (JSON) |
| `tax_lots` | FIFO cost basis lots (per wallet, per token) |
| `bridge_legs` | Cross-chain bridge leg tracking for matching |
| `audit_log` | Immutable event log (append-only, no UPDATE/DELETE) |
| `balance_snapshots` | Point-in-time balances for rebasing token tracking |
| `reconciliation_reports` | Reconciliation results per wallet per run |
| `wallet_states` | Processing state (last block, tx count, errors) |
| `price_cache` | 5-min bucketed price cache |
| `human_overrides` | Manual classification corrections |

---

## Scripts

```bash
bun run start        # Run (requires --mode flag)
bun run dev          # Watch mode
bun run typecheck    # Type check only (no emit)
bun test             # Run tests (test suite not yet written)
```

---

## What's Built vs What's Needed

See [HANDOFF.md](./HANDOFF.md) for the complete engineer handoff document with prioritized build phases, known limitations, edge cases, and the full TreasuryOS roadmap.

**Working now:**
- Multi-chain tx fetching (5 EVM + Solana)
- 3-tier classification with protocol patterns
- 4-tier pricing waterfall
- Double-entry journal generation (17+ tx types)
- FIFO cost basis with gain/loss
- Three-way reconciliation + bridge matching + rebasing
- Export to Xero, QuickBooks, NetSuite, canonical CSV
- Slack delivery + CLI
- Append-only audit trail

**Next up:**
- Web dashboard (unified treasury view)
- Weekly AI Treasury Briefing
- Risk concentration alerts
- More protocol coverage (Compound, Balancer, Morpho, Pendle, EigenLayer)
- Specific ID cost basis method
- Postgres adapter for multi-user
- Role-based access control

---

## Related Docs

- [HANDOFF.md](./HANDOFF.md) - Full engineer handoff with architecture details, build phases, and known limitations
- [RESEARCH.md](./RESEARCH.md) - Research synthesis on the reconciliation problem space
- [SKILL.md](./SKILL.md) - TreasuryOS skill definition for agent integration
- [CLAUDE.md](./CLAUDE.md) - AI assistant context file

---

## License

Proprietary. All rights reserved.
