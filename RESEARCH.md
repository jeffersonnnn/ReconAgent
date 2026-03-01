# ReconAgent v1 — Research Synthesis

> Compiled Feb 18, 2026 from 8 parallel research tracks.
> Sources: training knowledge (through May 2025), strategic document analysis, ecosystem research.

---

## 1. Competitive Landscape

### The Market Split

The market is divided into two camps with nobody at the intersection:

**Enterprise Accounting Tools** (TRES/Fireblocks, Bitwave, Cryptio/Ledger):
- Good at accounting, cost basis, ERP integration
- Bad at DeFi depth (known-contract library approach breaks on new protocols)
- Not DAO-native (no multisig awareness, streaming payments, governance flows)
- TRES and Cryptio now locked into custodian ecosystems (Fireblocks, Ledger)
- Pricing: $3K-15K/month

**DAO Treasury Tools** (Coinshift, Llama, Request Finance):
- Good at DAO operations (multisig management, invoicing, dashboards)
- No real accounting capability (no journal entries, cost basis, or ERP export)
- Coinshift: Safe-native but EVM-only, no DeFi position unwinding
- Request: only reconciles payments flowing through their invoice system
- Llama: pivoted to governance protocol, left services gap

**The Gap**: Accounting-grade reconciliation that is DAO-native, DeFi-deep, custodian-neutral, and AI-powered for classification. This is where ReconAgent lives.

### Competitor Detail

| Feature | TRES (Fireblocks) | Bitwave | Cryptio (Ledger) | Coinshift | Request | Entendre |
|---|---|---|---|---|---|---|
| Target | Funds/Enterprise | Enterprise | Enterprise | DAOs | DAOs/SMBs | SMBs |
| Reconciliation | Strong | Strong | Strong | None | Invoice-only | Basic |
| DeFi Depth | Medium | Medium | Medium | Shallow | None | Basic |
| Chain Coverage | 15+ | 10+ (EVM-heavy) | 10+ | EVM only | EVM + some | 5-8 |
| Accounting Integration | QB/Xero/NetSuite | NetSuite/SAP/QB/Xero | Xero/QB | None | Xero/QB | QB/Xero |
| Cost Basis | Yes | Yes (advanced) | Yes | No | No | Yes |
| DAO-Specific | Weak | Weak | Weak | Strong | Medium | Weak |
| Multisig Native | No | No | No | Yes | No | No |
| Real-time | Batch (hours) | Batch | Batch | Near real-time | Event-driven | Batch |
| Pricing | $5K-15K/mo | $3K-15K/mo | Enterprise | Free-$500/mo | Free-$500/mo | $100-1K/mo |
| Standalone | No (Fireblocks) | Yes | No (Ledger) | Yes | Yes | Yes |

### What Every Existing Tool Gets Wrong

1. **DeFi is a black box** — "known contracts" approach breaks for new protocols, complex multi-step txs, cross-chain ops, rebasing tokens, nested vaults
2. **No tool is DAO-native AND accounting-grade** — Coinshift has zero accounting; Bitwave/TRES don't understand DAO ops
3. **Reconciliation is batch, not continuous** — hours/days stale. $100M+ treasuries need real-time
4. **Last mile to GL is manual** — same swap could be treasury rebalance, fee payment, or revenue depending on business context
5. **Cross-chain reconciliation is broken** — no tool reliably matches bridge transaction legs
6. **Acquisition consolidation killed standalone options** — TRES=Fireblocks-only, Cryptio=Ledger-only

---

## 2. DeFi Transaction Taxonomy

### Core Transaction Types

