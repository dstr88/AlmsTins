-- Agent Vault ledger (owner-only for now): a dated, append-only record of what happened on one
-- tin. Two kinds of event. `checked`: an agent asked, through its key, whether it may send to an
-- address, and what it was answered. `transaction`: the chain confirmed funds moving between the
-- agent's own wallet and a trusted, registered destination (amount, asset, USD at the time, and
-- the verify-status inherited from the check that came before). Rows are only ever inserted: a
-- correction is a new event, and a row leaves only when the whole account is removed
-- (src/lib/accountDeleteTables.ts).
--
-- A transfer is written at most once: its id is derived from the tenant, tin, chain, transaction
-- hash and leg (transactionEventId in src/lib/agentVault/events.ts) and the insert skips an id
-- that exists. The table-level CHECK keeps a `transaction` row from being stored without its facts.
--
-- Also created lazily at runtime (ensureAgentEventsTable in src/lib/agentVault/events.ts); this
-- file is the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS agent_events (
  id             TEXT NOT NULL PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  tin_id         TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('checked', 'transaction')),
  address        TEXT NOT NULL,
  chain          TEXT,
  answer         TEXT CHECK (answer IN ('proven', 'consistent-with-history', 'flagged', 'unknown')),
  registry       TEXT CHECK (registry IN ('trusted', 'flagged', 'pending', 'none')),
  status         TEXT,
  key_id         TEXT,
  source_ip      TEXT,
  tx_hash        TEXT,
  direction      TEXT CHECK (direction IN ('in', 'out')),
  wallet         TEXT,
  amount         TEXT,
  asset          TEXT,
  asset_contract TEXT,
  usd_value      DOUBLE PRECISION,
  block_number   INTEGER,
  detail_json    TEXT,
  occurred_at    TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  CHECK (kind <> 'transaction' OR (chain IS NOT NULL AND tx_hash IS NOT NULL AND direction IS NOT NULL AND wallet IS NOT NULL AND amount IS NOT NULL AND asset IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS agent_events_tin_time ON agent_events (tenant_id, tin_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS agent_events_tin_address ON agent_events (tenant_id, tin_id, address, occurred_at);
CREATE INDEX IF NOT EXISTS agent_events_tin_transactions ON agent_events (tenant_id, tin_id, occurred_at, id) WHERE kind = 'transaction';
