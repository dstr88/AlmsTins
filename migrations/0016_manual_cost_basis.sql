-- Manual cost basis entries: persisted when a user fills in missing buy price
-- on the transactions page.  One row per (tenant, sell source_id) — upserted
-- each time the user updates the value.
CREATE TABLE IF NOT EXISTS manual_cost_basis (
  id               TEXT    NOT NULL,
  tenant_id        TEXT    NOT NULL,
  -- source_id of the sell / liquidation lifecycle event this basis covers
  sell_source_id   TEXT    NOT NULL,
  -- How many tokens had no matched buy lot (the "unmatchedQty" in fifoGroupSells)
  quantity         REAL    NOT NULL,
  -- User-supplied average price per token in USD
  price_per_token  REAL    NOT NULL,
  -- Optional buy date supplied by the user (ISO 8601)
  buy_date_iso     TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),

  PRIMARY KEY (id),
  UNIQUE (tenant_id, sell_source_id)
);

CREATE INDEX IF NOT EXISTS idx_manual_cost_basis_tenant
  ON manual_cost_basis (tenant_id);