| Category | EVM Patterns | Solana Patterns |
|---|---|---|
| **Transfers** | `Transfer` event on ERC-20; native ETH via `tx.value` + internal txs (traces) | `preTokenBalances`/`postTokenBalances` delta; SPL `transfer` instruction |
| **Swaps** | `Swap` events on AMM contracts; aggregator routing via 1inch/Paraswap/CowSwap | Jupiter `route` instruction with inner hops; Raydium/Orca swap instructions |
| **LP Entry/Exit** | `Mint`/`Burn` events; V2 (fungible LP), V3 (NFT positions), Curve (multi-asset) | Raydium `addLiquidity`; Orca Whirlpool `increaseLiquidity`; Meteora DLMM bin-based |
| **Lending/Borrowing** | Aave: `Supply`/`Withdraw`/`Borrow`/`Repay`; Compound: `Mint`/`Redeem`; Morpho | Solend/Marginfi: protocol-specific instructions |
| **Staking** | Lido `submit()`→stETH; Rocket Pool deposit→rETH; EigenLayer restaking | Native SOL delegation; Marinade→mSOL; Jito→jitoSOL |
| **Yield Claims** | `getReward()` on staking contracts; Curve gauge `claim_rewards()`; Convex/Aura multi-token | Orca `collectReward`; Raydium farm claims |
| **Bridges** | Lock/burn on source → mint/unlock on destination; per-bridge matching keys | Wormhole, deBridge — same cross-chain pattern |
| **Wrapping** | ETH↔WETH (`Deposit`/`Withdrawal`); stETH→wstETH | SOL→wSOL (token account creation) |
| **Governance** | Vote-escrow locks, `VoteCast`, `DelegateChanged` events | SPL Governance / Realms instructions |
| **Airdrops** | Merkle distributor `Claimed` events; batch transfers | Merkle distributor; compressed airdrops |

### Critical Classification: Rebasing vs Exchange-Rate vs Standard Tokens

This is the single most important distinction for reconciliation:

**Rebasing (balance changes without transactions):**
- stETH: daily oracle `handleOracleReport()` — must poll `balanceOf()` or track shares
- Aave aTokens: `balanceOf()` = scaledBalance * liquidityIndex, changes every block
- Detection: poll balances periodically OR track shares + index

**Exchange-rate (constant balance, increasing value):**
- cTokens, wstETH, rETH, Yearn vault shares, jitoSOL, mSOL
- Value = balance * exchangeRate (queryable from contract)

**Standard (balance only changes via explicit transfers):**
- USDC, USDT, DAI, WETH, most tokens — easiest to reconcile

### LP Token Decomposition

- **Uniswap V2**: `(lpBalance / totalSupply) * reserveA/B`
- **Uniswap V3**: Position value depends on sqrtPriceX96, tick range, liquidity — if price outside range, entirely in one token
- **Curve**: Multi-asset, `virtual_price()` includes fees, non-linear stableswap math
- **Meteora DLMM**: Bin-based, sum value across bins, only active bin earns fees

### Edge Cases That Break Reconciliation

1. **Rebasing phantom balance changes** — stETH/aToken balances change without txs
2. **LP decomposition** — LP token is meaningless without underlying asset decomposition
3. **Internal transactions (EVM)** — ETH transfers between contracts NOT in standard logs, need trace API
4. **Failed transactions** — gas still charged, no value transfer, often missed
5. **Cross-chain bridge matching** — two txs on two chains, different hashes/timestamps/amounts/tokens
6. **MEV/sandwich attacks** — recorded amounts accurate but effective price worse
7. **Dust and rounding** — sub-cent mismatches accumulate over thousands of txs
8. **Receipt token nesting** — ETH→stETH→wstETH→Aave→awstETH→Pendle→PT-awstETH (each layer must track)
9. **Multi-hop aggregator swaps** — collapse N internal operations into 1 logical swap
10. **Failed tx gas** — EVM status:0 still charges gas; Solana failed txs charge base fee

### EVM vs Solana Structural Differences

| Aspect | EVM | Solana |
|---|---|---|
| Token transfers | `Transfer` event logs | `preTokenBalances`/`postTokenBalances` delta (major advantage) |
| Internal calls | Only via trace API (expensive) | `innerInstructions` are first-class metadata |
| Event structure | Typed event logs with indexed topics | Unstructured `logMessages[]`; need IDL per program for instruction data |
| Account model | Address-based | Token account→owner resolution needed |
| Failed txs | Status 0, events NOT emitted, gas charged | `err` field populated, base fee charged |
| Block finality | ~12s (ETH mainnet); L2s vary | ~400ms slot, ~12-15s finalized |

