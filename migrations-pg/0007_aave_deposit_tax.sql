-- Per-tenant district treatment for supplying assets into a DeFi contract (Aave).
--
-- A contested tax position: some districts treat receiving the aToken as a taxable
-- crypto-to-crypto disposal, others as a non-taxable deposit. This column records
-- the tenant's own choice — Almstins never files; it only organizes the record.
--   'undecided'     (default) — flag Aave deposits for review; books unchanged (non-taxable)
--   'tax_event'                — realize gain/loss on supply, step basis up to FMV
--   'not_tax_event'            — non-taxable pass-through, stop flagging
--
-- Default 'undecided' preserves current behavior for every existing tenant.

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS aave_deposit_tax TEXT NOT NULL DEFAULT 'undecided';
