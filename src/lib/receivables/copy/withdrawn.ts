/**
 * Copy for a withdrawn receivable (S2 soft delete): the list tag, the note above a withdrawn
 * record, the server's answer to a new write on one, the request-link pages' answer, and the
 * registry's withdraw button. Pure and import-free, like every module under
 * src/lib/receivables/copy/. Each string is held to the bright-line rules by
 * tests/receivables/copy.test.ts.
 *
 * Withdrawing hides a record from whoever recorded it and closes its open requests. It never
 * erases what other parties put on it: their claims and statements stay on file, and a claim can
 * still be marked repaid. {day} is a YYYY-MM-DD date, filled by src/lib/receivables/fillCopy.ts.
 */

// Tag pill (statusPill.ts): beside a row in a list (desk book State cell, registry "Your
// receivables") and at the start of the note above a withdrawn record. Never the record pill: that
// keeps the record's own state (disputed, fully financed, ...), which a withdrawal does not change.
export const TAG_WITHDRAWN = 'withdrawn';
export const TAG_WITHDRAWN_TITLE = 'Whoever recorded this receivable withdrew it. Your claim and the rest of its record stay on file.';

// The note above a withdrawn record on the desk and the registry page (src/lib/receivables/withdrawn.ts).
export const WITHDRAWN_LEAD_DATED = 'Withdrawn on {day} by whoever recorded it.';
export const WITHDRAWN_LEAD = 'Withdrawn by whoever recorded it.';
export const WITHDRAWN_RECORD_BODY = 'Everything already on file stays here, every claim and statement included. Almstins records nothing new against it, and a claim already on it can still be marked repaid.';

/** The message in a 410 withdrawn answer to a new claim, statement, request, offer or file. */
export const WITHDRAWN_WRITE_MESSAGE = 'This receivable was withdrawn on {day} by whoever recorded it. Almstins no longer records new claims, statements, requests or files on it. Everything already on file stays there.';

/** A request link (debtor confirmation, record check, offer, receipt) that answers 'withdrawn'.
 *  The link pages show it in place of advice to ask for a new link: a new one would answer the
 *  same way. */
export const WITHDRAWN_LINK_NOTE = 'Whoever recorded this receivable withdrew it, so nothing new is recorded on it, this answer included. Everything already on file stays there.';

/** The claim flow's note when the claim (or the diligence acceptance) answers withdrawn. */
export const WITHDRAWN_CLAIM_NOTE = 'This receivable was withdrawn by whoever recorded it, so your claim was not recorded. Claims and statements already on it stay on file.';

// Registry page, "Your receivables": the per-row withdraw button and its confirmation.
export const WITHDRAW_BUTTON_TITLE = 'Withdraw receivable';
export const WITHDRAW_CONFIRM = 'Withdraw this receivable? It leaves your list, its open requests stop working, and attached files are kept only as fingerprints. The record, and any claims and statements on it, stay on file for everyone who relies on them. Recording the same details again brings it back.';
