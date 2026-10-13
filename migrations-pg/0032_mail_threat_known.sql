-- 0032_mail_threat_known.sql — allow a POSITIVE finding.
--
--   npm run db:migrate
--
-- mail_threats.severity was danger|warning: the table could only say what was wrong.
-- 'known' records the opposite — this address is already on file for a member of the
-- programme, and verified.
--
-- That is not decoration. A susu organizer's live risk is the swapped payout address:
-- a routine-looking message carrying an address that is NOT the one on record. Marking
-- the addresses that ARE on record is what makes an unmarked one stand out. A checker
-- that can only shout "danger" is silent in exactly the case that matters most, because
-- a swapped address is usually a clean address — it just belongs to the wrong person.

ALTER TABLE mail_threats DROP CONSTRAINT IF EXISTS mail_threats_severity_check;

ALTER TABLE mail_threats
    ADD CONSTRAINT mail_threats_severity_check
    CHECK (severity IN ('danger', 'warning', 'known'));
