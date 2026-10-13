ALTER TABLE import_transactions ADD COLUMN fee_usd REAL;
ALTER TABLE import_transactions ADD COLUMN fee_native REAL;
ALTER TABLE import_transactions ADD COLUMN fee_currency TEXT;
ALTER TABLE import_transactions ADD COLUMN gas_used TEXT;
ALTER TABLE import_transactions ADD COLUMN category TEXT;
ALTER TABLE import_transactions ADD COLUMN group_id TEXT;
ALTER TABLE import_transactions ADD COLUMN parent_tx_id TEXT;
ALTER TABLE import_transactions ADD COLUMN notes TEXT;

CREATE INDEX IF NOT EXISTS idx_import_transactions_source_group
	ON import_transactions (source, group_id);

CREATE INDEX IF NOT EXISTS idx_import_transactions_source_category
	ON import_transactions (source, category);
