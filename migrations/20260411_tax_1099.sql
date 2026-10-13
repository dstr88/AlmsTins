-- 1099-DA / 1099-B uploads for tax reconciliation

CREATE TABLE IF NOT EXISTS tax_1099_uploads (
	id            TEXT    PRIMARY KEY,
	tenant_id     TEXT    NOT NULL,
	user_id       TEXT    NOT NULL,
	form_type     TEXT    NOT NULL DEFAULT '1099-da',  -- '1099-da' | '1099-b'
	exchange_name TEXT,                                 -- e.g. 'Coinbase', 'Kraken'
	tax_year      INTEGER NOT NULL,
	filename      TEXT    NOT NULL,
	status        TEXT    NOT NULL DEFAULT 'pending',  -- 'pending' | 'parsed' | 'error'
	row_count     INTEGER,
	raw_csv       TEXT,
	parsed_json   TEXT,                                -- JSON array of parsed rows
	error_msg     TEXT,
	created_at    TEXT    NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS tax_1099_uploads_tenant_idx
	ON tax_1099_uploads (tenant_id, tax_year);

-- Reconciliation results: one row per transaction matched/unmatched
CREATE TABLE IF NOT EXISTS tax_1099_reconciliation (
	id                TEXT    PRIMARY KEY,
	upload_id         TEXT    NOT NULL REFERENCES tax_1099_uploads(id) ON DELETE CASCADE,
	tenant_id         TEXT    NOT NULL,
	-- 1099 side
	form_asset        TEXT,
	form_proceeds_usd REAL,
	form_cost_basis   REAL,
	form_acquired_at  TEXT,
	form_disposed_at  TEXT,
	-- almstins computed side
	computed_proceeds REAL,
	computed_basis    REAL,
	computed_gain     REAL,
	-- match status
	match_status      TEXT    NOT NULL DEFAULT 'unmatched',  -- 'matched' | 'basis_diff' | 'proceeds_diff' | 'unmatched' | 'extra'
	delta_proceeds    REAL,  -- form_proceeds - computed_proceeds
	delta_basis       REAL,  -- form_basis    - computed_basis
	notes             TEXT,
	created_at        TEXT    NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS tax_1099_recon_upload_idx
	ON tax_1099_reconciliation (upload_id);

CREATE INDEX IF NOT EXISTS tax_1099_recon_tenant_idx
	ON tax_1099_reconciliation (tenant_id);
