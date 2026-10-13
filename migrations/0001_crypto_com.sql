CREATE TABLE IF NOT EXISTS import_raw_rows (
	id TEXT PRIMARY KEY,
	source TEXT NOT NULL,
	import_batch_id TEXT NOT NULL,
	row_json TEXT NOT NULL,
	row_hash TEXT NOT NULL UNIQUE,
	imported_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_import_raw_rows_source_imported_at
	ON import_raw_rows (source, imported_at);

CREATE INDEX IF NOT EXISTS idx_import_raw_rows_source_batch
	ON import_raw_rows (source, import_batch_id);

CREATE TABLE IF NOT EXISTS import_transactions (
	id TEXT PRIMARY KEY,
	source TEXT NOT NULL,
	import_batch_id TEXT NOT NULL,
	timestamp_utc TEXT NOT NULL,
	description TEXT,
	currency TEXT,
	amount REAL,
	to_currency TEXT,
	to_amount REAL,
	native_currency TEXT,
	native_amount REAL,
	native_usd REAL,
	kind TEXT,
	tx_hash TEXT,
	direction TEXT NOT NULL,
	asset_symbol TEXT,
	row_hash TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_import_transactions_source_time
	ON import_transactions (source, timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_import_transactions_source_symbol
	ON import_transactions (source, asset_symbol);

CREATE INDEX IF NOT EXISTS idx_import_transactions_source_tx_hash
	ON import_transactions (source, tx_hash);
