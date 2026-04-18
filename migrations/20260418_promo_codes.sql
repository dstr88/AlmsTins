-- Promo code system — grants a plan upgrade for a fixed duration, no credit card required.
--
-- promo_codes: the codes you create (one-time, multi-use, or unlimited)
-- promo_redemptions: who redeemed what and when their access expires
--
-- getActivePlan() checks promo_redemptions first; an active promo overrides
-- whatever Stripe subscription the tenant has.

CREATE TABLE IF NOT EXISTS promo_codes (
  code             TEXT    NOT NULL PRIMARY KEY,          -- e.g. 'LAUNCH2026'
  plan_id          TEXT    NOT NULL DEFAULT 'unlimited',  -- plan to grant
  duration_days    INTEGER NOT NULL DEFAULT 365,          -- how long the grant lasts
  max_uses         INTEGER,                               -- NULL = unlimited uses
  note             TEXT,                                  -- internal label for you
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at       TEXT                                   -- NULL = code never expires
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id                   TEXT NOT NULL PRIMARY KEY,
  tenant_id            TEXT NOT NULL,
  code                 TEXT NOT NULL,
  plan_id              TEXT NOT NULL,
  redeemed_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  access_expires_at    TEXT NOT NULL,
  warning_30d_sent_at  TEXT,   -- set when 30-day warning email is sent
  warning_7d_sent_at   TEXT,   -- set when 7-day warning email is sent
  UNIQUE (tenant_id, code)     -- one redemption per code per tenant
);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_tenant
  ON promo_redemptions (tenant_id, access_expires_at DESC);
