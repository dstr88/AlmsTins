-- tax_wallet_allocation_override: the owner's own January 1, 2025 allocation of a coin's cost
-- basis to the wallets and accounts that held it. One row per lot-portion; the rows of one coin
-- replace the rebuilt positions for that coin, all or nothing (src/lib/tax/allocationOverride.ts,
-- checked by the ledger core, src/lib/tax/lotLedger.ts). wallet_key is the wallet key from
-- src/lib/walletKey.ts. note is the owner's text, at most 200 characters, and is escaped wherever
-- it is shown.
--
-- Also created lazily at runtime (ensureWalletAllocationOverrideTable); this file is the durable
-- mirror, and tests/tax/allocationOverride.test.ts keeps the two identical. Safe to run more than
-- once. Deleted with the account (src/lib/accountDeleteTables.ts).
CREATE TABLE IF NOT EXISTS tax_wallet_allocation_override (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  asset_symbol     TEXT NOT NULL,
  wallet_key       TEXT NOT NULL,
  lot_acquired_at  TEXT NOT NULL,
  quantity         DOUBLE PRECISION NOT NULL,
  cost_basis_usd   DOUBLE PRECISION,
  note             TEXT,
  created_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  updated_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
);
CREATE INDEX IF NOT EXISTS idx_tax_wallet_alloc_override_tenant_asset ON tax_wallet_allocation_override (tenant_id, asset_symbol);
