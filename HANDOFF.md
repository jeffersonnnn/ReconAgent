# ReconAgent - Engineer Handoff Document

**Last updated:** March 2026
**Version:** 1.0.0
**Runtime:** Bun + TypeScript (no build step)
**Database:** SQLite (WAL mode), swappable to Postgres via StorageAdapter interface

---

## What Is ReconAgent

ReconAgent is a multi-chain DeFi reconciliation agent. It watches blockchain wallets, classifies every transaction, prices assets, generates double-entry journal entries (GAAP/IFRS), tracks per-wallet cost basis (FIFO), and produces audit-ready reconciliation reports.

It is **Product #1** of a larger platform called **TreasuryOS** - an AI-native treasury control plane for crypto-native enterprises. ReconAgent is the backend engine. The frontend (dashboard, alerts, weekly briefings) has not been built yet.

**Core promise:** "Know exactly where your money is, what risk you're exposed to, and what to do next - automatically."

---

## Quick Start

```bash
# Install
bun install

# Copy env and fill in API keys
cp .env.example .env

# Type check
bun run typecheck

# Run
bun run src/index.ts --mode=status
bun run src/index.ts --mode=backfill --from=2026-01-01
bun run src/index.ts --mode=recon
bun run src/index.ts --mode=reconcile
bun run src/index.ts --mode=export --format=xero --output=./export.csv
bun run src/index.ts --mode=override --tx=ethereum:0xabc:0 --type=transfer_out --reason="manual correction"
```

---

## Architecture Overview

```
                    CLI / Slack
                        |
                    index.ts (entry point, 6 modes)
                        |
                  ReconPipeline
                        |
    fetch -> classify -> price -> journal -> cost-basis -> store
      |          |         |         |            |           |
  connectors  classifiers pricing  formatters  cost-basis  storage
  (EVM+Sol)   (3-tier)   (4-tier) (journal+   (FIFO lots) (SQLite)
                                   exports)
                        |
                  reconciliation
                  (3-way match + bridge + rebasing)
                        |
                    events/emitter
                        |
                  delivery (Slack webhooks)
```

---

## Directory Structure

```
src/
  index.ts                 Entry point - main() dispatches by --mode
  config.ts                Env vars, defaults, wallet parsing
  logger.ts                Pino singleton

  interfaces/
    common.ts              Enums: ChainId, TransactionType, TokenCategory, Confidence,
                           PriceSource, CostBasisMethod, JournalSide, ReconciliationStatus,
                           ExportFormat. Plus TokenInfo, TokenAmount, PricePoint types.
    input.ts               ReconAgentInput, WalletConfig, ClassificationRule, AccountingConfig,
                           DeliveryConfig, ReconciliationConfig
    output.ts              ClassifiedTransaction, JournalEntry, JournalLine, ReconciliationReport,
                           Discrepancy, RebasingAdjustment, HumanOverride
    state.ts               ReconState, WalletChainState (resumable processing state)

  core/
    pipeline.ts            ReconPipeline - orchestrates the full flow per wallet
    connectors/
      types.ts             ChainConnector interface, RawTransaction, TokenTransfer
      evm.ts               EvmConnector - viem + Alchemy getAssetTransfers
      solana.ts            SolanaConnector - @solana/web3.js + Helius parseTransactions
      evm-enricher.ts      Protocol detection via method IDs + contract addresses
    classifiers/
      engine.ts            ClassificationEngine - 4-tier priority dispatcher
      protocols/index.ts   Protocol-specific patterns (Uniswap, Aave, Lido, Curve, Jupiter, etc.)
      rules/index.ts       Heuristic fallback rules (token flow pattern matching)
    pricing/
      service.ts           PricingService - 6-tier pricing waterfall
      defillama.ts         DeFi Llama adapter (primary, free)
      coingecko.ts         CoinGecko adapter (fallback, optional API key)
      onchain.ts           On-chain exchange rates for receipt tokens (wstETH, rETH)
      cache.ts             Price cache wrapper (5-min buckets)
    formatters/
      journal.ts           JournalEntryGenerator - double-entry for 17+ tx types
      chart-of-accounts.ts Default chart of accounts (1000s assets, 4000s revenue, etc.)
      adapters/
        canonical.ts       Universal CSV export
        xero.ts            Xero Manual Journal CSV
        quickbooks.ts      QuickBooks Journal Entry JSON
        netsuite.ts        NetSuite import CSV
    cost-basis/
      engine.ts            CostBasisEngine - FIFO lot creation + consumption
      lot-tracker.ts       Open lot summary helper
      gain-loss.ts         Short/long term gain/loss calculator
    reconciliation/
      engine.ts            ReconciliationEngine - orchestrates all 3 matchers
      three-way.ts         ThreeWayMatcher - ledger balance vs on-chain balance
      bridge-matcher.ts    BridgeMatcher - pairs outbound + inbound legs across chains
      rebasing.ts          RebasingTracker - detects stETH/aToken balance changes

  storage/
    adapter.ts             StorageAdapter interface (16+ methods) - the Postgres swap point
    sqlite.ts              SqliteAdapter - full implementation with WAL mode

  events/
    emitter.ts             ReconEventEmitter - typed local event bus
    types.ts               Event types: transaction_classified, anomaly_detected, etc.

  delivery/
    cli.ts                 CLI argument parsing (--mode, --chain, --wallet, etc.)
    slack.ts               Slack webhook delivery (reconciliation summaries, anomalies, digest)
```

