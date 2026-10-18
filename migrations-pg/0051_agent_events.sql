-- Agent Vault ledger (owner-only for now): a dated, append-only record of what happened on one
-- tin. Slice 2 writes `checked` events (an agent asked, through its key, whether it may send to an
-- address, and what it was answered); `transaction` is reserved for the slice that watches a
-- registered destination receive the funds, and is allowed here because a CHECK constraint cannot
-- be changed later by the web role. Rows are only ever inserted: a correction is a new event, and a
-- row leaves only when the whole account is removed (src/lib/accountDeleteTables.ts).
--
-- Also created lazily at runtime (ensureAgentEventsTable in src/lib/agentVault/events.ts); this
-- file is the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS agent_events (
  id          TEXT NOT NULL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  tin_id      TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('checked', 'transaction')),
  address     TEXT NOT NULL,
  chain       TEXT,
  answer      TEXT CHECK (answer IN ('proven', 'consistent-with-history', 'flagged', 'unknown')),
  registry    TEXT CHECK (registry IN ('trusted', 'flagged', 'pending', 'none')),
  status      TEXT,
  key_id      TEXT,
  source_ip   TEXT,
  detail_json TEXT,
  occurred_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS agent_events_tin_time ON agent_events (tenant_id, tin_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS agent_events_tin_address ON agent_events (tenant_id, tin_id, address);
