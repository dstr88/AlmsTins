-- Vault notepad: scratch notes per tenant for unaccounted transactions/events.
-- Notes persist until the user resolves or deletes them.

CREATE TABLE IF NOT EXISTS vault_notes (
  id          TEXT NOT NULL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_vault_notes_tenant ON vault_notes (tenant_id, created_at DESC);
