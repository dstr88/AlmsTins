-- Create address_fraud_reports table for tenant-scoped fraud signals
CREATE TABLE IF NOT EXISTS address_fraud_reports (
  tenant_id TEXT NOT NULL,
  address TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  last_reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, address),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_afr_tenant_address ON address_fraud_reports(tenant_id, address);

-- Per-tenant product settings for the auto-add-addresses feature. This table was
-- previously assumed to exist (no migration ever created it), so the ALTER below
-- failed on a fresh database. Create it here, keyed by tenant_id to match
-- src/lib/autoAddPaymentAddresses.ts.
CREATE TABLE IF NOT EXISTS user_settings (
  tenant_id TEXT NOT NULL PRIMARY KEY,
  auto_add_addresses INTEGER NOT NULL DEFAULT 1
);

-- Add auto_add_addresses setting to user_settings (no-op if the CREATE above
-- already added it; the migration runner skips "duplicate column" errors).
-- Default 1 (enabled) for paid users, 0 (disabled) for free users.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS auto_add_addresses INTEGER NOT NULL DEFAULT 1;
