CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_memberships_unique
  ON tenant_memberships(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS tenant_memberships_user_idx ON tenant_memberships(user_id);

ALTER TABLE auth_users ADD COLUMN active_tenant_id TEXT;
CREATE INDEX IF NOT EXISTS auth_users_active_tenant_idx ON auth_users(active_tenant_id);

ALTER TABLE wallets ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS wallets_tenant_idx ON wallets(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS wallets_tenant_address_unique ON wallets(tenant_id, address);

ALTER TABLE transactions ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS transactions_tenant_idx ON transactions(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_tenant_hash_chain_unique ON transactions(tenant_id, hash, chain);
DROP INDEX IF EXISTS transactions_hash_chain_unique;
DROP INDEX IF EXISTS transactions_hash_chain_idx;
DROP INDEX IF EXISTS idx_transactions_hash_chain;

ALTER TABLE transaction_annotations ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS transaction_annotations_tenant_idx ON transaction_annotations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS transaction_annotations_tenant_tx_unique
  ON transaction_annotations(tenant_id, transaction_id);

ALTER TABLE import_raw_rows ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS import_raw_rows_tenant_idx ON import_raw_rows(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS import_raw_rows_tenant_hash_unique ON import_raw_rows(tenant_id, row_hash);

ALTER TABLE import_transactions ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS import_transactions_tenant_idx ON import_transactions(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS import_transactions_tenant_hash_unique ON import_transactions(tenant_id, row_hash);

ALTER TABLE wallet_snapshots ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS wallet_snapshots_tenant_idx ON wallet_snapshots(tenant_id);

ALTER TABLE wallet_sync_state ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS wallet_sync_state_tenant_idx ON wallet_sync_state(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_sync_state_tenant_unique
  ON wallet_sync_state(tenant_id, wallet_id, chain);
DROP INDEX IF EXISTS wallet_sync_state_wallet_chain_unique;
DROP INDEX IF EXISTS idx_wallet_sync_state_wallet_chain;

ALTER TABLE wallet_defi_sync ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS wallet_defi_sync_tenant_idx ON wallet_defi_sync(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_defi_sync_tenant_wallet_unique
  ON wallet_defi_sync(tenant_id, wallet_id);

ALTER TABLE tradfi_loan_payments ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS tradfi_loan_payments_tenant_idx ON tradfi_loan_payments(tenant_id);

ALTER TABLE users ADD COLUMN tenant_id TEXT;
CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);

UPDATE wallets SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE transactions SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE transaction_annotations SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE import_raw_rows SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE import_transactions SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE wallet_snapshots SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE wallet_sync_state SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE wallet_defi_sync SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE tradfi_loan_payments SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE users SET tenant_id = 'default' WHERE tenant_id IS NULL;

INSERT OR IGNORE INTO tenants (id, name, created_at)
  VALUES ('default', 'Default Tenant', CURRENT_TIMESTAMP);
