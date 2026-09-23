-- Almstins Verify: bind the satoshi test (self-send proof, rule 'bound_v1').
--
-- Before this, any outgoing transaction from the address after the challenge opened
-- proved it, with no amount, no recipient and no expiry. Someone could open a challenge
-- on an address they don't control and be credited with the owner's next routine send.
-- Now each challenge carries a random EXACT amount and a 24h expiry, and the proof is a
-- self-send (FROM the address TO the same address) of exactly that amount inside the
-- window. Almstins still only reads the public chain: it never sends, holds, or signs,
-- and never gives anyone an address to send to.
--
-- All of this is also created lazily at runtime (verifyRegistry.ensureVerifyTables);
-- this migration is the durable mirror.

-- The binding. expected_amount is in base units (sats, litoshis, wei, lamports) as a
-- BigInt string; unit is the native coin; canonical_address is 'evm:'+lowercase for EVM,
-- lowercase for bech32, exact for base58. baseline (BTC/LTC) is JSON: the chain tip height
-- and the address's mempool txids when the amount was issued, captured before the amount
-- was drawn; a transaction already visible then can never prove the test. Rows without
-- rule='bound_v1' are pre-binding challenges and can no longer prove anything.
ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS expected_amount TEXT;
ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS unit TEXT;
ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS canonical_address TEXT;
ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS expires_at TEXT;
ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS rule TEXT;
ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS last_outcome TEXT;
ALTER TABLE verify_deposit_challenges ADD COLUMN IF NOT EXISTS baseline TEXT;

-- Two accounts testing the same address never hold the same pending amount, so one
-- self-send can satisfy at most one challenge. Global on purpose, like claim-once.
CREATE UNIQUE INDEX IF NOT EXISTS verify_deposit_challenges_pending_amount
  ON verify_deposit_challenges (canonical_address, expected_amount) WHERE status = 'pending';

-- The issuance history: one row per NEW amount a tenant draws for an address, kept 7 days.
-- Keyed by (tenant, canonical address), not by destination, and deleting a destination
-- leaves it alone, so delete + re-add can't reroll an amount: while a drawn amount is
-- unexpired the tenant gets it back (same window and baseline), and new draws are capped
-- per address and per tenant. It also keeps a reissue from repeating a recent amount.
CREATE TABLE IF NOT EXISTS verify_deposit_amount_log (
  id                TEXT NOT NULL PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  canonical_address TEXT NOT NULL,
  expected_amount   TEXT NOT NULL,
  issued_at         TEXT NOT NULL,
  expires_at        TEXT,
  baseline          TEXT
);
ALTER TABLE verify_deposit_amount_log ADD COLUMN IF NOT EXISTS expires_at TEXT;
ALTER TABLE verify_deposit_amount_log ADD COLUMN IF NOT EXISTS baseline TEXT;
CREATE INDEX IF NOT EXISTS verify_deposit_amount_log_addr
  ON verify_deposit_amount_log (canonical_address, issued_at);
CREATE INDEX IF NOT EXISTS verify_deposit_amount_log_tenant
  ON verify_deposit_amount_log (tenant_id, issued_at);

-- Claims proven under the old, unbound rule. Internal only: nothing public reads it, so
-- those Claimed rows look exactly as before. It marks them for the later contest path.
ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS legacy_unbound BOOLEAN NOT NULL DEFAULT false;

-- Idempotent backfill: a bound proof's challenge has rule='bound_v1' from issuance, so
-- this only ever tags rows proven under the old rule.
UPDATE verify_destinations d SET legacy_unbound = true
  WHERE d.proof_method = 'micro_deposit' AND d.proof_status = 'proven' AND d.legacy_unbound = false
    AND NOT EXISTS (
      SELECT 1 FROM verify_deposit_challenges c
      WHERE c.destination_id = d.id AND c.tenant_id = d.tenant_id AND c.rule = 'bound_v1'
    );
