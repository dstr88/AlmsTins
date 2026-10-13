CREATE TABLE IF NOT EXISTS asset_lifecycle_groups (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	asset_symbol TEXT NOT NULL,
	total_quantity REAL NOT NULL DEFAULT 0,
	weighted_avg_cost_usd REAL NOT NULL DEFAULT 0,
	latest_acquired_at TEXT,
	created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS asset_lifecycle_groups_tenant_asset_idx
	ON asset_lifecycle_groups (tenant_id, asset_symbol);

CREATE TABLE IF NOT EXISTS asset_lifecycle_events (
	id TEXT PRIMARY KEY,
	tenant_id TEXT NOT NULL,
	group_id TEXT NOT NULL,
	source_type TEXT NOT NULL,
	source_id TEXT NOT NULL,
	timestamp_utc TEXT NOT NULL,
	direction TEXT,
	amount REAL,
	native_usd REAL,
	tx_hash TEXT,
	exchange_withdrawal_id TEXT,
	transaction_class TEXT NOT NULL DEFAULT 'other',
	linked_transfer INTEGER NOT NULL DEFAULT 0,
	confidence REAL,
	created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS asset_lifecycle_events_group_idx
	ON asset_lifecycle_events (tenant_id, group_id);

CREATE INDEX IF NOT EXISTS asset_lifecycle_events_time_idx
	ON asset_lifecycle_events (tenant_id, timestamp_utc);

ALTER TABLE import_transactions ADD COLUMN exchange_withdrawal_id TEXT;
