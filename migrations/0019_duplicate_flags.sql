-- ─────────────────────────────────────────────────────────────────────────────
-- 0019_duplicate_flags.sql
--
-- Adds duplicate-detection columns to both transaction tables so the sweep
-- can mark rows before they reach any view.
--
--   is_duplicate  0 = clean row (default)
--                 1 = auto-flagged as duplicate
--                 2 = user confirmed duplicate
--                -1 = user confirmed NOT a duplicate (override)
--
--   duplicate_of  id of the row that should be KEPT instead
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE import_transactions ADD COLUMN is_duplicate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_transactions ADD COLUMN duplicate_of  TEXT;

ALTER TABLE transactions ADD COLUMN is_duplicate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN duplicate_of  TEXT;

-- Index for fast "give me only clean rows" queries
CREATE INDEX IF NOT EXISTS idx_import_transactions_not_dup
  ON import_transactions (tenant_id, is_duplicate);

CREATE INDEX IF NOT EXISTS idx_transactions_not_dup
  ON transactions (tenant_id, is_duplicate);
