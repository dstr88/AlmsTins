-- Almstins Verify — global business-name registry.
--
-- A business name is claimed like an email handle: the normalized name (lowercase,
-- whitespace-collapsed) is the PRIMARY KEY, so it belongs to exactly one tenant — two
-- businesses can never register the same name. A tenant reuses its own name freely
-- across its own destinations; another tenant is rejected with `name_taken`.
--
-- Mirrors the lazy ENSURE_NAMES_SQL in src/lib/verifyRegistry.ts.
--
-- NOTE: uniqueness is not authenticity. Names are first-come with no identity check
-- (no KYC, by design) — this prevents duplicate names, not impersonation. A future
-- step can gate a name-claim behind domain/destination proof to close squatting.

CREATE TABLE IF NOT EXISTS verify_claimed_names (
  name_key     TEXT NOT NULL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
