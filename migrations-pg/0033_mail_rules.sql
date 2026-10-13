-- 0033_mail_rules.sql — file mail from a sender into a folder automatically.
--
--   npm run db:migrate
--
-- Thread-following (0028 + the threadFolder lookup) only catches REPLIES. A new message
-- from the same person about the same thing still lands in the Inbox. These rules close
-- that gap: bind a sender, or a whole domain, to a folder.
--
-- ── Precedence: thread beats sender ─────────────────────────────────────────
-- If a message is a reply to something in Pakistan but comes from an address bound to
-- Nairobi, it belongs with its conversation. The specific beats the general — otherwise
-- a thread splits the moment somebody new joins it.
--
-- ── Why there are no subject or keyword rules ───────────────────────────────
-- Deliberately absent. Sender and domain are facts about a message; a keyword match is
-- a guess about its meaning, and it is the point where mail filtering stops being a
-- tool you use and becomes a system you maintain — usually discovered while looking for
-- something that matched at the worst possible moment.

CREATE TABLE IF NOT EXISTS mail_rules (
    id          TEXT        PRIMARY KEY,
    mailbox     TEXT        NOT NULL,

    -- 'address' = one sender exactly · 'domain' = everyone at that domain.
    match_type  TEXT        NOT NULL CHECK (match_type IN ('address', 'domain')),

    -- Lowercased at write time; matching is exact, never partial. A substring match on
    -- a domain is how mail from evil-nairobi-scam.com ends up filed as trusted.
    match_value TEXT        NOT NULL,

    folder      TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One destination per sender: re-filing the same sender REPLACES the rule rather
    -- than creating a second one, so a message can never have two right answers.
    UNIQUE (mailbox, match_type, match_value)
);

CREATE INDEX IF NOT EXISTS mail_rules_box_idx ON mail_rules (mailbox);
