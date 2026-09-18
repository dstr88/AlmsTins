-- Verify watchman: fail-closed TTL for merchant destinations + a cron dead-man's-switch.
-- Both are also created lazily at runtime (verifyRegistry.ensureVerifyTables / cronHeartbeat);
-- this migration is the durable mirror.

-- last_confirmed_at: the last time the watchman POSITIVELY re-confirmed a destination (its
-- domain proof still vouches it, or its published page still shows it). The public lookup treats
-- a domain-anchored destination as 'verified' only while this stays within the 24h max-stale
-- window; a stale one degrades to 'claimed'. Advanced ONLY on a positive confirm, so a blind
-- monitor (source unreachable, value now JS-rendered, cron stalled) fails safe instead of
-- vouching a destination it can no longer see.
ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS last_confirmed_at TEXT;

-- cron_heartbeat: each scheduled job records a success here; a different, frequently-running job
-- (refresh-threat-lists) checks these and emails the owner when one goes quiet. last_alerted_at
-- latches the alert so a stale job is reported once per window, and is cleared on the next success.
CREATE TABLE IF NOT EXISTS cron_heartbeat (
  name            TEXT PRIMARY KEY,
  last_success_at TEXT,
  last_alerted_at TEXT,
  updated_at      TEXT NOT NULL
);
