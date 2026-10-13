-- 0027_mail_attachments.sql — files that arrive attached to operator mail.
--
--   npm run db:migrate
--
-- Needed because the /admin panel is the ONLY way one of the operators reaches his
-- mailbox. Dropping attachments would mean a signed document or an invoice arrives and
-- he can see that someone wrote to him but has no way to open what they sent.
--
-- Stored as base64 TEXT rather than BYTEA, matching the PetroTins receipt pattern
-- already in this codebase — the db shim moves strings cleanly and the volume here is
-- small. Revisit if mail volume ever makes the table large; object storage is the right
-- answer at scale, and this is deliberately not that.
--
-- Not tenant-scoped, for the same reason as mail_messages (see 0026_mail.sql): this is
-- operator correspondence, guarded by requireAdminSession on every path rather than by
-- a tenant_id column. Reaching a row here also requires owning the parent mailbox.

CREATE TABLE IF NOT EXISTS mail_attachments (
    id           TEXT   PRIMARY KEY,

    -- Parent message. Cascade so deleting a message never orphans its files.
    message_id   TEXT   NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,

    filename     TEXT   NOT NULL DEFAULT 'attachment',
    content_type TEXT   NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   BIGINT NOT NULL DEFAULT 0,

    -- base64 of the file. NULL when the file exceeded the size cap — the row still
    -- exists so the UI can say "this was too large" instead of silently showing
    -- nothing, which would look identical to no attachment at all.
    content_b64  TEXT,

    -- Set when content_b64 is NULL, explaining why. e.g. 'too_large'.
    skipped      TEXT
);

CREATE INDEX IF NOT EXISTS mail_attachments_msg_idx
    ON mail_attachments (message_id);
