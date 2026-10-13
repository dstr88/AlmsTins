-- 0026_mail.sql — operator mailboxes rendered inside /admin.
--
--   npm run db:migrate
--
-- The two windows on /admin (admin@ and a second mailbox here; donnie@ and hello@ on the
-- Almstins side) read from this table. A cron polls each mailbox over IMAP and
-- inserts what it finds; replies and new messages sent from /admin are written back
-- here as direction='out' so the panel shows a conversation, not just a feed.
--
-- ── DELIBERATELY NOT TENANT-SCOPED ───────────────────────────────────────────
-- Every other table in this schema carries tenant_id and every query filters on it.
-- This one does not, and that is not an oversight. Operator mail is not tenant data:
-- it is the operator's own correspondence, it belongs to no tenant, and there is no
-- tenant_id that would be correct to put here. The isolation guarantee is preserved
-- by a different mechanism — EVERY read and write path is behind requireAdminSession
-- (src/lib/adminGuard.ts), and no tenant-facing endpoint may ever join to this table.
--
-- If you are adding a query against mail_messages: it belongs under /api/admin/ or in
-- an admin-guarded .astro frontmatter. Nowhere else. A tenant must never be able to
-- reach a row here, and since there is no tenant_id column there is also no
-- accidental "forgot the WHERE clause" leak shape — the failure mode would be an
-- unguarded endpoint, so guard the endpoint.

CREATE TABLE IF NOT EXISTS mail_messages (
    id           TEXT        PRIMARY KEY,

    -- Which mailbox this belongs to, as the full address (e.g. 'admin@susufinance.com').
    -- Matches MAILBOX_n_ADDRESS in the env config (src/lib/mailboxes.ts). Stored as the
    -- address rather than an index so re-ordering the env vars cannot re-point history.
    mailbox      TEXT        NOT NULL,

    -- 'in'  = pulled from the mailbox by the IMAP poll
    -- 'out' = composed or replied from /admin and sent by us
    direction    TEXT        NOT NULL CHECK (direction IN ('in', 'out')),

    -- ── IMAP identity (inbound only; NULL for direction='out') ───────────────
    -- A UID is unique only within a UIDVALIDITY epoch. If the server ever resets
    -- UIDVALIDITY the old UIDs may be reissued, so dedupe MUST key on both or the
    -- poll will silently skip new mail that reuses an old number.
    uid          BIGINT,
    uid_validity BIGINT,

    -- ── Threading (RFC 5322) ─────────────────────────────────────────────────
    -- A reply that omits in_reply_to/refs arrives in the recipient's client as a new
    -- unrelated message. These are what make a reply thread instead of orphan.
    message_id   TEXT,
    in_reply_to  TEXT,
    refs         TEXT,

    -- ── Envelope ─────────────────────────────────────────────────────────────
    from_addr    TEXT        NOT NULL DEFAULT '',
    from_name    TEXT,
    to_addrs     TEXT        NOT NULL DEFAULT '',
    cc_addrs     TEXT,
    subject      TEXT        NOT NULL DEFAULT '',

    -- Both kept. body_text is what the panel renders (safe, no markup); body_html is
    -- retained so nothing is lost, but it is NEVER injected into the page as markup.
    body_text    TEXT        NOT NULL DEFAULT '',
    body_html    TEXT,

    -- When the message was actually sent, per its own headers. Distinct from
    -- fetched_at, which is when we learned about it — they can differ by days if the
    -- poll was down.
    sent_at      TIMESTAMPTZ,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Read state is ours, not the mail server's. Marking read in /admin does not
    -- reach back to IMAP; the mailbox stays authoritative for itself.
    read_at      TIMESTAMPTZ,

    -- Set when an outbound send fails, so the panel can show it rather than pretending
    -- the message left. NULL on success.
    send_error   TEXT
);

-- Dedupe for the poll: the same message must not be inserted twice across runs.
-- Partial (direction='in') because outbound rows have no UID and would all collide
-- on (NULL, NULL) under a plain unique index.
CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_uid_idx
    ON mail_messages (mailbox, uid_validity, uid)
    WHERE direction = 'in';

-- The panel's only list query: one mailbox, newest first.
CREATE INDEX IF NOT EXISTS mail_messages_box_idx
    ON mail_messages (mailbox, sent_at DESC NULLS LAST);

-- Unread badge count per mailbox.
CREATE INDEX IF NOT EXISTS mail_messages_unread_idx
    ON mail_messages (mailbox)
    WHERE direction = 'in' AND read_at IS NULL;

-- Thread assembly — pulling a conversation together by Message-ID reference.
CREATE INDEX IF NOT EXISTS mail_messages_thread_idx
    ON mail_messages (message_id);