---

## External Dependencies

| Dependency | Purpose | Required? |
|---|---|---|
| Alchemy API | EVM chain data (getAssetTransfers) | Yes, for EVM |
| Helius API | Solana enhanced transactions | Yes, for Solana |
| DeFi Llama API | Token pricing (free, no key) | Yes |
| CoinGecko API | Fallback pricing ($129/mo Pro) | Optional |
| Slack Webhooks | Alert/report delivery | Optional |

---

## Environment Variables

```
ALCHEMY_API_KEY               # Required for EVM chains
HELIUS_API_KEY                # Required for Solana
COINGECKO_API_KEY             # Optional fallback pricing
SQLITE_PATH=./recon-agent.db
POLL_INTERVAL_MS=60000        # Continuous mode poll interval
LOG_LEVEL=info
SLACK_WEBHOOK_URL             # Optional
RECON_WALLETS                 # Comma-separated: address:chain:label,...
```

---

## Key Design Decisions

### 1. ALL monetary values are decimal strings, never floats
TokenAmount.amount, PricePoint.usdPrice, TaxLot.costBasisUsd, JournalLine.amount - all strings. This prevents floating-point precision errors in accounting. Parse only at display/calculation time.

### 2. Deterministic transaction IDs
Format: `${chain}:${txHash}:0` (logIndex always 0 for now - multi-log transactions need refactoring to use actual log indices).

### 3. Gas capitalization
If a transaction is an acquisition (tokens received) AND tokensIn.length > 0, gas cost is added to the cost basis of acquired tokens. Otherwise gas is expensed to account 6000.

### 4. Classification priority
User-defined rules (highest) > Protocol-specific patterns > Heuristic rules > Unknown (lowest). Each classification includes an audit trail: method used, rule ID, confidence level, rationale, model version, data lineage.

### 5. Append-only audit log
Database triggers prevent UPDATE/DELETE on the audit_log table. Every classification, override, lot disposal, and reconciliation is logged permanently.

### 6. StorageAdapter interface
All database access goes through the StorageAdapter interface (storage/adapter.ts). SQLite is the current implementation. Swapping to Postgres means implementing the same 16+ methods against pg. No other code changes needed.

---

## What's Fully Working

