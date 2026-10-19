-- Agentics, the live feed: the index it reads the ledger by. The feed asks "what has the Vault written
-- since I last looked", and a transfer is written minutes after its block, so it follows the table's own
-- created_at (the moment of writing) and not occurred_at (the moment it happened). One account's events in
-- the order they were written; a read for one agent filters on tin_id inside it.
--
-- Also run lazily at runtime, once per process, when the feed is first read (ensureFeedIndex in
-- src/lib/agentVault/events.ts, with a two second lock timeout); this file is the durable mirror, and
-- tests/agentics/guards.test.ts keeps the two identical. Safe to run more than once. Nothing here reads or
-- changes a row.
CREATE INDEX IF NOT EXISTS agent_events_tenant_written ON agent_events (tenant_id, created_at, id);
