-- Price alert preferences
-- One row per user per asset per direction.
-- Users can set "BTC above $100k" or "ETH below $2k", etc.

CREATE TABLE IF NOT EXISTS price_alert_preferences (
	id             TEXT    PRIMARY KEY,
	user_id        TEXT    NOT NULL,
	tenant_id      TEXT    NOT NULL,
	asset_symbol   TEXT    NOT NULL,           -- e.g. 'BTC', 'ETH'
	direction      TEXT    NOT NULL DEFAULT 'above',  -- 'above' | 'below'
	threshold      REAL    NOT NULL,
	enabled        INTEGER NOT NULL DEFAULT 1,
	last_alerted_at TEXT,
	created_at     TEXT    NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	updated_at     TEXT    NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS price_alert_prefs_user_idx
	ON price_alert_preferences (user_id);

CREATE INDEX IF NOT EXISTS price_alert_prefs_tenant_idx
	ON price_alert_preferences (tenant_id, enabled);