- Multi-chain transaction fetching (5 EVM chains + Solana)
- 3-tier classification engine with protocol-specific patterns for Uniswap V2/V3, Aave V3, Lido, Curve, Jupiter, Marinade, Raydium, Orca
- Heuristic fallback classification for unknown protocols
- 4-tier pricing waterfall (stablecoin detection, cache, on-chain exchange rates, DeFi Llama, CoinGecko)
- Double-entry journal generation for 17+ transaction types with debit=credit validation
- FIFO cost basis tracking with per-wallet lots, gain/loss calculation, gas capitalization
- Three-way reconciliation (ledger vs on-chain balance)
- Bridge leg correlation across chains (time window + token symbol heuristic)
- Rebasing token balance tracking (stETH, aTokens)
- Export to Xero CSV, QuickBooks JSON, NetSuite CSV, canonical CSV
- Slack delivery for reconciliation summaries, anomalies, daily digest
- CLI with 6 modes (status, backfill, recon, reconcile, export, override)
- Append-only audit trail with immutable database triggers
- Exponential backoff retry on RPC rate limits
- Event emitter for extensibility

---

## What's Partially Implemented or Stubbed

### Solana connector gaps
- No compressed NFT handling
- No inner instruction parsing (only top-level Helius types)
- Token metadata (symbol, decimals) sometimes returns "UNKNOWN"/0 for lesser-known SPL tokens

### Bridge matcher limitations
- Heuristic matching only (time window + token symbol + amount within 5%)
- No deterministic matching via bridge protocol event logs
- No cross-chain atomic swap detection (Hyperlane, Across, deBridge patterns not recognized)

### Rebasing tracker incomplete
- Balance snapshots created and compared
- Yield deltas detected
- BUT: synthetic journal entries for yield claims not fully wired into the pipeline

### Cost basis engine - FIFO only
- SPECIFIC_ID method is declared in the enum but not implemented
- No LIFO or HIFO support

### Human override flow incomplete
- Override is stored in DB and audit log
- But overridden transactions are not automatically re-classified
- No UI for reviewing overrides

### SQLite migrations
- Schema is created inline in SqliteAdapter
- No versioned migration files (001_init.sql expected but not present)

---

## Known Limitations & Edge Cases Not Handled

1. **Internal ETH transfers (EVM)** - EvmConnector sets internalTransactions to empty []. Needs Alchemy trace API or debug_traceTransaction fallback. Can miss significant value flows.

2. **LP token decomposition** - LP tokens stored as single asset. No automatic breakdown to underlying token pair. Users must manually configure LP position accounting.

3. **Multi-hop aggregator swaps** - Aggregators like 1inch/Paraswap collapse multiple router calls into one tx. Internal hops are not decomposed, so intermediate loss/gain is hidden.

4. **MEV/sandwich detection** - Recorded amounts are accurate post-execution, but slippage from sandwich attacks is not flagged.

5. **Governance vote-escrow** - GOVERNANCE_VOTE is classified but no lock/unlock position tracking (Curve gauge voting, Aave cooldown, etc.).

6. **Failed transactions** - Classified as GAS-only (correct), but no user notification that gas was burned on a failed tx.

7. **Multi-log transactions** - Transaction ID uses logIndex=0 for all. If a single tx has multiple meaningful token events (e.g., a swap + LP add in one tx), they collapse into one record.

8. **Protocol coverage gaps** - Only Uniswap, Aave, Lido, Curve, and Solana DEXs are pattern-matched. Missing: Convex, Yearn, Balancer, Compound V3, MakerDAO/Sky, Morpho, Pendle, EigenLayer, Ethena, Hyperliquid.

9. **L2-specific contract addresses** - KNOWN_CONTRACTS in evm-enricher.ts are mostly Ethereum mainnet. Same protocols have different addresses on Arbitrum, Optimism, Base, Polygon.

10. **Receipt token coverage** - Only wstETH and rETH have on-chain exchange rate pricing. Missing: cTokens (Compound), aTokens (Aave), sDAI, Yearn vault shares, Morpho mTokens, Pendle PT/YT.

---

## Database Schema

**Tables** (all created in SqliteAdapter constructor):

