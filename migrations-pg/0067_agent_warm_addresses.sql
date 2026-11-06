-- Agent Vault warm-address cache (Nov 5, 2026): per account, the last addresses (at most ten) whose
-- keyed pre-send check passed a fresh screening, so a check on one of them within ten minutes of its
-- last use reuses that screening instead of asking the sources again. Any flag evicts the address:
-- evicted_at is set, the row is kept (the Vault deletes no rows), and an evicted row is never used.
--
-- Also run lazily at runtime (ensureWarmCacheTable in src/lib/agentVault/warmCache.ts); this file is
-- the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS agent_warm_addresses (
  tenant_id    TEXT NOT NULL,
  address      TEXT NOT NULL,
  screened_at  TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  evicted_at   TEXT,
  PRIMARY KEY (tenant_id, address)
);

CREATE INDEX IF NOT EXISTS idx_agent_warm_addresses_used ON agent_warm_addresses (tenant_id, last_used_at);
