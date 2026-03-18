-- ─────────────────────────────────────────────────────────────────────────────
-- 0018_tax_classification.sql
--
-- Adds four tables that power the tax classification pipeline:
--
--   tax_classifications  – one row per transaction, auto or manually set
--   tax_review_items     – items flagged for the user to look at
--   tax_lots             – FIFO acquisition lots (buys, income, airdrops)
--   tax_disposals        – taxable disposals matched back to lots
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tax classifications ────────────────────────────────────────────────────
-- Stores the category for every transaction.  Auto-classified rows have
-- is_manual = 0 and will be overwritten on each pipeline re-run UNLESS
-- is_manual = 1 (user override), which is always preserved.
CREATE TABLE IF NOT EXISTS tax_classifications (
  id           TEXT    NOT NULL PRIMARY KEY,
  tenant_id    TEXT    NOT NULL,

  -- Which table the source row lives in
  source_type  TEXT    NOT NULL, -- 'import' | 'onchain'
  source_id    TEXT    NOT NULL, -- import_transactions.id or transactions.id

  -- Classification result
  category     TEXT    NOT NULL,
  -- buy | sell | swap | transfer | income | airdrop | burn | loan-proceeds
  -- loan-repayment | collateral-deposit | liquidation | fee | nft-sale
  -- loan-interest-paid | unknown

  sub_category TEXT,             -- e.g. staking | earn | hard-fork | defi-reward
  confidence   REAL,             -- 0.0–1.0; NULL means manually set
  is_manual    INTEGER NOT NULL DEFAULT 0, -- 1 = user override, never auto-overwritten

  -- For transfers: the id of the matching transaction on the other side
  linked_tx_id       TEXT,
  linked_source_type TEXT,

  -- User-written note (survives re-runs even on auto rows)
  notes        TEXT,

  -- Denormalised for fast year-scoped queries
  tax_year     INTEGER,
  asset_symbol TEXT,
  amount_usd   REAL,

  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  UNIQUE (tenant_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_tax_classifications_tenant_year
  ON tax_classifications (tenant_id, tax_year);

CREATE INDEX IF NOT EXISTS idx_tax_classifications_tenant_category
  ON tax_classifications (tenant_id, category);

-- ── 2. Tax review items ───────────────────────────────────────────────────────
-- Flagged transactions that need the user's attention before the report is
-- considered complete.  Resolved = 1 after the user acts on it.
CREATE TABLE IF NOT EXISTS tax_review_items (
  id            TEXT    NOT NULL PRIMARY KEY,
  tenant_id     TEXT    NOT NULL,

  source_type   TEXT    NOT NULL,
  source_id     TEXT    NOT NULL,

  -- Why this item is in the queue
  reason        TEXT    NOT NULL,
  -- unmatched_transfer | missing_price | possible_loan | low_confidence
  -- unknown_type | missing_cost_basis | airdrop_unpriced

  reason_detail TEXT,   -- human-readable explanation shown in the UI

  -- Snapshot of the transaction for display (avoids a join on every render)
  snapshot_json TEXT,

  -- Resolution
  resolved      INTEGER NOT NULL DEFAULT 0,
  resolved_at   TEXT,
  resolved_category TEXT, -- the category the user chose when resolving

  -- User note (can be filled before or after resolving)
  notes         TEXT,

  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  -- One review item per transaction per reason
  UNIQUE (tenant_id, source_type, source_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_tax_review_tenant_resolved
  ON tax_review_items (tenant_id, resolved);

-- ── 3. Tax lots ───────────────────────────────────────────────────────────────
-- One row per acquisition event (buy, income, airdrop, etc.).
-- remaining_qty counts down as disposals consume the lot.
CREATE TABLE IF NOT EXISTS tax_lots (
  id                TEXT    NOT NULL PRIMARY KEY,
  tenant_id         TEXT    NOT NULL,

  asset_symbol      TEXT    NOT NULL,
  acquired_at       TEXT    NOT NULL,  -- ISO 8601 timestamp
  quantity          REAL    NOT NULL,  -- original qty
  remaining_qty     REAL    NOT NULL,  -- qty not yet consumed by a disposal
  cost_basis_usd    REAL,              -- total USD at acquisition
  price_per_unit    REAL,              -- USD per token at acquisition

  -- Where this lot came from
  source_type       TEXT    NOT NULL,  -- 'import' | 'onchain'
  source_id         TEXT    NOT NULL,
  lot_type          TEXT    NOT NULL DEFAULT 'purchase',
  -- purchase | income | airdrop | transfer | hard-fork

  -- For transferred lots: the originating lot this traces back to
  origin_lot_id     TEXT,

  is_exhausted      INTEGER NOT NULL DEFAULT 0,  -- 1 when remaining_qty <= 0

  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tax_lots_tenant_symbol_date
  ON tax_lots (tenant_id, asset_symbol, acquired_at);

CREATE INDEX IF NOT EXISTS idx_tax_lots_tenant_active
  ON tax_lots (tenant_id, is_exhausted);

-- ── 4. Tax disposals ──────────────────────────────────────────────────────────
-- One row per lot-slice consumed by a disposal event.  A single sell may
-- span multiple lots, producing multiple disposal rows.
CREATE TABLE IF NOT EXISTS tax_disposals (
  id              TEXT    NOT NULL PRIMARY KEY,
  tenant_id       TEXT    NOT NULL,

  asset_symbol    TEXT    NOT NULL,
  disposed_at     TEXT    NOT NULL,   -- ISO 8601
  quantity        REAL    NOT NULL,   -- qty consumed from this specific lot
  proceeds_usd    REAL,               -- USD value at disposal (NULL if unpriced)
  cost_basis_usd  REAL,               -- lot's cost for this slice
  gain_loss_usd   REAL,               -- proceeds - cost_basis (NULL if either missing)
  is_short_term   INTEGER NOT NULL DEFAULT 0,  -- held < 365 days → 1

  -- What kind of disposal
  category        TEXT    NOT NULL,   -- sell | swap | liquidation | burn | lost | nft-sale

  -- The disposal transaction
  source_type     TEXT    NOT NULL,
  source_id       TEXT    NOT NULL,

  -- The lot this slice came from
  lot_id          TEXT    NOT NULL,

  notes           TEXT,

  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tax_disposals_tenant_year
  ON tax_disposals (tenant_id, disposed_at);

CREATE INDEX IF NOT EXISTS idx_tax_disposals_lot
  ON tax_disposals (tenant_id, lot_id);
