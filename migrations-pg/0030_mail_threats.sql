-- 0030_mail_threats.sql — run incoming mail through the wallet checker.
--
--   npm run db:migrate
--
-- Every message is scanned for wallet addresses and links as it arrives, and each one
-- is put through the same checks the public /wallet-checker uses: the phishing domain
-- lists for URLs, the scam/sanctions/honeypot checks for addresses.
--
-- Why this belongs here specifically: a susu organizer is a high-value phishing target.
-- "Confirm your payout address" with a lookalike link is the attack, and the operator
-- who reaches his mail only through this panel has no other client that would warn him.
-- The product already owns the detection — it was simply not pointed at the inbox.
--
-- Findings are rows rather than a column so one message can carry several, and so the
-- panel can name WHAT was flagged instead of only that something was.

CREATE TABLE IF NOT EXISTS mail_threats (
    id         TEXT        PRIMARY KEY,
    message_id TEXT        NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,

    -- 'address' | 'url'
    kind       TEXT        NOT NULL CHECK (kind IN ('address', 'url')),

    -- The address or domain as found in the message. Stored so the panel can show the
    -- operator exactly which string is the problem — a warning that does not say what
    -- it is warning about teaches him to ignore warnings.
    value      TEXT        NOT NULL,

    -- 'danger' | 'warning'. danger = on a blocklist or sanctioned; warning = suspicious
    -- but not confirmed (young wallet, insufficient data).
    severity   TEXT        NOT NULL CHECK (severity IN ('danger', 'warning')),

    -- Human-readable reason, e.g. 'Known phishing domain' or 'OFAC sanctioned'.
    reason     TEXT        NOT NULL DEFAULT '',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The same address appearing twice in one message is one finding, not two.
    UNIQUE (message_id, kind, value)
);

CREATE INDEX IF NOT EXISTS mail_threats_msg_idx ON mail_threats (message_id);

-- Denormalized worst-severity marker, so the list query can render the row without a
-- join per message. Recomputed whenever findings are written.
ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS threat_level TEXT
        CHECK (threat_level IS NULL OR threat_level IN ('danger', 'warning'));

-- Set when the scan has actually run, so an unscanned message (scanner offline, or
-- mail that predates this feature) is distinguishable from one scanned and found
-- clean. Silence should never be mistaken for a clean bill of health.
ALTER TABLE mail_messages
    ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS mail_messages_threat_idx
    ON mail_messages (mailbox, sent_at DESC)
    WHERE threat_level IS NOT NULL;
