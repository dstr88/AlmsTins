-- Agentics signups (the free door at /agentics): one row per tenant that opened the Agentics
-- door, with where it came from (a short campaign label) and whether the welcome letter was
-- sent. It is also the list of people to write to once, when the vault opens. Nothing here
-- creates a tenant: a tenant exists from the first sign-in, as it does for every account.
--
-- Also created lazily at runtime (ensureAgenticsSignupsTable in src/lib/agenticsSignup.ts); this
-- file is the durable mirror, and tests/agentics/doorSignup.test.ts keeps the two identical.
-- Numbered 0060 so it never collides with the Agent Vault's 0050 to 0059. Safe to run more than once.
CREATE TABLE IF NOT EXISTS agentics_signups (
  tenant_id   TEXT NOT NULL PRIMARY KEY,
  source      TEXT NOT NULL DEFAULT 'direct',
  created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  claimed_at  TEXT,
  welcomed_at TEXT
);