---

## 3. Accounting Standards & Journal Entry Formats

### ASU 2023-08 (Effective fiscal years after Dec 15, 2024)

- **Fair value accounting** for crypto assets — replaces old intangible asset impairment-only model
- Crypto assets measured at fair value each reporting period
- Changes flow through net income (not OCI)
- Presentation: separate line item on balance sheet; gains/losses on income statement
- Disclosure: significant holdings, restrictions, cost basis vs fair value

### Key Accounting Treatments

| Operation | Treatment |
|---|---|
| **Swaps** | Disposal of asset A + acquisition of asset B; realize gain/loss on A |
| **LP Entry** | Disposal of underlying assets, acquisition of LP position |
| **Staking Rewards** | Income at FMV when received (IRS Rev Ruling 2023-14) |
| **Yield Accrual** | Interest income recognized periodically |
| **Impermanent Loss** | Not separately recognized; manifests as lower LP fair value |
| **Gas** | Capitalize if for asset acquisition; expense if operational |
| **Bridges** | Configurable: transfer (same asset, no gain/loss) vs disposal/reacquisition |
| **Wrapping** | ETH↔WETH: reclassification; BTC→wBTC: potentially disposal (different counterparty risk) |
| **Airdrops** | Other income at FMV when received |

### Chart of Accounts Structure

```
1000s — Assets
  1000 Cash & Cash Equivalents (bank, stablecoins)
  1100 Digital Assets - L1 (BTC, ETH, SOL)
  1200 Digital Assets - Fungible Tokens (governance, utility, wrapped)
  1300 DeFi Positions (LP, lending, staking, yield farming)
  1400 NFTs
  1500 Accounts Receivable
  1600 Prepaid / Other

2000s — Liabilities
  2000 Accounts Payable
  2100 Accrued Liabilities
  2200 DeFi Borrowing Positions
  2300 Token Obligations

3000s — Equity
  3000 Common Stock / Membership
  3200 Retained Earnings
  3300 Treasury Tokens

4000s — Revenue
  4000 Protocol Revenue (trading fees, lending, staking, MEV)
  4100 Service Revenue
  4300 Other Income (airdrops, governance rewards)

5000s — Cost of Revenue
  5000 Validator infra, hosting, gas for protocol ops

6000s — Operating Expenses
  6000 G&A (salaries, legal, audit, insurance)
  6100 Tech & Development
  6200 Network Transaction Fees (gas by chain, bridge fees)
  6300 Marketing

7000s — Other Income/Expense
  7000 Realized Gains/Losses on Digital Assets
  7100 Unrealized Gains/Losses
  7300 Interest Expense - DeFi Borrowing
  7400 Liquidation Losses
```

### Journal Entry Export Formats

**Canonical ReconAgent output format** (transforms to any target):
```
journal_id, date, account_code, account_name, debit, credit, memo,
tx_hash, block_number, chain, counterparty, valuation_source, valuation_timestamp, base_currency
```

**Target system adapters:**
- **QuickBooks**: API JournalEntry endpoint (no native CSV import for JEs)
- **Xero**: CSV import for manual journals (`*Narration, *Date, *AccountCode, *Debit, *Credit`)
- **NetSuite**: CSV import or SuiteScript 2.0 `record.create({ type: 'journalentry' })`
- **Sage Intacct**: Web Services API with dimensional journal entries

### Critical Design Decisions

1. **Per-wallet cost basis tracking** — required by IRS Rev Proc 2024-28
2. **Fair value source recorded per entry** — auditors verify independently
3. **Tx hash + block number on every entry** — on-chain audit trail
4. **Support both ASU 2023-08 (fair value) and legacy (cost-minus-impairment)**
5. **Bridge treatment configurable** (transfer vs disposal)
6. **Staking income classification configurable** (revenue vs other income)
7. **Debits = credits validation mandatory** on every journal entry
8. **Gas treatment**: capitalize if asset acquisition, expense if operational

