ALTER TABLE import_transactions ADD COLUMN wallet_id TEXT;
CREATE INDEX IF NOT EXISTS idx_import_transactions_wallet_id ON import_transactions(wallet_id);
