-- Agent Vault watcher bookkeeping (owner-only for now): where the daily read of the chain left off,
-- one row per pair of an agent wallet and a watched destination. A cursor says "every transfer
-- between this wallet and this destination up to this time has been read". It is not evidence (the
-- ledger, agent_events, is the record): a lost or rewound cursor only makes the next read longer,
-- because a transfer already in the ledger is never written twice.
--
-- Also created lazily at runtime (ensureAgentWatchTables in src/lib/agentVault/watchState.ts); this
-- file is the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS agent_watch_cursors (
  tenant_id      TEXT NOT NULL,
  tin_id         TEXT NOT NULL,
  wallet_id      TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  through_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (tenant_id, wallet_id, destination_id)
);
