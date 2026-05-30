-- DirtyTins: personal finance tins for debt tracking, budgeting, and business P&L.
-- Pure math, no bank connections, no API keys. Users enter their own numbers.

-- The tins themselves (debt, budget, or business)
CREATE TABLE IF NOT EXISTS dirty_tins (
  id           TEXT NOT NULL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('debt', 'budget', 'business')),
  name         TEXT NOT NULL,
  -- Debt-specific fields
  balance      REAL,          -- current balance owed
  credit_limit REAL,          -- credit limit (for credit cards)
  apr          REAL,          -- annual percentage rate (e.g. 0.2199 for 21.99%)
  min_payment  REAL,          -- minimum monthly payment
  -- Business-specific fields
  goal_revenue REAL,          -- monthly revenue target
  -- Shared
  notes        TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dirty_tins_tenant ON dirty_tins (tenant_id, type, sort_order);

-- Entries: every payment, charge, income, or expense event
CREATE TABLE IF NOT EXISTS dirty_tin_entries (
  id          TEXT NOT NULL PRIMARY KEY,
  tin_id      TEXT NOT NULL REFERENCES dirty_tins(id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,
  entry_date  TEXT NOT NULL,          -- YYYY-MM-DD
  kind        TEXT NOT NULL CHECK (kind IN ('payment', 'charge', 'income', 'expense')),
  amount      REAL NOT NULL,
  description TEXT,
  -- For budget: split rules (JSON array of { person, pct })
  splits_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dirty_tin_entries_tin ON dirty_tin_entries (tin_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_dirty_tin_entries_tenant ON dirty_tin_entries (tenant_id, entry_date DESC);
