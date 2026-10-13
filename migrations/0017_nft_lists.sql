-- NFT whitelist: NFTs the user explicitly wants always shown.
-- Counterpart to nft_hidden (blacklist). Priority: blacklist > whitelist > purchase detection.
CREATE TABLE IF NOT EXISTS nft_whitelist (
	tenant_id TEXT NOT NULL,
	wallet_id TEXT NOT NULL,
	chain_id INTEGER NOT NULL,
	contract_address TEXT NOT NULL,
	token_id TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (tenant_id, wallet_id, chain_id, contract_address, token_id)
);

CREATE INDEX IF NOT EXISTS nft_whitelist_wallet_idx
	ON nft_whitelist (tenant_id, wallet_id);
