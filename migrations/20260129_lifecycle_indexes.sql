CREATE INDEX IF NOT EXISTS idx_asset_lifecycle_groups_tenant_symbol
  ON asset_lifecycle_groups(tenant_id, asset_symbol);

CREATE INDEX IF NOT EXISTS idx_asset_lifecycle_events_tenant_time
  ON asset_lifecycle_events(tenant_id, timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_asset_lifecycle_events_tenant_group_time
  ON asset_lifecycle_events(tenant_id, group_id, timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_import_transactions_tenant_time
  ON import_transactions(tenant_id, timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_time
  ON transactions(tenant_id, timestamp);