| Table | Purpose | Key columns |
|---|---|---|
| `transactions` | Classified transactions | id, chain, tx_hash, block_number, wallet, type, sub_type, protocol, tokens_in/out (JSON), gas_fee (JSON), classification (JSON) |
| `journal_entries` | Double-entry journal entries | id, transaction_id, date, memo, lines (JSON), metadata (JSON) |
| `tax_lots` | FIFO cost basis lots | id, wallet, chain, token_address, original_amount, remaining_amount, cost_basis_usd, cost_basis_per_unit, closed (bool) |
| `bridge_legs` | Cross-chain bridge legs | id, direction (in/out), chain, wallet, token_symbol, amount, protocol, matched (bool), matched_leg_id |
| `audit_log` | Immutable event log | id, event_type, transaction_id, wallet, chain, details (JSON) -- NO UPDATE/DELETE |
| `balance_snapshots` | Point-in-time balances | wallet, chain, token_address, balance, balance_usd, timestamp |
| `reconciliation_reports` | Reconciliation results | wallet, chain, ledger_balance (JSON), on_chain_balance (JSON), discrepancies (JSON), status |
| `wallet_states` | Processing state per wallet-chain | wallet, chain, last_processed_block, transaction_count, error_count -- PK(wallet, chain) |
| `price_cache` | 5-min bucketed price cache | chain, token_address, timestamp, price_usd, source -- UNIQUE(chain, token_address, timestamp) |
| `human_overrides` | Manual classification corrections | transaction_id, previous_type, new_type, reason, overridden_by |

---

## Chart of Accounts

```
1000  Crypto Assets (general)
1010  Stablecoin Holdings
1020  Staked Assets
1030  LP Positions
1040  Receipt Tokens (wstETH, cTokens, aTokens)
1050  Wrapped Native (WETH, WSOL)
1060  Assets in Transit (bridges)
1100  Lending Deposits
1200  Reward Receivables

2000  DeFi Borrowing
2100  Accrued Interest

4000  Staking Revenue
4010  Lending Interest Income
4020  LP Fee Income
4030  Airdrop Income
4040  Governance Rewards

5000  Realized Gain
5010  Realized Loss
5020  Impairment Loss

6000  Gas/Network Fees
6010  Trading Fees
6020  Protocol Fees

7000  Other Income - Staking
7010  Other Income - Yield
```

Override any account via `chartOfAccountsOverrides` in AccountingConfig.

---

## Accounting Config Defaults

```
baseCurrency: "USD"
bridgeTreatment: "transfer"              # or "disposal_acquisition"
stakingIncomeTreatment: "other_income"   # or "revenue"
gasTreatment: "capitalize_on_acquisition" # or "always_expense"
costBasisMethod: "fifo"                  # or "specific_id" (not yet implemented)
dustThresholdUsd: "0.01"
```

---

## What Needs to Be Built

This is organized by priority. Items marked **[CRITICAL]** block production use. Items marked **[IMPORTANT]** significantly improve reliability. Items marked **[ENHANCEMENT]** extend capability.

### Phase 1: Production Hardening

**[CRITICAL] Versioned database migrations**
- Create `migrations/` directory with numbered SQL files
- Implement migration runner in SqliteAdapter (track schema_version)
- First migration: extract current inline schema to 001_init.sql

**[CRITICAL] Multi-log transaction support**
- Change ID format from `chain:txHash:0` to `chain:txHash:logIndex`
- A single Uniswap swap can emit Transfer + Swap events - these need separate records or proper merging
- Audit all deduplication logic for this change

**[CRITICAL] Internal ETH transfer support**
- Add Alchemy debug_traceTransaction or trace API fallback in EvmConnector
- Internal transfers can represent significant value (contract-to-contract)
- Without this, reconciliation will show phantom discrepancies

