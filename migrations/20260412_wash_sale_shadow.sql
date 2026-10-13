-- Persisted wash sale shadow tracker
-- Stores what would be disallowed losses under proposed crypto wash sale rules.
-- Crypto is currently exempt (IRS property classification) — this table is
-- pre-emptive: when legislation passes, we flip the display from "shadow" to
-- authoritative and begin adjusting cost basis from these stored rows.
--
-- Written by /api/tax/summary on every request when tax_disposals data exists.
-- Replaces the prior run's rows for the same tenant + year (DELETE + INSERT).

CREATE TABLE IF NOT EXISTS tax_wash_sales (
  id                  TEXT    PRIMARY KEY,
  tenant_id           TEXT    NOT NULL,
  tax_year            INTEGER NOT NULL,
  asset_symbol        TEXT    NOT NULL,
  disposed_at         TEXT    NOT NULL,
  loss_amount_usd     REAL    NOT NULL,  -- negative value
  trigger_acquired_at TEXT    NOT NULL,  -- repurchase date within 30-day window
  disallowed_loss_usd REAL    NOT NULL,  -- ABS(loss_amount_usd) — would be added back to basis
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wash_sales_tenant_year
  ON tax_wash_sales (tenant_id, tax_year);