---

## 4. Chain Data Architecture

### Recommended Stack

| Layer | EVM | Solana | Pricing |
|---|---|---|---|
| **Primary** | Alchemy Enhanced APIs (`getAssetTransfers` + webhooks) | Helius Enhanced Transactions + Webhooks | DeFi Llama (free) |
| **Validation** | Etherscan free API (internal txs) | Raw RPC via Helius | CoinGecko Pro ($129/mo fallback) |
| **Protocol classification** | ABI decoding + The Graph subgraphs | Helius parsed `type` + `source` | On-chain exchange rates for receipt tokens |

### Why These Choices

**Alchemy `getAssetTransfers`**: Covers ETH transfers (including internal), all ERC-20/721/1155, decoded metadata. Single API call vs piecing together logs + traces.

**Helius Enhanced Transactions**: Parses raw Solana txs into structured format with `type` (SWAP, TRANSFER, STAKE_SOL, etc.), `source` (JUPITER, RAYDIUM, MARINADE, etc.), `tokenTransfers`, `nativeTransfers`. Saves weeks of IDL maintenance engineering. Gets ~80% of the way to accounting-ready data.

**DeFi Llama**: Free, no API key, covers DeFi tokens that CoinGecko doesn't list. Historical prices via `/prices/historical/{timestamp}/{chain}:{address}`.

### Monitoring Architecture

```
Per-chain webhook monitor → Message queue (Redis Streams) → Classifier → Accounting engine
```

- **Webhooks** for real-time (Alchemy Notify for EVM, Helius Webhooks for Solana)
- Confirmation delay layer: 12 blocks ETH, 20 Polygon, finalized for Solana
- 50 wallets x 5 chains = 250 wallet-chain pairs — easily manageable with webhooks

### Cost Estimate

**50 wallets across 5 chains (Ethereum, Arbitrum, Optimism, Base, Solana):**
- Alchemy Growth: $49-199/month
- Helius Developer: $49/month
- DeFi Llama: $0
- CoinGecko Pro (fallback): $0-129/month
- **Total: $100-400/month** for moderate activity (~500-2K txs/day)

### Historical Backfill

- **EVM**: Alchemy `getAssetTransfers` paginated by block range. 10K tx wallet = ~100 API calls = trivial on free tier.
- **Solana**: Helius `parseTransactions` batched. 10K txs = ~100 parse calls at ~10 req/s = ~10 seconds.
- Both are fast and cheap — hours to backfill, not days.

---

## 5. Treasury Structures & Target Users

### Major Treasury Managers

**karpatkey ($1.8B AUM, 7 DAOs)**:
- Uses Zodiac Roles Modifier for permission-scoped execution on Safe multisigs
- Custom Python bots for harvesting, rebalancing, health factor monitoring
- Monthly reports via Dune dashboards + governance forum posts
- Pain: reporting is labor-intensive, multi-chain complexity, permission management is manual
- GnosisDAO parted ways — market is fragmenting

**Llama (Aave, Uniswap, ENS, dYdX)**:
- Dune Analytics primary data layer + custom indexing
- Manual spreadsheet reconciliation for budget tracking
- Pain: Dune great for analytics, poor for transaction-level accounting
- Pivoted to governance protocol — left services gap

**Steakhouse Financial (MakerDAO/Sky)**:
- Most professional crypto treasury reports (actual balance sheets, income statements)
- Custom Python scripts + Dune + manual spreadsheet reconciliation
- Managed MakerDAO's $1.2B RWA deployment reporting
- **Monetalis firing**: late/incomplete reporting, fee opacity, verification impossibility — watershed moment for DAO treasury management

### DAO Wallet Architecture

**Common patterns:**
- Core treasury: 4-of-7 or 5-of-9 Safe with 24-48h timelock
- Operations: 2-of-3 Safe, shorter/no timelock
- Grants: 3-of-5 committee Safe
- Per-workstream: 2-of-3 per team

