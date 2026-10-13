-- Speed up Needs Attention and Search queries.
--
-- The (tenant_id, direction) composite index lets SQLite skip from "all rows
-- for this tenant" to "only OUT rows" or "only IN rows" in one seek rather
-- than scanning every transaction and then filtering by direction.

CREATE INDEX IF NOT EXISTS idx_import_transactions_tenant_direction
  ON import_transactions (tenant_id, direction);

-- Covering index for the kind-filter path: after narrowing to tenant+direction
-- SQLite can read kind from the index without touching the main table rows.

CREATE INDEX IF NOT EXISTS idx_import_transactions_tenant_direction_kind
  ON import_transactions (tenant_id, direction, kind);
