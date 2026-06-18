-- Tracks raw addresses and URLs checked via the public wallet/site checker.
-- No user linkage, no IP, no session data — just the address/domain and counts.
-- Powers the "checked N times" frequency signal and future community rating API.

CREATE TABLE IF NOT EXISTS address_checks (
  address     TEXT    PRIMARY KEY,
  chain       TEXT    NOT NULL DEFAULT 'unknown',
  check_count INTEGER NOT NULL DEFAULT 1,
  first_seen  TEXT    NOT NULL,
  last_seen   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS url_checks (
  domain      TEXT    PRIMARY KEY,
  check_count INTEGER NOT NULL DEFAULT 1,
  first_seen  TEXT    NOT NULL,
  last_seen   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ac_chain     ON address_checks(chain);
CREATE INDEX IF NOT EXISTS idx_ac_last_seen ON address_checks(last_seen);
CREATE INDEX IF NOT EXISTS idx_uc_last_seen ON url_checks(last_seen);
