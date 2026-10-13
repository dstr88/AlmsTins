-- Reconciliation notes: one note per tenant per asset symbol.
-- Users can flag assets for support when they can't explain a discrepancy.

CREATE TABLE IF NOT EXISTS reconciliation_notes (
  id                  TEXT    NOT NULL,
  tenant_id           TEXT    NOT NULL,
  asset_symbol        TEXT    NOT NULL,
  note                TEXT,
  flagged_for_support INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (id),
  UNIQUE (tenant_id, asset_symbol)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_notes_tenant
  ON reconciliation_notes (tenant_id);
