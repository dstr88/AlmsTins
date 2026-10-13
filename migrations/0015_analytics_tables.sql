CREATE TABLE IF NOT EXISTS request_agg_daily (
  day TEXT NOT NULL,
  route_key TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  country_code TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  ms_total INTEGER NOT NULL DEFAULT 0,
  ms_max INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route_key, method, status, country_code)
);

CREATE TABLE IF NOT EXISTS request_log (
  ts TEXT NOT NULL,
  route TEXT NOT NULL,
  route_key TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  country_code TEXT NOT NULL,
  wallet_address TEXT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_request_log_ts ON request_log(ts);
CREATE INDEX IF NOT EXISTS idx_request_log_route_key_ts ON request_log(route_key, ts);
CREATE INDEX IF NOT EXISTS idx_request_log_wallet_ts ON request_log(wallet_address, ts);

CREATE TABLE IF NOT EXISTS ip_geo_cache (
  ip_hash TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ip_geo_cache_updated ON ip_geo_cache(updated_at);
