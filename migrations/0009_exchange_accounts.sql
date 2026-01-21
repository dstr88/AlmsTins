CREATE TABLE IF NOT EXISTS exchange_accounts (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	source TEXT NOT NULL,
	name TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS exchange_accounts_tenant_source_idx
	ON exchange_accounts (tenant_id, source);

ALTER TABLE import_raw_rows ADD COLUMN account_id TEXT;
ALTER TABLE import_transactions ADD COLUMN account_id TEXT;

DROP INDEX IF EXISTS import_raw_rows_tenant_hash_unique;
DROP INDEX IF EXISTS import_transactions_tenant_hash_unique;

CREATE UNIQUE INDEX IF NOT EXISTS import_raw_rows_tenant_account_hash_unique
	ON import_raw_rows (tenant_id, account_id, row_hash);

CREATE UNIQUE INDEX IF NOT EXISTS import_transactions_tenant_account_hash_unique
	ON import_transactions (tenant_id, account_id, row_hash);

CREATE INDEX IF NOT EXISTS import_raw_rows_account_idx
	ON import_raw_rows (tenant_id, account_id);

CREATE INDEX IF NOT EXISTS import_transactions_account_idx
	ON import_transactions (tenant_id, account_id);
