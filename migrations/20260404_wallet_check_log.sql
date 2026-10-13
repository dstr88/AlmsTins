-- Tracks wallet checker usage.
-- Raw addresses are NEVER stored — only SHA-256 hashes salted server-side.
-- ip_hash   : hashed client IP (same salt as request_log)
-- addr_hash : hashed wallet address (allows per-user unique address counts)

CREATE TABLE IF NOT EXISTS wallet_check_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL,
  ip_hash    TEXT    NOT NULL,
  addr_hash  TEXT    NOT NULL,
  chain      TEXT    NOT NULL DEFAULT 'unknown',
  cache_hit  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_wcl_created_at ON wallet_check_log(created_at);
CREATE INDEX IF NOT EXISTS idx_wcl_ip_hash    ON wallet_check_log(ip_hash);
