-- Agent Vault watcher bookkeeping, slice 8 ("every outflow"): where the read of the chain left off,
-- one row per agent wallet. A cursor says "every transfer of this wallet up to this time has been
-- read". It replaces the per-pair cursor of 0052 (agent_watch_cursors), which is kept and no longer
-- written: a wallet's first read under this table starts from the oldest of its pair cursors, or from
-- the wallet's registration when it has none. Not evidence (the ledger, agent_events, is the record):
-- a lost or rewound cursor only makes the next read longer, because a transfer already in the ledger
-- is never written twice.
--
-- Also created lazily at runtime (ensureAgentWatchTables in src/lib/agentVault/watchState.ts); this
-- file is the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS agent_wallet_cursors (
  tenant_id      TEXT NOT NULL,
  tin_id         TEXT NOT NULL,
  wallet_id      TEXT NOT NULL,
  through_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (tenant_id, wallet_id)
);
