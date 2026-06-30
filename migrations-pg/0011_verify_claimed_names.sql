-- Almstins Verify — domain-anchored business-name registry.
--
-- A business name is reserved like an email handle: the normalized name (lowercase,
-- whitespace-collapsed) is the PRIMARY KEY, so it belongs to exactly one tenant — two
-- businesses can never hold the same verified name.
--
-- A name is reserved ONLY when the tenant has PROVEN the domain it derives from
-- (`domain` records that anchor). DNS arbitrates the name, not Almstins — no KYC, no
-- attribution: only the controller of starbucks.com can reserve "Starbucks", and a
-- lookalike (starbucks-pay.com) has a different registrable label so cannot. An
-- unproven label stays freeform and reserves nothing.
--
-- Mirrors the lazy ENSURE_NAMES_SQL in src/lib/verifyRegistry.ts.

CREATE TABLE IF NOT EXISTS verify_claimed_names (
  name_key     TEXT NOT NULL PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  display_name TEXT NOT NULL,
  domain       TEXT,
  created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);

-- Backstop if an earlier version of this table was already created without `domain`.
ALTER TABLE verify_claimed_names ADD COLUMN IF NOT EXISTS domain TEXT;
