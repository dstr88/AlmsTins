-- Verify platform lists: the cross-account guard (verify-platform-guard-spec.claude.md, PR A).
-- A pulled list entry that another account holds as a proven destination, or that an earlier-proven
-- platform already lists, is mirrored with status 'conflict' instead of 'verified', with a word for
-- what it conflicts with ('merchant' or 'platform', never a party) and when the pull first saw it.
-- The entity row counts its conflicts beside its pull count. The (address, status) index keeps the
-- public lookup's first read a single index read.
--
-- Also created lazily at runtime (ensureEntityTables in src/lib/verifyEntities.ts); this file is the
-- durable mirror, and tests/verify/mirrorGuard.test.ts keeps the two identical. Safe to run more than once.
ALTER TABLE verified_address_mirror ADD COLUMN IF NOT EXISTS conflict_with TEXT;
ALTER TABLE verified_address_mirror ADD COLUMN IF NOT EXISTS conflict_seen_at TEXT;
ALTER TABLE verified_entities ADD COLUMN IF NOT EXISTS last_pull_conflicts INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS verified_address_mirror_address_status ON verified_address_mirror (address, status);
