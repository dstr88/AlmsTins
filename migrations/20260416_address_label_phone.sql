-- Extend address_labels to support phone numbers (Venmo, CashApp, Zelle, etc.)
-- and change the unique constraint so the same address can appear multiple times
-- when phone numbers differ (e.g. two Venmo users sharing a crypto.com hot wallet).
--
-- Old constraint: UNIQUE(tenant_id, address)
-- New constraint: UNIQUE(tenant_id, address, COALESCE(phone_number, ''))
--   → same address + no phone     = one row  (unchanged behaviour)
--   → same address + phone A      = one row per phone number
--   → same address + phone A & B  = two separate rows

-- Step 1: rebuild table with phone_number column and no inline unique constraint
CREATE TABLE address_labels_new (
  id           TEXT    NOT NULL PRIMARY KEY,
  tenant_id    TEXT    NOT NULL,
  address      TEXT    NOT NULL,
  label        TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'auto',
  category     TEXT,
  chain        TEXT,
  notes        TEXT,
  phone_number TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO address_labels_new
  SELECT id, tenant_id, address, label, source, category, chain, notes,
         NULL AS phone_number, created_at, updated_at
  FROM address_labels;

DROP TABLE address_labels;
ALTER TABLE address_labels_new RENAME TO address_labels;

-- Step 2: functional unique index — treats NULL phone as '' so no-phone rows
-- still conflict with each other on the same address.
CREATE UNIQUE INDEX IF NOT EXISTS idx_address_labels_unique
  ON address_labels (tenant_id, address, COALESCE(phone_number, ''));

CREATE INDEX IF NOT EXISTS idx_address_labels_tenant
  ON address_labels (tenant_id);
