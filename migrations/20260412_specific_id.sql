-- Specific Identification lot pins
-- When a user selects Spec ID method, they pin a disposal → lot pair.
-- The engine checks this table before falling back to FIFO.

CREATE TABLE IF NOT EXISTS tax_lot_pins (
	id              TEXT    PRIMARY KEY,
	tenant_id       TEXT    NOT NULL,
	user_id         TEXT    NOT NULL,
	tax_year        INTEGER NOT NULL,
	-- Disposal identifier (source_id from asset_lifecycle_events)
	disposal_source_id TEXT NOT NULL,
	-- Lot identifier (acquired timestamp + amount hint for fuzzy match)
	lot_acquired_at    TEXT NOT NULL,
	lot_amount_hint    REAL NOT NULL DEFAULT 0,
	-- Human-readable note (e.g. "Ledger hardware wallet lot")
	note            TEXT,
	created_at      TEXT    NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	updated_at      TEXT    NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	UNIQUE (tenant_id, disposal_source_id)
);

CREATE INDEX IF NOT EXISTS tax_lot_pins_tenant_year_idx
	ON tax_lot_pins (tenant_id, tax_year);
