-- How many times the public pre-send check (/api/verify/check) answered, per UTC day, per kind of
-- caller (anonymous or keyed) and per answer (proven, mismatch, unanchored, unknown). Counts only:
-- no address, no payment link, no IP, no key, nothing about who asked or what about.
--
-- Also created lazily at runtime (ensureCheckCountsTable in src/lib/checkCounts.ts); this file is
-- the durable mirror, and tests/verify/checkCounts.test.ts keeps the two identical. Safe to run
-- more than once.
CREATE TABLE IF NOT EXISTS verify_check_counts (
    day    TEXT NOT NULL,
    caller TEXT NOT NULL,
    status TEXT NOT NULL,
    n      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, caller, status)
  );
