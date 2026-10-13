-- User-confirmed scam contract addresses.
-- When a user marks a "needs attention" item as a worthless airdrop ($0),
-- the contract address is recorded here so future airdrops from the same
-- contract are auto-resolved without user intervention.
CREATE TABLE IF NOT EXISTS user_scam_contracts (
  id               TEXT NOT NULL,
  tenant_id        TEXT NOT NULL,
  chain            TEXT NOT NULL,
  symbol           TEXT NOT NULL,
  contract_address TEXT NOT NULL,  -- stored lower-case
  created_at       TEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (tenant_id, chain, contract_address)
);
