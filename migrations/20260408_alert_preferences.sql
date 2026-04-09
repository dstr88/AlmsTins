-- Health factor alert preferences — one row per wallet per user.
-- wallet_id NULL means "apply to all wallets for this user".
CREATE TABLE IF NOT EXISTS alert_preferences (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL,
  wallet_id    TEXT,                              -- NULL = all wallets
  threshold    REAL    NOT NULL DEFAULT 1.5,      -- health factor trigger
  direction    TEXT    NOT NULL DEFAULT 'below',  -- 'below' | 'above'
  enabled      INTEGER NOT NULL DEFAULT 1,
  last_alerted_at TEXT,                           -- ISO timestamp, rate-limit guard
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id)   REFERENCES auth_users(id) ON DELETE CASCADE,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id)    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS alert_preferences_user_id   ON alert_preferences(user_id);
CREATE INDEX IF NOT EXISTS alert_preferences_wallet_id ON alert_preferences(wallet_id);
CREATE UNIQUE INDEX IF NOT EXISTS alert_preferences_user_wallet
  ON alert_preferences(user_id, COALESCE(wallet_id, ''));
