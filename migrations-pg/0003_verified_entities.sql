-- PG migration 0003 — Almstins Verify: Verified Entity (hosted-API-endpoint variant).
-- An entity proves its domain, then hosts a live address list we pull with an API key
-- it issues us. The key is stored ENCRYPTED (we replay it), never hashed. Owner→world
-- self-disclosure; the mirror carries the DOMAIN, never a legal identity. Tenant
-- isolation app-enforced. Both tables are NEW, so the lazy ensureEntityTables() in
-- verifyEntities.ts creates them on first use — this file is for parity/auditability.
-- Idempotent.

CREATE TABLE IF NOT EXISTS verified_entities (
  id                TEXT NOT NULL PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  domain            TEXT NOT NULL,
  challenge_token   TEXT NOT NULL,
  proof_status      TEXT NOT NULL DEFAULT 'unproven',  -- unproven | proven
  api_endpoint      TEXT,
  api_key_encrypted TEXT,                              -- AES-256-GCM, never plaintext/hash
  last_pulled_at    TEXT,
  last_pull_status  TEXT,                              -- ok | invalid_endpoint | unreachable | unauthorized | malformed
  last_pull_count   INTEGER NOT NULL DEFAULT 0,
  proven_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  updated_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
CREATE UNIQUE INDEX IF NOT EXISTS verified_entities_tenant_domain
  ON verified_entities (tenant_id, domain);

-- Global-by-design, address-keyed: the public lookup reads address → entity_domain and
-- never exposes tenant_id or identity. tenant_id is for management only.
CREATE TABLE IF NOT EXISTS verified_address_mirror (
  id            TEXT NOT NULL PRIMARY KEY,
  entity_id     TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  address       TEXT NOT NULL,
  chain         TEXT NOT NULL DEFAULT '',
  entity_domain TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'verified',  -- verified | revoked
  source        TEXT NOT NULL DEFAULT 'api_endpoint',
  refreshed_at  TEXT
);
CREATE INDEX IF NOT EXISTS verified_address_mirror_address
  ON verified_address_mirror (address);
CREATE UNIQUE INDEX IF NOT EXISTS verified_address_mirror_entity_addr
  ON verified_address_mirror (entity_id, address, chain);
