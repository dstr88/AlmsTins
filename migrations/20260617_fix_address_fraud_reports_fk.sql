-- Corrective migration for 20260611_address_fraud_reports.sql, which declared
--   FOREIGN KEY (tenant_id) REFERENCES auth_users(id)
-- tenant_id is a tenant UUID (tenants.id), NOT a user id. With
-- PRAGMA foreign_keys = ON the fraud-counter INSERT in
-- /api/address-labels/mark-fraudulent fails the FK check, so the feature can
-- never write. SQLite cannot ALTER a foreign key in place, so the table must be
-- rebuilt.
--
-- The migration runner (src/scripts/dbMigrate.mjs) skips migration files already
-- recorded in schema_migrations, so editing 20260611 alone cannot repair an
-- environment that already applied the buggy version — hence this NEW file.
--
-- Safe to drop+recreate: the table holds only per-tenant fraud-report counters
-- (no financial data) and the feature has never successfully written a row.

DROP TABLE IF EXISTS address_fraud_reports;

CREATE TABLE address_fraud_reports (
  tenant_id TEXT NOT NULL,
  address TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  last_reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, address),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_afr_tenant_address ON address_fraud_reports(tenant_id, address);
