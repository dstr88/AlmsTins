-- Transfer matching engine tables
-- transfer_matches: links a CEX withdrawal to a deposit on another source
-- address_labels:   maps raw addresses to human-readable names (built automatically)

CREATE TABLE IF NOT EXISTS transfer_matches (
  id                  TEXT    NOT NULL PRIMARY KEY,
  tenant_id           TEXT    NOT NULL,
  out_tx_id           TEXT    NOT NULL,   -- the sending transaction
  in_tx_id            TEXT    NOT NULL,   -- the receiving transaction
  asset_symbol        TEXT    NOT NULL,
  out_amount          REAL    NOT NULL,
  in_amount           REAL    NOT NULL,
  fee_amount          REAL,               -- detected network fee (out - in)
  confidence_score    INTEGER NOT NULL,   -- sum of signal points
  signals_json        TEXT    NOT NULL,   -- JSON array of { signal, points } that fired
  status              TEXT    NOT NULL DEFAULT 'auto',
    -- 'auto'      = engine matched, not yet reviewed
    -- 'confirmed' = user confirmed correct
    -- 'rejected'  = user said it is wrong
  matched_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  confirmed_at        TEXT,
  UNIQUE (tenant_id, out_tx_id, in_tx_id)
);

CREATE INDEX IF NOT EXISTS idx_transfer_matches_tenant
  ON transfer_matches (tenant_id);

CREATE INDEX IF NOT EXISTS idx_transfer_matches_out_tx
  ON transfer_matches (tenant_id, out_tx_id);

CREATE INDEX IF NOT EXISTS idx_transfer_matches_in_tx
  ON transfer_matches (tenant_id, in_tx_id);

CREATE INDEX IF NOT EXISTS idx_transfer_matches_status
  ON transfer_matches (tenant_id, status);

-- Address labels: built automatically from confirmed matches + user overrides
CREATE TABLE IF NOT EXISTS address_labels (
  id          TEXT    NOT NULL PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  address     TEXT    NOT NULL,           -- raw address or "cex:source:accountId"
  label       TEXT    NOT NULL,           -- human-readable name e.g. "Exodus wallet"
  source      TEXT    NOT NULL DEFAULT 'auto',
    -- 'auto' = derived from transfer match
    -- 'user' = user typed it manually
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (tenant_id, address)
);

CREATE INDEX IF NOT EXISTS idx_address_labels_tenant
  ON address_labels (tenant_id);
