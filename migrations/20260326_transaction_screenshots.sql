CREATE TABLE IF NOT EXISTS transaction_screenshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  chain TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_screenshots_lookup
  ON transaction_screenshots (tenant_id, tx_hash, chain);
