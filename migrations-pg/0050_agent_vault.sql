-- Agent Vault (owner-only for now): one tin per agent, the agent's own wallets, and the
-- destinations each agent may send to. Every row is keyed by tenant_id and is deleted with the
-- account (src/lib/accountDeleteTables.ts). Rows are removed softly (deleted_at set), and each
-- unique index counts live rows only, so removing a destination frees its slot and keeps its row
-- as history.
--
-- Also created lazily at runtime (ensureAgentVaultTables in src/lib/agentVault/store.ts); this
-- file is the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS agent_tins (
  id           TEXT NOT NULL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  label        TEXT NOT NULL,
  agent_key_id TEXT,
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS agent_tins_tenant ON agent_tins (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tins_live_key ON agent_tins (tenant_id, agent_key_id) WHERE agent_key_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_wallets (
  id         TEXT NOT NULL PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  tin_id     TEXT NOT NULL,
  chain      TEXT NOT NULL,
  address    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_wallets_tin ON agent_wallets (tenant_id, tin_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_wallets_live ON agent_wallets (tenant_id, tin_id, chain, address) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS agent_destinations (
  id                TEXT NOT NULL PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  tin_id            TEXT NOT NULL,
  chain             TEXT NOT NULL,
  address           TEXT NOT NULL,
  label             TEXT,
  trust_status      TEXT NOT NULL DEFAULT 'pending' CHECK (trust_status IN ('trusted', 'flagged', 'pending')),
  trust_checked_at  TEXT,
  trust_detail_json TEXT,
  created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS agent_destinations_tin ON agent_destinations (tenant_id, tin_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_destinations_live ON agent_destinations (tenant_id, tin_id, chain, address) WHERE deleted_at IS NULL;
