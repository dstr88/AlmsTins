-- 0028_mail_folders.sql — mail_messages becomes folder-aware.
--
--   npm run db:migrate
--
-- The panel grows Inbox / Sent / Drafts tabs plus whatever else a mailbox holds, so a
-- row now has to record WHICH folder it came from.
--
-- ── The trap this migration exists to close ──────────────────────────────────
-- IMAP UIDs are unique per FOLDER, not per mailbox. The same number 41 can name a
-- message in INBOX and a different message in Sent. The old unique index was
--
--     UNIQUE (mailbox, uid_validity, uid) WHERE direction = 'in'
--
-- which is wrong in two ways the moment a second folder is polled:
--
--   1. No folder in the key — INBOX 41 and Sent 41 collide, and the second one is
--      silently dropped by ON CONFLICT DO NOTHING. Mail would go missing with no error.
--   2. The predicate is direction='in', but Sent messages are stored direction='out'.
--      They would fall outside the index entirely and be re-inserted on EVERY poll,
--      duplicating without limit.
--
-- The replacement keys on folder and applies to every polled row, identified by
-- uid IS NOT NULL. Rows we author locally (a sent message recorded before its IMAP
-- copy exists) have a NULL uid and stay outside the index, which is correct — they
-- are not deduped against the server because they did not come from it.

ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT 'INBOX';

-- What the folder is FOR, from the IMAP SPECIAL-USE extension: '\Sent', '\Drafts',
-- '\Junk', '\Archive', or NULL for an ordinary folder. Servers disagree wildly on
-- folder NAMES ('Sent' vs 'Sent Items' vs 'INBOX.Sent'), so the UI groups by this
-- rather than by string matching on the path.
ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS special_use TEXT;

DROP INDEX IF EXISTS mail_messages_uid_idx;

CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_uid_idx
    ON mail_messages (mailbox, folder, uid_validity, uid)
    WHERE uid IS NOT NULL;

-- The panel's list query is now per mailbox AND folder.
DROP INDEX IF EXISTS mail_messages_box_idx;
CREATE INDEX IF NOT EXISTS mail_messages_box_idx
    ON mail_messages (mailbox, folder, sent_at DESC NULLS LAST);

-- Unread counts are an inbox concept — a Sent or Drafts message is never "unread".
DROP INDEX IF EXISTS mail_messages_unread_idx;
CREATE INDEX IF NOT EXISTS mail_messages_unread_idx
    ON mail_messages (mailbox, folder)
    WHERE direction = 'in' AND read_at IS NULL;

-- Per-mailbox, per-folder sync cursor. Kept as a table rather than derived with
-- MAX(uid) so that a folder which has been emptied does not reset to zero and re-fetch
-- its entire history on the next run.
CREATE TABLE IF NOT EXISTS mail_folder_state (
    mailbox      TEXT        NOT NULL,
    folder       TEXT        NOT NULL,
    uid_validity BIGINT      NOT NULL,
    last_uid     BIGINT      NOT NULL DEFAULT 0,
    special_use  TEXT,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (mailbox, folder)
);

-- Drafts composed in the panel. The IMAP Drafts folder is authoritative; this table
-- only remembers which IMAP message a given panel draft became, so that editing a
-- draft replaces the server copy instead of appending a second one every save.
CREATE TABLE IF NOT EXISTS mail_drafts (
    id          TEXT        PRIMARY KEY,
    mailbox     TEXT        NOT NULL,
    -- UID of the current server copy, NULL until the first successful append.
    imap_uid    BIGINT,
    imap_folder TEXT,
    to_addrs    TEXT        NOT NULL DEFAULT '',
    cc_addrs    TEXT,
    subject     TEXT        NOT NULL DEFAULT '',
    body_text   TEXT        NOT NULL DEFAULT '',
    -- Set when this draft is a reply, so sending it threads correctly.
    reply_to_id TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_drafts_box_idx
    ON mail_drafts (mailbox, updated_at DESC);
