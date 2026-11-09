-- Verify platform lists: the cross-account guard, PR B (verify-platform-guard-spec.claude.md, 3e).
-- A merchant's proven address that a platform's published list also carries keeps its proof (G1)
-- and records when the listing was first seen, so the merchant's dashboard can show the pill. Set
-- at the merchant's flip or by the platform's pull; the watchman's sweep clears it once no other
-- account's mirror lists the address.
--
-- Also created lazily at runtime (ensureVerifyTables in src/lib/verifyRegistry.ts); this file is the
-- durable mirror, and tests/verify/mirrorGuard.test.ts keeps the two identical. Safe to run more than once.
ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS platform_listed_at TEXT;
