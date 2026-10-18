-- Agent Vault operator reports (owner-only for now): a dated, append-only snapshot of what one tin's
-- ledger (agent_events) said about one UTC day, sorted into the operator's four buckets with the
-- bought and sold strip. A report is a SNAPSHOT of what the Vault had recorded when it was made
-- (generated_at). The ledger can still grow for a day after its report was made, so making the
-- same day again is a NEW version: older versions stay, nothing is rewritten, and the newest one is
-- the one the Reports page shows. Rows are only ever inserted, and a row leaves only when the whole
-- account is removed (src/lib/accountDeleteTables.ts).
--
-- (tenant_id, tin_id, period_start, version) is unique, so two reports being made at once cannot
-- both take the same version: exactly one of them writes it. content_hash is the hash of the
-- report's content, so making a report whose content has not changed writes nothing. The merkle
-- root, key id, signature and manifest are the report's Almstins signature (the same proof format
-- as a Year Summary, so /verify-record reads it); they are null for a report made with no signing
-- key configured.
--
-- Also created lazily at runtime (ensureAgentReportsTable in src/lib/agentVault/reportStore.ts);
-- this file is the durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Idempotent: running it again changes nothing.
CREATE TABLE IF NOT EXISTS agent_reports (
  id             TEXT NOT NULL PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  tin_id         TEXT NOT NULL,
  period_start   TEXT NOT NULL,
  period_end     TEXT NOT NULL,
  version        INTEGER NOT NULL,
  generated_at   TEXT NOT NULL,
  content_hash   TEXT NOT NULL,
  summary_json   TEXT NOT NULL,
  merkle_root    TEXT,
  leaf_count     INTEGER,
  signing_key_id TEXT,
  signature_hex  TEXT,
  manifest_json  TEXT,
  created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  CHECK (version >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_reports_version ON agent_reports (tenant_id, tin_id, period_start, version);
CREATE INDEX IF NOT EXISTS agent_reports_tenant_period ON agent_reports (tenant_id, period_start);
