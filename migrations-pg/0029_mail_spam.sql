-- 0029_mail_spam.sql — carry the mail server's own spam verdict into the panel.
--
--   npm run db:migrate
--
-- The server already judges every message: cPanel runs SpamAssassin, which stamps
-- X-Spam-Flag / X-Spam-Status / X-Spam-Score into the headers before delivery. We were
-- discarding that and rendering a flagged message identically to a clean one.
--
-- That matters more here than in an ordinary mail client. One operator reaches his
-- mail ONLY through this panel, so if the panel does not show the warning, there is no
-- other screen where he would see it. A phishing mail aimed at a susu organizer —
-- "confirm your payout address" — is exactly the message that must not arrive looking
-- like every other message.
--
-- Note this covers spam DELIVERED TO THE INBOX. Anything the server filed into Junk is
-- not polled at all (see isHiddenFolder), so the panel never shows it in the first
-- place. These columns are for the ones that scored high but were let through.

ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS spam_flag BOOLEAN NOT NULL DEFAULT false;

-- SpamAssassin's numeric score. Kept alongside the flag because the threshold is the
-- server's opinion and the number lets the panel show degrees — a 4.5 that squeaked
-- past a 5.0 threshold is worth a quieter mark than a 19.
ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS spam_score NUMERIC(6,2);

-- Partial index: flagged mail is the rare case, and this is what a "show me what got
-- through" query would scan.
CREATE INDEX IF NOT EXISTS mail_messages_spam_idx
    ON mail_messages (mailbox, sent_at DESC)
    WHERE spam_flag = true;
