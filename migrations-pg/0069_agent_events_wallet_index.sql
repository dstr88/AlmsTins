-- Agentics, the wallet windows (Nov 5, 2026): the index the Wallets page reads the ledger by. Each of an
-- agent's own wallets has two windows, what it received and what it sent, newest first, so the page asks
-- for one agent's transfers of one wallet in one direction, by time.
--
-- Also run lazily at runtime, once per process, when a wallet window is first read (ensureWalletIndex in
-- src/lib/agentVault/events.ts, with a two second lock timeout); this file is the durable mirror, and
-- tests/agentics/guards.test.ts keeps the two identical. Run it by hand before the ledger is large: the
-- build holds off the table's writers while it runs. Safe to run more than once. Nothing here reads or
-- changes a row.
CREATE INDEX IF NOT EXISTS agent_events_wallet_transfers ON agent_events (tenant_id, tin_id, wallet, direction, occurred_at, id) WHERE kind = 'transaction';
