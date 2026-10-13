-- Almstins Verify — Phase 5 published-source swap monitor.
--
-- A destination can carry an optional public page URL (the "pay to this address"
-- page, donation page, invoice, or checkout that embeds the payment link) that the
-- watchman cron re-fetches to confirm the registered value is still the one shown.
-- A definitive swap (registered value gone + a conflicting same-kind value present)
-- alerts the owner; an ambiguous result is recorded, never alerted.
--
-- Mirrors the lazy ENSURE_MONITOR_COLS in src/lib/verifyRegistry.ts. Read-only,
-- owner→self, no attribution: we only read the owner's OWN public page.

ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS monitor_url        TEXT;
ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS monitor_status     TEXT;
ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS monitor_checked_at TEXT;
