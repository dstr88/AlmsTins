-- Manual NFT cost basis (contract + tokenId). Read by annualBreakdown to populate
-- NftHolding.costUsd. Mirrors the lazy ensure in src/lib/nftCost.ts.
CREATE TABLE IF NOT EXISTS nft_manual_cost (
  tenant_id  TEXT NOT NULL,
  chain      TEXT NOT NULL,
  contract   TEXT NOT NULL,
  token_id   TEXT NOT NULL,
  cost_usd   DOUBLE PRECISION,
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (tenant_id, chain, contract, token_id)
);
