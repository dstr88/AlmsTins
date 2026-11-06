-- Agent Vault alert settings (Nov 5, 2026): whether an account is emailed when a pre-send check comes
-- back "established" (the API's consistent-with-history: the same address this agent asked about
-- before). Off by default. Every other answer that is not proven is emailed with no switch, so the
-- older `alerts` column (the opt-in for flagged-check emails) is no longer read; it is kept.
--
-- Also run lazily at runtime (ensureAgentDeliveryTables in src/lib/agentVault/deliveryStore.ts); this
-- file is the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
ALTER TABLE agent_report_settings ADD COLUMN IF NOT EXISTS established_alerts INTEGER NOT NULL DEFAULT 0;
