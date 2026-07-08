-- Community ratings: paid subscribers can flag any checked address or URL.
-- kind = 'wallet' | 'dapp'
-- subject is normalized before insert: EVM addresses lowercased, URLs domain-lowercased.
-- One rating per tenant per subject (UNIQUE enforces; POST upserts on conflict).
CREATE TABLE IF NOT EXISTS community_ratings (
  id          BIGSERIAL   PRIMARY KEY,
  tenant_id   TEXT        NOT NULL,
  kind        TEXT        NOT NULL,
  subject     TEXT        NOT NULL,
  rating      TEXT        NOT NULL,  -- 'safe' | 'suspicious' | 'scam'
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, subject)
);

-- Aggregate query: count ratings across all tenants for a given subject.
CREATE INDEX IF NOT EXISTS community_ratings_subject_idx ON community_ratings (kind, subject);
-- Per-tenant lookup (DELETE own rating, edit own rating).
CREATE INDEX IF NOT EXISTS community_ratings_tenant_idx ON community_ratings (tenant_id, kind, subject);
