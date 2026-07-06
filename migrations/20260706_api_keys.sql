CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT NOT NULL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  key_hash TEXT NOT NULL,
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  last_used_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS api_keys_tenant ON api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS api_keys_hash ON api_keys (key_hash);
