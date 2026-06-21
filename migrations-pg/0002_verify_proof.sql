-- PG migration 0002 — Almstins Verify Phase 3: proof of control (domain attestation).
-- Adds the per-(tenant, domain) challenge/proof state and links a destination to the
-- domain whose published /.well-known/almstins-verify.json vouches for it. Tenant
-- isolation is app-enforced (every query scoped by tenant_id, like verify_destinations).
-- The lazy ensureVerifyTables() in verifyRegistry.ts creates the same shape for fresh
-- installs; this migration covers the existing production table's column add. Idempotent.

-- Which domain's proof currently vouches for this destination (set when it goes proven).
ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS proof_domain TEXT;

-- One challenge per (tenant, domain). status: pending → proven | failed | revoked.
CREATE TABLE IF NOT EXISTS verify_domain_proofs (
  id              TEXT NOT NULL PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  domain          TEXT NOT NULL,
  challenge_token TEXT NOT NULL,
  method          TEXT NOT NULL DEFAULT 'well_known',  -- well_known | dns_txt
  status          TEXT NOT NULL DEFAULT 'pending',     -- pending | proven | failed | revoked
  issued_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  proven_at       TEXT,
  last_checked_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);

CREATE UNIQUE INDEX IF NOT EXISTS verify_domain_proofs_tenant_domain
  ON verify_domain_proofs (tenant_id, domain);
