-- Agentics signups, for the admin page (src/pages/admin/agentics.astro): two columns on the table 0060 made.
-- `country` is the two-letter code Cloudflare gave the account's first visit that had one (never looked up
-- from an IP); `last_seen_at` is when the account last opened Agentics, moved at most once an hour
-- (src/lib/agenticsSignup.ts, touchSignup).
--
-- Also run lazily at runtime (ensureAgenticsSignupsTable); this file is the durable mirror, and
-- tests/agentics/doorSignup.test.ts keeps the two identical. Safe to run more than once.
ALTER TABLE agentics_signups ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE agentics_signups ADD COLUMN IF NOT EXISTS last_seen_at TEXT;
