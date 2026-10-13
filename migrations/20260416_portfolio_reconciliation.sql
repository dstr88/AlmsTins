-- Portfolio reconciliation: monthly checkbook-style balance tracking
--
-- Design: for each calendar month we store:
--   opening_assets_usd  = total crypto holdings (no debt) at month start
--   closing_assets_usd  = total crypto holdings (no debt) at month end
--   inflows_usd         = sum of all incoming txs classified as non-transfer
--   outflows_usd        = sum of all outgoing txs classified as non-transfer
--   transfer_in_usd     = matched transfer inflows (net ~0 across own wallets)
--   transfer_out_usd    = matched transfer outflows
--   unmatched_out_usd   = outgoing transfers with NO matching inbound found
--                         (transaction disappeared from data — unexplained loss)
--   unmatched_in_usd    = incoming transfers with NO matching outbound found
--                         (transaction disappeared from data — unexplained gain)
--   expected_closing_usd = opening + inflows - outflows + (transfer_in - transfer_out)
--   delta_usd           = closing - expected_closing  (reconciliation gap)
--
-- A delta_usd of 0 means the books balance perfectly.
-- A non-zero delta means either: price appreciation/depreciation, missing data,
-- or an untracked transaction.

CREATE TABLE IF NOT EXISTS portfolio_reconciliation (
  id                    TEXT    NOT NULL PRIMARY KEY,
  tenant_id             TEXT    NOT NULL,
  year_month            TEXT    NOT NULL,  -- 'YYYY-MM' e.g. '2025-04'

  -- Balances (from wallet_snapshots — assets only, no debt)
  opening_assets_usd    REAL,   -- snapshot at start of month (NULL if no snapshot)
  closing_assets_usd    REAL,   -- snapshot at end of month

  -- Cash flows (from import_transactions + transactions, USD at time of tx)
  inflows_usd           REAL    NOT NULL DEFAULT 0,  -- buys, income, rewards
  outflows_usd          REAL    NOT NULL DEFAULT 0,  -- sells, fees, payments

  -- Transfer flows (between own wallets — should net to ~0)
  transfer_in_usd       REAL    NOT NULL DEFAULT 0,  -- matched inbound transfers
  transfer_out_usd      REAL    NOT NULL DEFAULT 0,  -- matched outbound transfers

  -- Unmatched transfer halves (data gaps / disappeared transactions)
  unmatched_out_usd     REAL    NOT NULL DEFAULT 0,  -- sent out, never arrived
  unmatched_in_usd      REAL    NOT NULL DEFAULT 0,  -- arrived, no send record

  -- Derived
  expected_closing_usd  REAL,   -- opening + inflows - outflows + (transfer_in - transfer_out)
  delta_usd             REAL,   -- closing - expected (reconciliation gap)

  -- Metadata
  tx_count              INTEGER NOT NULL DEFAULT 0,
  unmatched_tx_count    INTEGER NOT NULL DEFAULT 0,
  computed_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  UNIQUE (tenant_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_recon_tenant_month
  ON portfolio_reconciliation (tenant_id, year_month DESC);

-- Per-asset monthly breakdown (drill-down detail)
CREATE TABLE IF NOT EXISTS portfolio_reconciliation_assets (
  id                TEXT    NOT NULL PRIMARY KEY,
  tenant_id         TEXT    NOT NULL,
  year_month        TEXT    NOT NULL,
  asset_symbol      TEXT    NOT NULL,

  inflows_qty       REAL    NOT NULL DEFAULT 0,
  inflows_usd       REAL    NOT NULL DEFAULT 0,
  outflows_qty      REAL    NOT NULL DEFAULT 0,
  outflows_usd      REAL    NOT NULL DEFAULT 0,

  -- Unmatched transfer halves for this asset
  unmatched_out_qty REAL    NOT NULL DEFAULT 0,
  unmatched_out_usd REAL    NOT NULL DEFAULT 0,
  unmatched_in_qty  REAL    NOT NULL DEFAULT 0,
  unmatched_in_usd  REAL    NOT NULL DEFAULT 0,

  tx_count          INTEGER NOT NULL DEFAULT 0,

  UNIQUE (tenant_id, year_month, asset_symbol)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_recon_assets_tenant_month
  ON portfolio_reconciliation_assets (tenant_id, year_month DESC, asset_symbol);
