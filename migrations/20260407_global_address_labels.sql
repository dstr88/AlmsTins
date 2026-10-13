-- global_address_label_votes: one row per (tenant × address)
-- records what each user independently labeled an address
CREATE TABLE IF NOT EXISTS global_address_label_votes (
  id          TEXT    NOT NULL PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  address     TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (tenant_id, address)
);

CREATE INDEX IF NOT EXISTS idx_galv_address
  ON global_address_label_votes (address);

-- global_address_labels: promoted labels visible to all users
-- promoted when 3 independent users agree; updated when 5 agree on a correction
CREATE TABLE IF NOT EXISTS global_address_labels (
  address      TEXT    NOT NULL PRIMARY KEY,
  label        TEXT    NOT NULL,
  vote_count   INTEGER NOT NULL DEFAULT 0,
  promoted_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