**Wallet count by DAO size:**
- Small (<$10M): 1 Safe
- Medium ($10M-$100M): 2-5 Safes
- Large ($100M+): 5-20+ Safes across multiple chains
- Wallets grow monotonically — DAOs rarely consolidate

**Solana equivalent**: Squads (multisig program with PDAs)

### The 94% Spreadsheet Statistic

From Bitwave/Tres Finance surveys (2023-2024): 94% of crypto finance teams still use spreadsheets as primary/secondary tool. Reasons:
1. No tool covers all chains
2. DeFi position accounting is bespoke per protocol
3. Categorization is org-specific
4. Data freshness issues (hours/days lag)
5. Multi-entity complexity
6. Enterprise tools too expensive for smaller DAOs
7. Integration gaps between tools

### Reconciliation Cycle Times

- **Traditional companies**: 5-7 business day close
- **Crypto companies**: 3-4 week close (best-in-class: 2 weeks)
- **Time allocation**: 30-40% classification, 25-30% data gathering, 15-20% DeFi position reconciliation, 10-15% pricing, 10% review
- **Labor cost**: 60-80 hours/month at $150-200/hr = $9K-16K/month

---

## 6. Compliance & Audit Requirements

### What Auditors Need Per Transaction

| Field | Purpose |
|---|---|
| Transaction hash | Existence proof |
| Block number | Ordering, finality |
| Block timestamp | Period assignment |
| Chain ID | Multi-chain |
| From/To addresses | Sender/recipient |
| From/To entity labels | Counterparty identification |
| Asset | Token identifier |
| Amount (native units) | Quantity |
| Fair value (USD) | Valuation |
| Fair value source | Pricing methodology |
| Gas/fee amount | Cost accounting |
| Classification | Transaction type |
| Classification method | Rule ID or model version |
| Cost basis (per lot) | Tax reporting |

### Three-Way Reconciliation

Auditors expect: Internal ledger vs. blockchain record vs. custodian/exchange records.

Period-end: opening balance + inflows - outflows = closing balance, tied to both GL and on-chain state.

### SOC 2 Type II

Enterprise gate. Required Trust Service Criteria:
- **Security**: RBAC, MFA, encryption, pen testing, incident response
- **Availability**: Uptime SLAs, DR, backups
- **Processing Integrity**: Data processed completely, accurately, timely (critical for ReconAgent)
- **Confidentiality**: Client financial data protection

Competitors with SOC 2: Bitwave, TRES, Cryptio, Lukka (SOC 1 + SOC 2).

Timeline: Type I in 3-6 months ($50-150K); Type II requires 6-12 month observation after Type I.

### Regulatory Requirements

**IRS**:
- Form 1099-DA: effective tax year 2025+
- Rev Proc 2024-28: per-wallet cost basis tracking required from Jan 1, 2025
- FIFO default; specific identification supported

**EU MiCA** (effective Dec 2024):
- Daily asset segregation reconciliation
- Detailed transaction record-keeping

**SEC Custody Rule**:
- Reconciliation between adviser records and qualified custodian records

### Audit Trail for AI Classification

Must include:
1. Input data (raw transaction)
2. Classification output
3. Confidence score
4. Classification rationale (which rule matched / feature importances)
5. Model/rule version
6. Timestamp
7. Data lineage (source API, block explorer, which node)
8. Human override history (original → new classification, who, when, why)
9. Immutable append-only logs (S3 Object Lock or equivalent)

---

## 7. TreasuryOS Skill Architecture

### Three-Layer Architecture

```
recon-agent/
├── SKILL.md              <- TreasuryOS skill definition
├── src/
│   ├── core/             <- LAYER 1: Core logic (never changes)
│   │   ├── classifiers/  <- transaction classification engine
│   │   ├── connectors/   <- blockchain RPCs, APIs
│   │   └── formatters/   <- journal entry output, reports
│   ├── interfaces/       <- LAYER 2: Data interface (the bridge)
│   │   ├── input.ts      <- defined input schema
│   │   ├── output.ts     <- defined output schema
│   │   └── state.ts      <- defined state schema
│   └── delivery/         <- LAYER 3: Slack, Telegram, email
└── MEMORY.md             <- persistent state
```

