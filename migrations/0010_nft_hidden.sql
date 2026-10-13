CREATE TABLE IF NOT EXISTS nft_hidden (
	tenant_id TEXT NOT NULL,
	wallet_id TEXT NOT NULL,
	chain_id INTEGER NOT NULL,
	contract_address TEXT NOT NULL,
	token_id TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (tenant_id, wallet_id, chain_id, contract_address, token_id)
);

CREATE INDEX IF NOT EXISTS nft_hidden_wallet_idx
	ON nft_hidden (tenant_id, wallet_id);
