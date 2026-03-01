# ReconAgent

Multi-chain DeFi reconciliation agent — GAAP/IFRS journal entries, cost basis tracking, audit-ready reports.

## Quick Start

```bash
bun install
bun run src/index.ts --mode=status
```

## Architecture

- **Runtime**: Bun + TypeScript (no build step)
- **Storage**: bun:sqlite with WAL mode, StorageAdapter interface (swappable to Postgres)
- **EVM**: viem + Alchemy Enhanced APIs (getAssetTransfers)
- **Solana**: @solana/web3.js + Helius Enhanced Transactions
- **Pricing**: DeFi Llama (primary) + CoinGecko (fallback) + on-chain exchange rates
- **Delivery**: Slack webhooks + CLI

## Key Conventions

- All monetary values are **decimal strings**, never floats: `"3000.50"` not `3000.5`
- Deterministic transaction IDs: `chain:txHash:logIndex`
- Append-only audit_log — triggers prevent UPDATE/DELETE
- Per-wallet cost basis (IRS Rev Proc 2024-28 compliant)
- Double-entry journal entries with debit=credit validation

## CLI Modes

```
--mode=status      Show wallet states
--mode=backfill    Process historical transactions
--mode=recon       Continuous monitoring
--mode=reconcile   One-shot reconciliation
--mode=export      Export journal entries (--format=canonical|xero|quickbooks|netsuite)
--mode=override    Manual classification override
```

## Environment Variables

See `.env.example` for all required variables.

## Directory Layout

```
src/
├── index.ts                 <- entry point
├── config.ts                <- env loading
├── logger.ts                <- pino singleton
├── interfaces/              <- TypeScript types
├── storage/                 <- SQLite adapter + migrations
├── core/
│   ├── pipeline.ts          <- fetch → classify → price → journal → store
│   ├── connectors/          <- EVM + Solana chain connectors
│   ├── pricing/             <- DeFi Llama + CoinGecko + on-chain
│   ├── classifiers/         <- classification engine + rules + protocols
│   ├── formatters/          <- journal entries + export adapters
│   ├── cost-basis/          <- FIFO lot tracking + gain/loss
│   └── reconciliation/      <- three-way match + bridge + rebasing
├── delivery/                <- Slack + CLI
└── events/                  <- typed event emitter
```
