-- Verified-email password sign-in and the account-linking guard.
--
-- Both are also created lazily at runtime (sessionGate.ensureSessionColumns,
-- outboundEmailQuota.ensureOutboundEmailTable); this migration is the durable mirror.
-- Apply it by hand BEFORE deploying, so the first signed-in request after the deploy
-- never has to ALTER auth_users itself. The lock_timeout makes the ALTER give up (rerun
-- it) instead of queueing every sign-in behind an open transaction on auth_users.
SET lock_timeout = '2s';

-- Epoch seconds. A session token issued before this is no longer honored. Set when a
-- provider-verified sign-in (Google, GitHub, magic link) takes an address back from an
-- unverified password or an unproven provider link, so a session minted by either stops
-- working.
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS sessions_valid_after BIGINT;

-- Normally already present (the alert-email feature). The link guard clears it when it
-- takes an address back, so make sure it exists.
ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS alert_email TEXT;

-- One row per email Almstins sent to an address a tenant typed in (receivables and
-- milestone request emails). Backs the rolling 24h per-tenant cap. Tenant-scoped.
CREATE TABLE IF NOT EXISTS tenant_outbound_emails (
  id        TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  channel   TEXT NOT NULL,
  sent_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tenant_outbound_emails_tenant_sent_idx
  ON tenant_outbound_emails (tenant_id, sent_at);
