-- Almstins Verify — self-send proof of control (micro-deposit).
--
-- One pending challenge per address destination. Proving requires a NEW outgoing
-- transaction FROM the address after issued_at (only the keyholder can originate
-- it). Almstins observes the public chain read-only — it never sends, holds, or
-- signs, so a breach still can't move a coin. Mirrors the lazy ENSURE_DEPOSIT_SQL
-- in src/lib/verifyRegistry.ts.

CREATE TABLE IF NOT EXISTS verify_deposit_challenges (
  id              TEXT NOT NULL PRIMARY KEY,
  destination_id  TEXT NOT NULL,
  tenant_id       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  issued_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  last_checked_at TEXT,
  proven_at       TEXT,
  proof_ref       TEXT,
  created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
  updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);

CREATE UNIQUE INDEX IF NOT EXISTS verify_deposit_challenges_dest
  ON verify_deposit_challenges (destination_id);
