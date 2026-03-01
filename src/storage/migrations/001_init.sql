-- ReconAgent schema v1
-- All monetary values stored as TEXT (decimal strings, never floats)

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_timestamp INTEGER NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  wallet TEXT NOT NULL,
  type TEXT NOT NULL,
  sub_type TEXT,
  protocol TEXT,
  tokens_in TEXT NOT NULL, -- JSON array of PricedTokenAmount
  tokens_out TEXT NOT NULL, -- JSON array of PricedTokenAmount
  gas_fee TEXT NOT NULL, -- JSON PricedTokenAmount
  gas_capitalized INTEGER NOT NULL DEFAULT 0,
  classification TEXT NOT NULL, -- JSON ClassificationAudit
  raw_data TEXT NOT NULL, -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tx_wallet_chain ON transactions(wallet, chain);
CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(chain, block_number);
CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transactions(block_timestamp);
CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(tx_hash);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  date TEXT NOT NULL, -- YYYY-MM-DD
  timestamp INTEGER NOT NULL,
  memo TEXT NOT NULL,
  lines TEXT NOT NULL, -- JSON array of JournalLine
  metadata TEXT NOT NULL, -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

CREATE INDEX IF NOT EXISTS idx_je_tx ON journal_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_je_date ON journal_entries(date);

CREATE TABLE IF NOT EXISTS tax_lots (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  acquired_tx_id TEXT NOT NULL,
  original_amount TEXT NOT NULL,
  remaining_amount TEXT NOT NULL,
  cost_basis_usd TEXT NOT NULL,
  cost_basis_per_unit TEXT NOT NULL,
  method TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER,
  closed_tx_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_lots_wallet_token ON tax_lots(wallet, token_address, chain, closed);
CREATE INDEX IF NOT EXISTS idx_lots_acquired ON tax_lots(acquired_at);

CREATE TABLE IF NOT EXISTS bridge_legs (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL, -- 'outbound' or 'inbound'
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  wallet TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  amount TEXT NOT NULL,
  protocol TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  matched_leg_id TEXT,
  matched INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_bridge_wallet ON bridge_legs(wallet, matched);
CREATE INDEX IF NOT EXISTS idx_bridge_protocol ON bridge_legs(protocol, timestamp);

-- Append-only audit log — NO UPDATE OR DELETE triggers enforced
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  transaction_id TEXT,
  wallet TEXT,
  chain TEXT,
  details TEXT NOT NULL, -- JSON
  model_version TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_audit_tx ON audit_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

-- Trigger to prevent UPDATE on audit_log
CREATE TRIGGER IF NOT EXISTS audit_log_no_update
  BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: UPDATE not allowed');
END;

-- Trigger to prevent DELETE on audit_log
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
  BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only: DELETE not allowed');
END;

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  balance TEXT NOT NULL,
  balance_usd TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  source TEXT NOT NULL, -- 'onchain' or 'ledger'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_snap_wallet ON balance_snapshots(wallet, chain, token_address);
CREATE INDEX IF NOT EXISTS idx_snap_timestamp ON balance_snapshots(timestamp);

CREATE TABLE IF NOT EXISTS reconciliation_reports (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  chain TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  ledger_balance TEXT NOT NULL, -- JSON
  on_chain_balance TEXT NOT NULL, -- JSON
  discrepancies TEXT NOT NULL, -- JSON
  bridge_legs_matched INTEGER NOT NULL,
  bridge_legs_unmatched INTEGER NOT NULL,
  rebasing_adjustments TEXT NOT NULL, -- JSON
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_recon_wallet ON reconciliation_reports(wallet, chain);
CREATE INDEX IF NOT EXISTS idx_recon_timestamp ON reconciliation_reports(timestamp);

CREATE TABLE IF NOT EXISTS wallet_state (
  wallet TEXT NOT NULL,
  chain TEXT NOT NULL,
  last_processed_block INTEGER NOT NULL DEFAULT 0,
  last_processed_timestamp INTEGER NOT NULL DEFAULT 0,
  last_processed_signature TEXT,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (wallet, chain)
);

CREATE TABLE IF NOT EXISTS price_cache (
  chain TEXT NOT NULL,
  token_address TEXT NOT NULL,
  timestamp_bucket INTEGER NOT NULL, -- rounded to 5-minute intervals
  price_usd TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (chain, token_address, timestamp_bucket)
);

CREATE TABLE IF NOT EXISTS human_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id TEXT NOT NULL,
  previous_type TEXT NOT NULL,
  new_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  overridden_by TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_override_tx ON human_overrides(transaction_id);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
