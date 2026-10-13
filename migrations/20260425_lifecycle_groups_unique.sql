-- De-duplicate asset_lifecycle_groups: keep only the row with the latest
-- updated_at per (tenant_id, asset_symbol) and then enforce uniqueness.

-- Step 1: delete all but the most-recently-updated row per (tenant_id, asset_symbol)
DELETE FROM asset_lifecycle_groups
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY tenant_id, asset_symbol
             ORDER BY updated_at DESC, created_at DESC, id DESC
           ) AS rn
    FROM asset_lifecycle_groups
  ) ranked
  WHERE rn = 1
);

-- Step 2: add UNIQUE index so future concurrent rebuilds can't create duplicates
CREATE UNIQUE INDEX IF NOT EXISTS asset_lifecycle_groups_tenant_asset_unique
  ON asset_lifecycle_groups (tenant_id, asset_symbol);
