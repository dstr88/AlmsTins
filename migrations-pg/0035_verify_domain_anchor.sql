-- Almstins Verify: record when an address was anchored to a proven domain.
--
-- proven_at is when CONTROL was proven (self-send or the .well-known file). A self-send-proven
-- address can later be listed in its owner's domain file, which attaches proof_domain and lifts
-- the public level claimed → verified. domain_anchored_at is that anchor's own date: the public
-- "verified since" and /api/verify/check proofAgeDays use it, so a newly attached domain never
-- inherits the age of an older self-send proof. Cleared whenever proof_domain is cleared.
--
-- Mirrors the lazy ALTER in src/lib/verifyRegistry.ts ensureVerifyTables.
ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS domain_anchored_at TEXT;

-- Existing anchors were all made by the file proof itself (proof_method = 'well_known'), which
-- set proven_at at the moment it anchored the address.
UPDATE verify_destinations
   SET domain_anchored_at = proven_at
 WHERE domain_anchored_at IS NULL
   AND proof_domain IS NOT NULL
   AND proof_method = 'well_known'
   AND proven_at IS NOT NULL;

-- Leftovers: before this change a self-send re-prove of a lapsed file-proven address kept the
-- old proof_domain. That is not an anchor the owner made (the public lookup already treats it
-- as claimed); clear it so the dashboard offers "Verify domain" for it again.
UPDATE verify_destinations
   SET proof_domain = NULL, last_confirmed_at = NULL
 WHERE kind = 'address'
   AND proof_method <> 'well_known'
   AND proof_domain IS NOT NULL
   AND domain_anchored_at IS NULL;
