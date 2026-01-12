CREATE INDEX IF NOT EXISTS idx_import_transactions_source_parent
	ON import_transactions (source, parent_tx_id);
