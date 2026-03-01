import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import type { StorageAdapter, TaxLot, BridgeLeg, AuditLogEntry, BalanceSnapshot } from "./adapter.js";
import type { ChainId } from "../interfaces/common.js";
import type { ClassifiedTransaction, JournalEntry, ReconciliationReport, HumanOverride } from "../interfaces/output.js";
import type { WalletChainState } from "../interfaces/state.js";
import { logger } from "../logger.js";

const PRICE_BUCKET_SECONDS = 300; // 5 minutes

function bucketTimestamp(ts: number): number {
  return Math.floor(ts / PRICE_BUCKET_SECONDS) * PRICE_BUCKET_SECONDS;
}

export class SqliteAdapter implements StorageAdapter {
  private db: Database;

  constructor(private dbPath: string) {
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    // WAL mode for concurrent reads
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");

    // Run migrations
    const currentVersion = this.getSchemaVersion();
    if (currentVersion < 1) {
      const migrationPath = join(dirname(fileURLToPath(import.meta.url)), "migrations", "001_init.sql");
      const sql = readFileSync(migrationPath, "utf-8");
      this.db.exec(sql);
      logger.info("applied migration 001_init.sql");
    }
  }

  private getSchemaVersion(): number {
    try {
      const row = this.db.query("SELECT MAX(version) as v FROM schema_version").get() as { v: number } | undefined;
      return row?.v ?? 0;
    } catch {
      return 0;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // --- Transactions ---

  async saveTransaction(tx: ClassifiedTransaction): Promise<void> {
    this.db.query(`
      INSERT OR REPLACE INTO transactions (id, chain, tx_hash, block_number, block_timestamp, "from", "to", wallet, type, sub_type, protocol, tokens_in, tokens_out, gas_fee, gas_capitalized, classification, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tx.id, tx.chain, tx.txHash, tx.blockNumber, tx.blockTimestamp,
      tx.from, tx.to, tx.wallet, tx.type, tx.subType ?? null, tx.protocol ?? null,
      JSON.stringify(tx.tokensIn), JSON.stringify(tx.tokensOut),
      JSON.stringify(tx.gasFee), tx.gasCapitalized ? 1 : 0,
      JSON.stringify(tx.classification), JSON.stringify(tx.rawData),
    );
  }

  async getTransaction(id: string): Promise<ClassifiedTransaction | null> {
    const row = this.db.query('SELECT * FROM transactions WHERE id = ?').get(id) as any;
    return row ? this.rowToTransaction(row) : null;
  }

  async getTransactionsByWallet(wallet: string, chain: ChainId, opts?: { from?: number; to?: number; limit?: number }): Promise<ClassifiedTransaction[]> {
    let sql = 'SELECT * FROM transactions WHERE wallet = ? AND chain = ?';
    const params: any[] = [wallet, chain];
    if (opts?.from) { sql += ' AND block_timestamp >= ?'; params.push(opts.from); }
    if (opts?.to) { sql += ' AND block_timestamp <= ?'; params.push(opts.to); }
    sql += ' ORDER BY block_timestamp ASC';
    if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }
    const rows = this.db.query(sql).all(...params) as any[];
    return rows.map(this.rowToTransaction);
  }

  async transactionExists(id: string): Promise<boolean> {
    const row = this.db.query('SELECT 1 FROM transactions WHERE id = ?').get(id);
    return !!row;
  }

  private rowToTransaction(row: any): ClassifiedTransaction {
    return {
      id: row.id,
      chain: row.chain,
      txHash: row.tx_hash,
      blockNumber: row.block_number,
      blockTimestamp: row.block_timestamp,
      from: row.from,
      to: row.to,
      wallet: row.wallet,
      type: row.type,
      subType: row.sub_type ?? undefined,
      protocol: row.protocol ?? undefined,
      tokensIn: JSON.parse(row.tokens_in),
      tokensOut: JSON.parse(row.tokens_out),
      gasFee: JSON.parse(row.gas_fee),
      gasCapitalized: row.gas_capitalized === 1,
      classification: JSON.parse(row.classification),
      rawData: JSON.parse(row.raw_data),
    };
  }

  // --- Journal Entries ---

  async saveJournalEntry(entry: JournalEntry): Promise<void> {
    // Validate debit = credit
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of entry.lines) {
      const amt = parseFloat(line.amount);
      if (line.side === "debit") totalDebit += amt;
      else totalCredit += amt;
    }
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new Error(`Journal entry ${entry.id}: debit (${totalDebit}) != credit (${totalCredit})`);
    }

    this.db.query(`
      INSERT OR REPLACE INTO journal_entries (id, transaction_id, date, timestamp, memo, lines, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.transactionId, entry.date, entry.timestamp, entry.memo, JSON.stringify(entry.lines), JSON.stringify(entry.metadata));
  }

  async getJournalEntries(opts: { wallet?: string; from?: number; to?: number; chain?: ChainId }): Promise<JournalEntry[]> {
    let sql = 'SELECT * FROM journal_entries WHERE 1=1';
    const params: any[] = [];
    if (opts.from) { sql += ' AND timestamp >= ?'; params.push(opts.from); }
    if (opts.to) { sql += ' AND timestamp <= ?'; params.push(opts.to); }
    sql += ' ORDER BY timestamp ASC';
    const rows = this.db.query(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      transactionId: r.transaction_id,
      date: r.date,
      timestamp: r.timestamp,
      memo: r.memo,
      lines: JSON.parse(r.lines),
      metadata: JSON.parse(r.metadata),
    }));
  }

  // --- Tax Lots ---

  async saveTaxLot(lot: TaxLot): Promise<void> {
    this.db.query(`
      INSERT OR REPLACE INTO tax_lots (id, wallet, chain, token_address, token_symbol, acquired_at, acquired_tx_id, original_amount, remaining_amount, cost_basis_usd, cost_basis_per_unit, method, closed, closed_at, closed_tx_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lot.id, lot.wallet, lot.chain, lot.tokenAddress, lot.tokenSymbol, lot.acquiredAt, lot.acquiredTxId, lot.originalAmount, lot.remainingAmount, lot.costBasisUsd, lot.costBasisPerUnit, lot.method, lot.closed ? 1 : 0, lot.closedAt ?? null, lot.closedTxId ?? null);
  }

  async updateTaxLot(id: string, updates: Partial<Pick<TaxLot, "remainingAmount" | "closed" | "closedAt" | "closedTxId">>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.remainingAmount !== undefined) { sets.push("remaining_amount = ?"); params.push(updates.remainingAmount); }
    if (updates.closed !== undefined) { sets.push("closed = ?"); params.push(updates.closed ? 1 : 0); }
    if (updates.closedAt !== undefined) { sets.push("closed_at = ?"); params.push(updates.closedAt); }
    if (updates.closedTxId !== undefined) { sets.push("closed_tx_id = ?"); params.push(updates.closedTxId); }
    if (sets.length === 0) return;
    params.push(id);
    this.db.query(`UPDATE tax_lots SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  async getOpenLots(wallet: string, tokenAddress: string, chain: ChainId): Promise<TaxLot[]> {
    const rows = this.db.query(
      'SELECT * FROM tax_lots WHERE wallet = ? AND token_address = ? AND chain = ? AND closed = 0 ORDER BY acquired_at ASC'
    ).all(wallet, tokenAddress, chain) as any[];
    return rows.map(this.rowToTaxLot);
  }

  async getLotById(id: string): Promise<TaxLot | null> {
    const row = this.db.query('SELECT * FROM tax_lots WHERE id = ?').get(id) as any;
    return row ? this.rowToTaxLot(row) : null;
  }

  private rowToTaxLot(row: any): TaxLot {
    return {
      id: row.id,
      wallet: row.wallet,
      chain: row.chain,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      acquiredAt: row.acquired_at,
      acquiredTxId: row.acquired_tx_id,
      originalAmount: row.original_amount,
      remainingAmount: row.remaining_amount,
      costBasisUsd: row.cost_basis_usd,
      costBasisPerUnit: row.cost_basis_per_unit,
      method: row.method,
      closed: row.closed === 1,
      closedAt: row.closed_at ?? undefined,
      closedTxId: row.closed_tx_id ?? undefined,
    };
  }

  // --- Bridge Legs ---

  async saveBridgeLeg(leg: BridgeLeg): Promise<void> {
    this.db.query(`
      INSERT OR REPLACE INTO bridge_legs (id, direction, chain, tx_hash, wallet, token_symbol, amount, protocol, timestamp, matched_leg_id, matched)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(leg.id, leg.direction, leg.chain, leg.txHash, leg.wallet, leg.tokenSymbol, leg.amount, leg.protocol, leg.timestamp, leg.matchedLegId ?? null, leg.matched ? 1 : 0);
  }

  async getUnmatchedBridgeLegs(wallet: string, opts?: { protocol?: string; within?: number }): Promise<BridgeLeg[]> {
    let sql = 'SELECT * FROM bridge_legs WHERE wallet = ? AND matched = 0';
    const params: any[] = [wallet];
    if (opts?.protocol) { sql += ' AND protocol = ?'; params.push(opts.protocol); }
    sql += ' ORDER BY timestamp ASC';
    const rows = this.db.query(sql).all(...params) as any[];
    return rows.map(this.rowToBridgeLeg);
  }

  async matchBridgeLegs(outboundId: string, inboundId: string): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db.query('UPDATE bridge_legs SET matched = 1, matched_leg_id = ? WHERE id = ?').run(inboundId, outboundId);
      this.db.query('UPDATE bridge_legs SET matched = 1, matched_leg_id = ? WHERE id = ?').run(outboundId, inboundId);
    });
    tx();
  }

  private rowToBridgeLeg(row: any): BridgeLeg {
    return {
      id: row.id,
      direction: row.direction,
      chain: row.chain,
      txHash: row.tx_hash,
      wallet: row.wallet,
      tokenSymbol: row.token_symbol,
      amount: row.amount,
      protocol: row.protocol,
      timestamp: row.timestamp,
      matchedLegId: row.matched_leg_id ?? undefined,
      matched: row.matched === 1,
    };
  }

  // --- Audit Log (append-only) ---

  async appendAuditLog(entry: AuditLogEntry): Promise<void> {
    this.db.query(`
      INSERT INTO audit_log (id, timestamp, event_type, transaction_id, wallet, chain, details, model_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.timestamp, entry.eventType, entry.transactionId ?? null, entry.wallet ?? null, entry.chain ?? null, JSON.stringify(entry.details), entry.modelVersion);
  }

  async getAuditLog(opts: { transactionId?: string; wallet?: string; eventType?: string; from?: number; to?: number }): Promise<AuditLogEntry[]> {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];
    if (opts.transactionId) { sql += ' AND transaction_id = ?'; params.push(opts.transactionId); }
    if (opts.wallet) { sql += ' AND wallet = ?'; params.push(opts.wallet); }
    if (opts.eventType) { sql += ' AND event_type = ?'; params.push(opts.eventType); }
    if (opts.from) { sql += ' AND timestamp >= ?'; params.push(opts.from); }
    if (opts.to) { sql += ' AND timestamp <= ?'; params.push(opts.to); }
    sql += ' ORDER BY timestamp ASC';
    const rows = this.db.query(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      eventType: r.event_type,
      transactionId: r.transaction_id ?? undefined,
      wallet: r.wallet ?? undefined,
      chain: r.chain ?? undefined,
      details: JSON.parse(r.details),
      modelVersion: r.model_version,
    }));
  }

  // --- Balance Snapshots ---

  async saveBalanceSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    this.db.query(`
      INSERT OR REPLACE INTO balance_snapshots (id, wallet, chain, token_address, token_symbol, balance, balance_usd, timestamp, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(snapshot.id, snapshot.wallet, snapshot.chain, snapshot.tokenAddress, snapshot.tokenSymbol, snapshot.balance, snapshot.balanceUsd, snapshot.timestamp, snapshot.source);
  }

  async getLatestSnapshot(wallet: string, chain: ChainId, tokenAddress: string): Promise<BalanceSnapshot | null> {
    const row = this.db.query(
      'SELECT * FROM balance_snapshots WHERE wallet = ? AND chain = ? AND token_address = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(wallet, chain, tokenAddress) as any;
    if (!row) return null;
    return {
      id: row.id,
      wallet: row.wallet,
      chain: row.chain,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      balance: row.balance,
      balanceUsd: row.balance_usd,
      timestamp: row.timestamp,
      source: row.source,
    };
  }

  // --- Reconciliation Reports ---

  async saveReconciliationReport(report: ReconciliationReport): Promise<void> {
    const id = randomUUID();
    this.db.query(`
      INSERT INTO reconciliation_reports (id, wallet, chain, timestamp, ledger_balance, on_chain_balance, discrepancies, bridge_legs_matched, bridge_legs_unmatched, rebasing_adjustments, status, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, report.wallet, report.chain, report.timestamp, JSON.stringify(report.ledgerBalance), JSON.stringify(report.onChainBalance), JSON.stringify(report.discrepancies), report.bridgeLegsMatched, report.bridgeLegsUnmatched, JSON.stringify(report.rebasingAdjustments), report.status, report.summary);
  }

  async getLatestReconciliationReport(wallet: string, chain: ChainId): Promise<ReconciliationReport | null> {
    const row = this.db.query(
      'SELECT * FROM reconciliation_reports WHERE wallet = ? AND chain = ? ORDER BY timestamp DESC LIMIT 1'
    ).get(wallet, chain) as any;
    if (!row) return null;
    return {
      timestamp: row.timestamp,
      wallet: row.wallet,
      chain: row.chain,
      ledgerBalance: JSON.parse(row.ledger_balance),
      onChainBalance: JSON.parse(row.on_chain_balance),
      discrepancies: JSON.parse(row.discrepancies),
      bridgeLegsMatched: row.bridge_legs_matched,
      bridgeLegsUnmatched: row.bridge_legs_unmatched,
      rebasingAdjustments: JSON.parse(row.rebasing_adjustments),
      status: row.status,
      summary: row.summary,
    };
  }

  // --- Wallet State ---

  async saveWalletState(state: WalletChainState): Promise<void> {
    this.db.query(`
      INSERT OR REPLACE INTO wallet_state (wallet, chain, last_processed_block, last_processed_timestamp, last_processed_signature, transaction_count, error_count, last_error, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(state.wallet, state.chain, state.lastProcessedBlock, state.lastProcessedTimestamp, state.lastProcessedSignature ?? null, state.transactionCount, state.errorCount, state.lastError ?? null, Math.floor(Date.now() / 1000));
  }

  async getWalletState(wallet: string, chain: ChainId): Promise<WalletChainState | null> {
    const row = this.db.query('SELECT * FROM wallet_state WHERE wallet = ? AND chain = ?').get(wallet, chain) as any;
    if (!row) return null;
    return {
      wallet: row.wallet,
      chain: row.chain,
      lastProcessedBlock: row.last_processed_block,
      lastProcessedTimestamp: row.last_processed_timestamp,
      lastProcessedSignature: row.last_processed_signature ?? undefined,
      transactionCount: row.transaction_count,
      errorCount: row.error_count,
      lastError: row.last_error ?? undefined,
    };
  }

  async getAllWalletStates(): Promise<WalletChainState[]> {
    const rows = this.db.query('SELECT * FROM wallet_state').all() as any[];
    return rows.map((r) => ({
      wallet: r.wallet,
      chain: r.chain,
      lastProcessedBlock: r.last_processed_block,
      lastProcessedTimestamp: r.last_processed_timestamp,
      lastProcessedSignature: r.last_processed_signature ?? undefined,
      transactionCount: r.transaction_count,
      errorCount: r.error_count,
      lastError: r.last_error ?? undefined,
    }));
  }

  // --- Price Cache ---

  async cachePrice(chain: ChainId, tokenAddress: string, timestamp: number, priceUsd: string, source: string): Promise<void> {
    const bucket = bucketTimestamp(timestamp);
    this.db.query(`
      INSERT OR REPLACE INTO price_cache (chain, token_address, timestamp_bucket, price_usd, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(chain, tokenAddress, bucket, priceUsd, source);
  }

  async getCachedPrice(chain: ChainId, tokenAddress: string, timestamp: number, bucketSeconds?: number): Promise<{ priceUsd: string; source: string } | null> {
    const bucket = bucketTimestamp(timestamp);
    const row = this.db.query(
      'SELECT price_usd, source FROM price_cache WHERE chain = ? AND token_address = ? AND timestamp_bucket = ?'
    ).get(chain, tokenAddress, bucket) as any;
    if (!row) return null;
    return { priceUsd: row.price_usd, source: row.source };
  }

  // --- Human Overrides ---

  async saveOverride(override: HumanOverride): Promise<void> {
    this.db.query(`
      INSERT INTO human_overrides (transaction_id, previous_type, new_type, reason, overridden_by, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(override.transactionId, override.previousType, override.newType, override.reason, override.overriddenBy, override.timestamp);
  }

  async getOverrides(transactionId: string): Promise<HumanOverride[]> {
    const rows = this.db.query('SELECT * FROM human_overrides WHERE transaction_id = ? ORDER BY timestamp ASC').all(transactionId) as any[];
    return rows.map((r) => ({
      transactionId: r.transaction_id,
      previousType: r.previous_type,
      newType: r.new_type,
      reason: r.reason,
      overriddenBy: r.overridden_by,
      timestamp: r.timestamp,
    }));
  }
}
