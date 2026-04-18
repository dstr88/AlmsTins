-- Monthly digest: one row per tenant per month, summarising flagged transactions.
--
-- The cron job at /api/cron/monthly-digest runs on the 1st of each month,
-- queries the prior calendar month's tax_review_items and unmatched transfers,
-- and upserts a row here.  The vault shows a pill when item_count > 0 and
-- dismissed_at IS NULL.

CREATE TABLE IF NOT EXISTS monthly_digests (
  id            TEXT    NOT NULL PRIMARY KEY,
  tenant_id     TEXT    NOT NULL,
  year_month    TEXT    NOT NULL,  -- 'YYYY-MM'
  item_count    INTEGER NOT NULL DEFAULT 0,
  items_json    TEXT    NOT NULL DEFAULT '[]',
  computed_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  dismissed_at  TEXT,
  UNIQUE (tenant_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_digests_tenant
  ON monthly_digests (tenant_id, year_month DESC);
