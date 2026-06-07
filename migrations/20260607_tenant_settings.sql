-- Phase D: per-tenant product settings
-- Adds a tenant_settings table that persists the jurisdiction profile
-- and default cost-basis method chosen by each tenant.
--
-- Jurisdiction:      'us'    → US/IRS rules (short/long-term split, IRS holding-period)
--                    'intl'  → International (date-ordered ledger, holding-days column,
--                               no US form references, no short/long split)
--
-- cost_basis_method: 'fifo' | 'hifo' | 'lifo' | 'spec_id'  (engine already supports all four)
--
-- Both columns default to the current US-FIFO behaviour so existing tenants are
-- unaffected by the migration.

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id         TEXT NOT NULL PRIMARY KEY,
  jurisdiction      TEXT NOT NULL DEFAULT 'us',    -- 'us' | 'intl'
  cost_basis_method TEXT NOT NULL DEFAULT 'fifo',  -- 'fifo' | 'hifo' | 'lifo' | 'spec_id'
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