### Data Interface Contract

**Input Schema:**
- `wallet_addresses: string[]`
- `chain_ids: string[]`
- `classification_rules: Rule[]`
- `reporting_schedule: CronExpression`

**Output Schema (ClassifiedTransaction):**
- `chain`, `hash`, `type` (swap/lp_entry/lp_exit/yield_claim/bridge/transfer/gas)
- `counterparty`, `department`, `usd_value`
- `journal_entry: { debit_account, credit_account, amount, memo }`
- `risk_flags: string[]`
- `timestamp: number`

**State Schema:**
- `last_processed_block: { [chain]: number }`
- `classification_patterns: Pattern[]` (learned over time)
- `anomaly_history: Anomaly[]`
- `reconciliation_status: 'matched' | 'unmatched' | 'flagged'`

### Storage Adapter Pattern

```
Standalone:  Core Logic → Local Storage (MEMORY.md / SQLite)
Platform:    Core Logic → Shared Storage (Postgres / Supabase)
```

**The skill code is identical. Only the storage adapter changes.** This is the critical architectural decision.

### Event Emission

Events ReconAgent should emit (even standalone — no-ops locally, inter-skill triggers on platform):
- `transaction_classified` — new transaction classified
- `anomaly_detected` — mismatch or anomaly flagged
- `reconciliation_complete` — batch reconciliation cycle done

### Platform Migration Path

1. **Week 13**: Ship standalone (MEMORY.md/SQLite, Slack delivery)
2. **Week 19**: Build TreasuryOS runtime v0 (Postgres shared state, skill registry, swap storage adapter)
3. **Week 21+**: Cross-skill interactions (BriefAgent reads ReconAgent data, RiskGuard reads risk flags)

---

## 8. Product Requirements (Synthesized)

### Must-Haves for v1

1. **Multi-chain wallet aggregation** — unified view of all wallets across EVM + Solana
2. **Automated transaction classification** with manual override + audit trail
3. **DeFi position tracking** — LP positions, staking, lending (decompose to underlying)
4. **Journal entry generation** — canonical format with adapters for QB/Xero/NetSuite
5. **Per-wallet cost basis tracking** (FIFO + specific ID)
6. **Three-way reconciliation** — internal ledger vs blockchain vs custodian
7. **Rebasing token handling** — share-based accounting for stETH, aTokens
8. **Cross-chain bridge matching** — per-bridge correlation IDs
9. **Audit trail** — every classification logged with rationale, version, confidence
10. **Human override logging** — original + new classification, who, when, why

### Nice-to-Haves for v1

1. Real-time dashboards
2. Budget vs actual tracking
3. Tax lot optimization (HIFO)
4. Automated anomaly detection with severity tiers
5. Invoice matching
6. Multi-entity consolidation
7. Dust threshold configuration

### Beachhead Market

**Fragmenting DAO treasury management market** — smaller managers who can't build custom bots. The karpatkey/GnosisDAO split and flood of competing proposals created demand for productized tooling.

**Dream 100 wedge**: Free reconciliation report from public on-chain data for target accounts. Show them what they're missing.

**Pricing opportunity**: Enterprise tools charge $5K-15K/month. Start with generous free tier (public chain data, basic reporting), convert on depth ($99-2K/month for DeFi parsing, accounting integration, continuous monitoring).

---

## Appendix: Key Numbers

- TRES acquisition by Fireblocks: ~$130M
- karpatkey AUM: $1.8B across 7 DAOs
- Bitwave SOC 2: Type II certified
- ClawHub skills: 5,700+ (13.4% with critical vulns per Snyk)
- 94% of crypto finance teams use spreadsheets
- 3-4 week month-end close for crypto companies
- $100-400/month data infrastructure cost for 50 wallets x 5 chains
- ASU 2023-08 effective: fiscal years after Dec 15, 2024
- IRS per-wallet cost basis: required from Jan 1, 2025
- SOC 2 Type II timeline: 9-18 months, $100-300K
