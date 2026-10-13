CREATE TABLE IF NOT EXISTS wallet_holdings_snapshot (
  tenant_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  as_of TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, wallet_id, chain_id)
);

CREATE TABLE IF NOT EXISTS wallet_nft_snapshot (
  tenant_id TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  as_of TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, wallet_id, chain_id)
);
