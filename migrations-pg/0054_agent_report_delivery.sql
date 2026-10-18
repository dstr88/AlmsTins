-- Agent Vault report delivery (owner-only for now): how an account wants to hear about its agents,
-- and the small record that keeps a message from going out twice. Everything is per account
-- (tenant_id) and nothing is on until the owner turns it on: an account with no row has cadence
-- `off` and alerts off.
--
--   agent_report_settings  one row per account: the digest cadence (off, daily, weekly, issues),
--                          whether to be told at once about a flagged check, and the key of the
--                          last digest sent, which stops the same digest going out twice. These
--                          are settings, so the row is updated in place; the ledger and the
--                          reports stay append-only.
--   agent_alert_claims     one row per (account, tin, address): when it was last alerted about.
--                          A claim is one atomic step (an insert that skips a conflict, or an
--                          update that only changes a row older than the cutoff), so a burst of
--                          flagged checks on one address sends one email an hour.
--
-- Both are removed with the account (src/lib/accountDeleteTables.ts). Also created lazily at
-- runtime (ensureAgentDeliveryTables in src/lib/agentVault/deliveryStore.ts); this file is the
-- durable mirror, and tests/agentics/guards.test.ts keeps the two identical.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS agent_report_settings (
  tenant_id       TEXT NOT NULL PRIMARY KEY,
  cadence         TEXT NOT NULL DEFAULT 'off' CHECK (cadence IN ('off', 'daily', 'weekly', 'issues')),
  alerts          INTEGER NOT NULL DEFAULT 0 CHECK (alerts IN (0, 1)),
  last_digest_key TEXT,
  updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE TABLE IF NOT EXISTS agent_alert_claims (
  tenant_id    TEXT NOT NULL,
  tin_id       TEXT NOT NULL,
  address      TEXT NOT NULL,
  last_sent_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, tin_id, address)
);
