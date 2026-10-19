-- Agentics signups, the opening email: two columns on the table 0060 made. `opened_notified_at` says the
-- account has been told the vault is open (by the one opening email, or by a welcome letter sent once the
-- vault was already open); `open_claimed_at` is the once-only claim taken before that email is sent.
-- Nothing here sends anything: the email goes out only when an admin asks for it, after the vault is open
-- (src/lib/agenticsSignup.ts, sendOpeningNotices).
--
-- Also run lazily at runtime (ensureAgenticsSignupsTable); this file is the durable mirror, and
-- tests/agentics/doorSignup.test.ts keeps the two identical. Safe to run more than once.
ALTER TABLE agentics_signups ADD COLUMN IF NOT EXISTS open_claimed_at TEXT;
ALTER TABLE agentics_signups ADD COLUMN IF NOT EXISTS opened_notified_at TEXT;
