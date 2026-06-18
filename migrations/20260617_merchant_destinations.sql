-- merchant_destinations: a merchant's authoritative payment "destinations of record".
-- Phase 1 of the anti-MITM merchant self-verify tool (see design.claude.md).
-- Owner -> self, tenant-scoped, no community/attribution -> no legal hold.
-- kind-typed so the same table holds crypto addresses and (later) payment URLs.
CREATE TABLE IF NOT EXISTS merchant_destinations (
  id          TEXT NOT NULL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'crypto',   -- 'crypto' | 'url'
  value       TEXT NOT NULL,                     -- normalized: lowercase EVM address, or canonical URL
  label       TEXT,
  chain       TEXT,                              -- crypto chain hint (nullable)
  monitor     INTEGER NOT NULL DEFAULT 0,        -- opt-in continuous monitoring (Phase 3)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unique per (tenant, kind, value): the conflict target includes tenant_id, so an
-- upsert can only ever touch the same tenant's row (no cross-tenant write surface).
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_dest_unique
  ON merchant_destinations (tenant_id, kind, value);
CREATE INDEX IF NOT EXISTS idx_merchant_dest_tenant
  ON merchant_destinations (tenant_id);