**[IMPORTANT] L2 contract address registry**
- KNOWN_CONTRACTS and KNOWN_METHODS in evm-enricher.ts are Ethereum-only
- Need per-chain address maps for Uniswap, Aave, Lido, etc. on Arbitrum, Optimism, Base, Polygon
- Consider using an external registry (e.g., Uniswap's deployment addresses JSON)

**[IMPORTANT] Extend protocol coverage**
- Add classification patterns for: Compound V3, Balancer V2, Convex, Yearn V3, MakerDAO/Sky (DSR, sDAI), Morpho, Pendle, EigenLayer restaking, Ethena (USDe/sUSDe), Lido withdrawals
- Each needs: contract addresses, method IDs, classification logic

**[IMPORTANT] Extend receipt token pricing**
- Add on-chain exchange rate queries for: cTokens (Compound), aTokens (Aave), sDAI (MakerDAO), Yearn vault shares, Morpho mTokens, Pendle PT/YT tokens
- Pattern: call exchangeRate() on token contract, multiply by underlying price

**[IMPORTANT] Override re-classification**
- When a human override is applied, re-run the classification pipeline for that transaction
- Re-generate journal entry and update cost basis lots if the type changed (e.g., UNKNOWN -> SWAP)

**[IMPORTANT] Solana token metadata resolution**
- Query Helius or Metaplex for token symbol/decimals instead of returning "UNKNOWN"/0
- Cache results in a token_metadata table

### Phase 2: Reconciliation Engine Improvements

**[IMPORTANT] Complete rebasing yield journal entries**
- When RebasingTracker detects a balance increase, generate a synthetic YIELD_CLAIM transaction
- Pipe it through the full pipeline: classify, price, journal, cost basis
- This is needed for stETH holders, Aave depositors, any auto-compounding position

**[IMPORTANT] Deterministic bridge matching**
- Current: heuristic (time window + symbol + amount within 5%)
- Better: parse bridge protocol events (Across DepositFilled, Stargate PacketReceived, etc.)
- Map specific bridge contracts per chain and extract cross-chain message IDs

**[ENHANCEMENT] LP position decomposition**
- For Uniswap V2/V3, Curve, Balancer LP positions: decompose LP token into underlying assets
- Query pool contract for reserves, calculate pro-rata share
- Needed for accurate portfolio valuation and reconciliation

**[ENHANCEMENT] Specific ID cost basis method**
- Implement SPECIFIC_ID alongside FIFO in CostBasisEngine
- Allow user to specify which lot to consume on disposal
- Required for IRS Rev Proc 2024-28 compliance (per-wallet lot selection)

**[ENHANCEMENT] LIFO / HIFO cost basis**
- Add LIFO and HIFO options
- Useful for tax optimization strategies

### Phase 3: TreasuryOS Frontend (the Public Wedge)

This is the product layer that sits on top of ReconAgent's backend. It is what users see and interact with.

**Web Dashboard**
- Unified treasury view: all wallets, all chains, one screen
- Holdings breakdown: stablecoins, DeFi positions, LP exposure, staked assets
- Transaction feed with classification labels and confidence indicators
- Reconciliation status per wallet (matched/flagged/unmatched)
- Override UI: click a transaction, change its type, add reason
- Filter/search by chain, wallet, date range, transaction type, protocol

**Weekly AI Treasury Briefing (signature feature)**
- Scheduled delivery: email, Slack, PDF export
- Contents: net inflows/outflows, yield earned, stablecoin risk breakdown, counterparty exposure, DeFi protocol risk summary, idle capital detection, suggested reallocation
- This is the habit builder - the thing that makes users come back every week

**Risk Alerts**
- Concentration alerts: "75% of treasury is in USDT"
- Protocol exposure: "42% of funds in one lending protocol"
- Idle capital: "500K USDC earning 0%"
- Large inflow from unknown address
- Exchange exposure exceeding internal limits
- Deliver via Slack, email, dashboard notification

**Action Suggestions (manual confirm only)**
- "Move idle USDC to Aave at 5.2%?"
- "Rebalance stablecoin exposure?"
- "Export reconciliation summary?"
- No auto-execution. Users must click confirm. This is the soft introduction to agentic behavior.

**Wallet Connection**
- Replace env-based RECON_WALLETS with a UI for adding/removing wallets
- Support WalletConnect, Phantom, MetaMask browser extension
- Read-only connection (no signing needed for ReconAgent)

### Phase 4: Enterprise Features

**Role-based access control**
- Treasury Analyst: full view, suggest actions
- Approver: confirm/reject agent-proposed actions
- Viewer: read-only dashboards
- Compliance: audit logs, export-ready reports

**Bank + accounting integrations**
- CSV bank statement upload (parse common formats)
- Stripe, Mercury, Wise API integrations
- Xero / QuickBooks bidirectional sync (not just export)

**Compliance + audit layer**
- SOC 2 compliance report generation
- Audit trail export tool (CSV/JSON for external auditors)
- Configurable retention policies

**SaaS billing + user management**
- Auth (likely Clerk or Auth0)
- Stripe billing integration
- Free tier / Pro ($49-299/mo) / Fund ($999+/mo)

**Postgres migration**
- Implement PostgresAdapter (same StorageAdapter interface)
- Add connection pooling
- Migrate from file-based SQLite to hosted Postgres for multi-user

### Phase 5: Platform Integration (TreasuryOS)

ReconAgent becomes one of 10 agent products under TreasuryOS. The integration points are already designed:

- **StorageAdapter**: swap SQLite for shared Postgres when running inside TreasuryOS
- **Event emitter**: currently local-only. Route to TreasuryOS event bus for cross-agent orchestration (e.g., RiskGuard triggers based on ReconAgent anomaly events)
- **Classification audit trails**: feed into TreasuryOS compliance dashboard
- **Journal entries**: feed into CloseAgent for month-end close automation
- **Cost basis data**: feed into TaxLot agent for 1099-DA generation

---

## Hardcoded Values to Know About

| Location | What | Value |
|---|---|---|
| evm-enricher.ts | KNOWN_CONTRACTS | Ethereum mainnet only |
| evm-enricher.ts | STABLECOINS | USDC, USDT, DAI, BUSD, FRAX (ETH) + USDC, USDT (Solana) |
| evm-enricher.ts | RECEIPT_TOKENS | wstETH, rETH only |
| pricing/service.ts | Stablecoin de-peg threshold | 2% |
| pricing/cache.ts | Price cache bucket size | 300 seconds (5 min) |
| evm.ts | Alchemy max transfers per request | 1000 (0x3E8) |
| reconciliation/three-way.ts | Dust threshold default | $0.01 |
| reconciliation/bridge-matcher.ts | Bridge match time window | 3600 seconds (1 hour) |
| reconciliation/bridge-matcher.ts | Bridge amount tolerance | 5% |
| cost-basis/gain-loss.ts | Long-term holding period | 365 * 24 * 3600 seconds |
| formatters/journal.ts | Debit=credit tolerance | $0.01 |
| storage/sqlite.ts | JE save validation tolerance | $0.005 |

---

## Supported Transaction Types

```
SWAP                    Token A -> Token B (DEX)
LP_ADD                  Add liquidity to pool
LP_REMOVE               Remove liquidity from pool
LEND                    Deposit into lending protocol
BORROW                  Borrow from lending protocol
REPAY                   Repay borrowed amount
WITHDRAW_COLLATERAL     Withdraw from lending protocol
STAKE                   Stake tokens (validator, liquid staking)
UNSTAKE                 Unstake / request withdrawal
CLAIM_REWARD            Claim staking/farming rewards
BRIDGE_OUT              Send tokens cross-chain
BRIDGE_IN               Receive tokens cross-chain
TRANSFER_IN             Receive tokens (same chain)
TRANSFER_OUT            Send tokens (same chain)
GAS                     Failed tx or gas-only tx
WRAP                    Wrap native token (ETH -> WETH)
UNWRAP                  Unwrap (WETH -> ETH)
GOVERNANCE_VOTE         Vote on governance proposal
GOVERNANCE_DELEGATE     Delegate voting power
AIRDROP                 Receive airdropped tokens
CONTRACT_DEPLOY         Deploy a contract
APPROVAL                ERC20 approve() call
YIELD_CLAIM             Synthetic - rebasing yield detected
UNKNOWN                 Could not classify
```

---

## Supported Chains

| Chain | Connector | Data Source |
|---|---|---|
| Ethereum | EvmConnector | Alchemy getAssetTransfers |
| Arbitrum | EvmConnector | Alchemy getAssetTransfers |
| Optimism | EvmConnector | Alchemy getAssetTransfers |
| Base | EvmConnector | Alchemy getAssetTransfers |
| Polygon | EvmConnector | Alchemy getAssetTransfers |
| Solana | SolanaConnector | Helius parseTransactions |

Adding a new EVM chain: add to ChainId enum, add Alchemy URL env var, add to DeFi Llama CHAIN_MAP. Adding a non-EVM chain: implement ChainConnector interface from scratch.

---

## How to Run Tests

No test suite exists yet. This is a gap. Recommended approach:

```bash
# Unit tests for classification engine
# - Feed known tx patterns, assert correct TransactionType + confidence
# - Test each protocol classifier independently
# - Test heuristic rules with edge cases

# Unit tests for journal entry generator
# - Feed ClassifiedTransaction, assert debit=credit for every type
# - Test gas capitalization logic
# - Test gain/loss balancing

# Unit tests for cost basis engine
# - Test FIFO lot creation and consumption
# - Test gain/loss calculation for known scenarios
# - Test gas capitalization into cost basis

# Integration tests
# - Process a known wallet with known transactions
# - Assert journal entries match expected output
# - Assert reconciliation report is MATCHED

# Use bun:test
bun test
```

---

## Codebase Conventions

- **Decimal strings everywhere** for money. Never use `number` for USD amounts or token quantities.
- **Pino logger** (src/logger.ts) - use `logger.info()`, `logger.warn()`, `logger.error()` with structured metadata
- **Event-driven** - emit events through ReconEventEmitter for any significant pipeline action
- **Model version** - all audit log entries tagged with `recon-agent-v1.0.0`
- **Exponential backoff** - 3 retries with doubling delay on RPC 429s
- **No build step** - Bun runs TypeScript directly. `bun run typecheck` for type checking only.

---

## Files to Read First

If you're onboarding, read in this order:

1. `src/interfaces/common.ts` - all the enums and base types
2. `src/interfaces/input.ts` + `output.ts` - data contracts
3. `src/core/pipeline.ts` - the main orchestration flow
4. `src/core/classifiers/engine.ts` - how classification works
5. `src/core/pricing/service.ts` - how pricing works
6. `src/formatters/journal.ts` - how journal entries are generated
7. `src/core/cost-basis/engine.ts` - how FIFO lots work
8. `src/core/reconciliation/engine.ts` - how reconciliation works
9. `src/storage/adapter.ts` - the database interface contract
10. `src/index.ts` - how CLI modes dispatch

---

## Strategic Context

ReconAgent solves a validated $130M+ pain point (Fireblocks acquired TRES Finance for that amount just to solve reconciliation). The competitive landscape:

- **TRES Finance** (acquired by Fireblocks) - aggregates from 220+ sources, enterprise-focused
- **Bitwave** - enterprise crypto accounting, partnered with Deloitte
- **Cryptio** - crypto accounting for funds
- **Coinshift** - DAO treasury platform with multisig + cashflow reporting
- **Request Finance** - crypto invoicing for DAOs

ReconAgent's differentiation: DeFi-deep classification (understands protocol mechanics, not just "known contract" matching), multi-chain reconciliation with bridge correlation, AI-powered classification that learns, and open architecture designed to be one component of a larger agent platform.

The 9 other enterprise agent products planned alongside ReconAgent (YieldPilot, GovExec, DiversifyAgent, TaxLot, RiskGuard, CloseAgent, PayAgent, BriefAgent, StableShield) will all feed data into and consume data from ReconAgent's reconciliation engine.
