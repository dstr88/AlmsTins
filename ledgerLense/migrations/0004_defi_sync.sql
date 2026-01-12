CREATE TABLE IF NOT EXISTS wallet_defi_sync (
	wallet_id TEXT PRIMARY KEY,
	last_defi_sync_at TEXT,
	interest_paid_total REAL NOT NULL DEFAULT 0,
	interest_earned_total REAL NOT NULL DEFAULT 0,
	net_interest_total REAL NOT NULL DEFAULT 0,
	health_payload TEXT,
	positions_payload TEXT,
	updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_wallet_defi_sync_updated
	ON wallet_defi_sync (updated_at);
