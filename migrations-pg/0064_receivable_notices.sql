-- Receivables aging notices (A4 / D8). Mirrors the lazy runtime DDL in
-- src/lib/receivables/schema.ts (CREATE_NOTICE_LOG, CREATE_NOTICE_OPTOUTS), which
-- ensureReceivablesTables() runs on first use — this file is the reference copy, not a
-- deploy step.

-- One row per aging-notice email ever sent: (claim, notice, recipient role). The daily
-- cron checks this before sending and writes it only after the send succeeded. Bookkeeping
-- only — no address or tenant is stored here.
CREATE TABLE IF NOT EXISTS receivable_notice_log (
  claim_id       TEXT NOT NULL,
  notice         TEXT NOT NULL,
  recipient_role TEXT NOT NULL,
  sent_at        TEXT NOT NULL,
  PRIMARY KEY (claim_id, notice, recipient_role)
);

-- The client-side suppression flag behind the opt-out link every client notice carries.
-- Keyed by lowercased address; the token is the unguessable capability the link carries.
-- suppressed_at set means no further client notices to that address.
CREATE TABLE IF NOT EXISTS receivable_notice_optouts (
  email         TEXT NOT NULL PRIMARY KEY,
  token         TEXT NOT NULL,
  suppressed_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
);
