-- Almstins Verify — claim-once for QR / payment-link destinations.
--
-- A proven (rail, value) URL can belong to only one account, globally. QR
-- destinations are proven on save (proof_method='account_claim'): an owner
-- registering a payment link while authenticated in their OWN account IS the
-- claim of ownership. This partial unique index makes that claim exclusive, so a
-- customer scanning the link gets an unambiguous "registered to <merchant>".
--
-- The stored value is normalized on save (src/lib/verifyRegistry.createDestination),
-- so this index on the canonical value is the real exclusivity arbiter. The
-- application also pre-checks the claim and catches the violation gracefully; this
-- mirrors the lazy ENSURE_CLAIM_QR_IDX in src/lib/verifyRegistry.ts.
--
-- NOTE: if this fails to create, the table already holds duplicate proven (rail,
-- value) QR rows across tenants — resolve those before relying on DB-level claim-once.

CREATE UNIQUE INDEX IF NOT EXISTS verify_destinations_proven_claim_qr
  ON verify_destinations (rail, value)
  WHERE proof_status = 'proven' AND kind = 'qr';
