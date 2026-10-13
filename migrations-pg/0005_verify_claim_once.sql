-- Almstins Verify — claim-once foundation.
--
-- A (rail, address) destination can be PROVEN by only one account, globally. This
-- prevents a second account from claiming an address someone else has already
-- proven control of (e.g. squatting a published merchant address). Proving requires
-- control (domain attestation today; self-send micro-deposit next), so two genuine
-- owners of the same key never collide in practice — this is the hard backstop.
--
-- Partial unique index (only proven address rows participate). The application also
-- catches the violation and skips gracefully (verifyRegistry.recordProofResult);
-- this mirrors the lazy ENSURE_CLAIM_IDX in src/lib/verifyRegistry.ts.
--
-- NOTE: if this fails to create, the table already holds duplicate proven (rail,
-- value) rows across tenants — resolve those before relying on DB-level claim-once.

CREATE UNIQUE INDEX IF NOT EXISTS verify_destinations_proven_claim
  ON verify_destinations (rail, value)
  WHERE proof_status = 'proven' AND kind = 'address';
