-- PG migration 0001 — reviewer + device identity for the community/checker layer.
-- Runs AFTER the faithful baseline schema + data copy (so the column-for-column
-- data migration isn't disturbed). Idempotent.

-- ── Reviews: identify the reviewer by a hash of their (paid) tenant UUID ──────
-- Stores hash(tenant_uuid) — computed app-side with a STABLE salt — instead of the
-- raw tenant_id, so address_reviews is not a plaintext map of which member reviewed
-- which address. Reviews are a global table; that column was only ever for dedup.
ALTER TABLE address_reviews ADD COLUMN IF NOT EXISTS reviewer_hash TEXT;
-- Drop the raw tenant_id (and its old UNIQUE(tenant_id,address)) — CASCADE removes
-- the dependent constraint without needing its auto-generated name. Existing rows
-- are demo-only; the app writes reviewer_hash going forward.
ALTER TABLE address_reviews DROP COLUMN IF EXISTS tenant_id CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS address_reviews_reviewer_addr
  ON address_reviews (reviewer_hash, address);

-- ── Checker log: reliable repeat-scan identity + verdict for the warning ──────
-- uuid_hash  = hash(tenant_uuid) for logged-in members (reliable)
-- device_id  = anonymous first-party cookie id for visitors (better than IP)
-- ip_hash    = kept as a last-resort fallback
-- status     = the verdict at check time, so a repeat scan can say
--              "checked on X — was clean, now flagged"
ALTER TABLE wallet_check_log ADD COLUMN IF NOT EXISTS uuid_hash TEXT;
ALTER TABLE wallet_check_log ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE wallet_check_log ADD COLUMN IF NOT EXISTS status    TEXT;
CREATE INDEX IF NOT EXISTS wcl_addr_uuid   ON wallet_check_log (addr_hash, uuid_hash);
CREATE INDEX IF NOT EXISTS wcl_addr_device ON wallet_check_log (addr_hash, device_id);
CREATE INDEX IF NOT EXISTS wcl_addr_ip     ON wallet_check_log (addr_hash, ip_hash);

-- ── Headcount: distinct anonymous devices per day (no address; pure usage) ────
CREATE TABLE IF NOT EXISTS device_visits (
  device_id TEXT NOT NULL,
  day       TEXT NOT NULL,          -- 'YYYY-MM-DD'
  PRIMARY KEY (device_id, day)
);
