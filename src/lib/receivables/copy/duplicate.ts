/**
 * Copy for the duplicate check (S3): the Verify now row, the claim-time warning and the answer to
 * a create whose exact details are already on record under another account. S4 adds the pages'
 * words: the debtor reference field, the warning while the invoice is entered and after it is
 * saved, the record view, the claim prompt and the book tag. Pure and import-free,
 * like every module under src/lib/receivables/copy/. Held to the bright-line rules by
 * tests/receivables/copy.test.ts.
 *
 * The registry is a voluntary record. These lines say what is on record at Almstins and whether it
 * is recorded as financed, never that an invoice is free of other financing, and never anything
 * about rank or legal effect. The check warns; the person decides.
 */

/** The Verify now check's label. */
export const DUPLICATE_CHECK_LABEL = 'Duplicate check';

/** Verify now, pass: a debtor reference is recorded and nothing else matches. */
export const DUPLICATE_DETAIL_PASS = 'No other record at Almstins matches this invoice, on the debtor’s reference or on the invoice number.';

/** Verify now, warn, for a verified account: another record matches and an active claim stands against it. */
export const DUPLICATE_DETAIL_FINANCED = 'Another record at Almstins matches this invoice and is recorded as financed. Check with the debtor before you advance.';

/** Verify now, warn, for a verified account: another record matches; nothing on it is recorded as financed. */
export const DUPLICATE_DETAIL_MATCH = 'Another record at Almstins matches this invoice. It is not recorded as financed there. Check with the debtor before you advance.';

/** Verify now, warn, for an account that is not verified: another record matches. It says nothing
 *  about whether that record is financed or which details matched (owner decision 9). Also the
 *  wording kept in the stored re-verification, which anyone holding the receivable ID can read. */
export const DUPLICATE_DETAIL_ANY_MATCH = 'Another record at Almstins matches this invoice. Check with the debtor before you advance.';

/** Added after either verified-account match detail when only the debtor's reference matched. */
export const DUPLICATE_DETAIL_REFERENCE_ONLY = 'It matches on the debtor’s reference and amount only, so it may be another installment under the same order.';

/** Verify now, warn: no debtor reference, so only the invoice number was compared. */
export const DUPLICATE_DETAIL_NO_REFERENCE = 'No debtor reference (the debtor’s own PO or contract number) is recorded, so only the invoice number could be compared.';

/** Verify now, warn: the check could not run. */
export const DUPLICATE_DETAIL_UNAVAILABLE = 'The duplicate check is not available right now, so it is treated as unproven.';

/** The 409 possible_duplicate answer to a claim from a verified caller that accepts warnings. */
export const POSSIBLE_DUPLICATE_MESSAGE = 'Another record at Almstins matches this invoice and is recorded as financed. Check with the debtor before you advance. To record your claim anyway, send it again acknowledging possible_duplicate.';

/** The same 409 for an account that is not verified: raised on any match, financed or not. */
export const POSSIBLE_MATCH_MESSAGE = 'Another record at Almstins matches this invoice. Check with the debtor before you advance. To record your claim anyway, send it again acknowledging possible_duplicate.';

/** The 400 answer to an acknowledgment code this server does not know. */
export const UNKNOWN_ACKNOWLEDGMENT_MESSAGE = 'One or more acknowledgment codes are not recognized.';

/** The 409 id_collision answer: these exact details are already on record under another account. */
export const ID_COLLISION_MESSAGE = 'A receivable with these exact details is already on record at Almstins under another account.';

// ── S4: the create forms, the live warning, the record view, the claim prompt and the book ──

/** The debtor reference field on the desk, registry and Client Portal create forms (BuyerRefField). */
export const BUYER_REF_LABEL = 'Debtor’s own reference';
export const BUYER_REF_PLACEHOLDER = 'Their PO or contract no.';
export const BUYER_REF_HINT = 'Optional. With the debtor’s own PO or contract number, the duplicate check can compare this invoice on that number, not only on the invoice number.';

/** The flag's title on every possible-duplicate answer: while typing, after saving, on the record and at claim time. */
export const DUPLICATE_FLAG_TITLE = 'Possible duplicate.';

/** While the invoice is being entered (Addendum A), for a verified account, when the matching record is recorded as financed. */
export const PRECHECK_FINANCED = 'This invoice may already be financed. Check with the debtor before you advance.';

/** While the invoice is being entered: the warning never holds up the form. */
export const PRECHECK_PROCEED = 'You can still record it. The decision is yours.';

/** Client Portal, while he enters it: the client records his own invoice, so a match is often his
 *  financier’s own record of it. */
export const CLIENT_MATCH = 'Another record at Almstins matches this invoice. If your financier already recorded it, you do not need to record it again.';

/** Client Portal, once recorded (just saved, or opened in "Where it stands"). */
export const CLIENT_RECORD_MATCH = 'Another record at Almstins matches this invoice. It may be your financier’s own record of it.';

/** Lead line above the viewer's own matching records (a verified account only). */
export const OWN_MATCHES_LEAD = 'Your own records that match:';

/** After an own match that its owner withdrew. */
export const OWN_MATCH_WITHDRAWN = '(withdrawn)';

/** The claim prompt (AckPrompt), after the match line: what going ahead records. */
export const CLAIM_DUPLICATE_SIGNED = 'If you record your claim anyway, that acknowledgment is signed into it.';
export const CLAIM_DUPLICATE_RECORD_ANYWAY = 'Record my claim anyway (acknowledged possible duplicate)';
export const CLAIM_DUPLICATE_NOT_NOW = 'Not now';

/** Added to the note after a recorded claim. */
export const CLAIM_NOTICE_ACKNOWLEDGED = 'Your acknowledgment of the possible duplicate is signed into this claim.';
export const CLAIM_NOTICE_POSSIBLE_DUPLICATE = 'Another record at Almstins matches this invoice.';
export const CLAIM_NOTICE_UNAVAILABLE = 'The duplicate check was not available, so this claim was recorded without it.';

/** The claim answered possible_duplicate again after the acknowledgment was sent. */
export const CLAIM_DUPLICATE_STILL = 'Your claim was not recorded: the duplicate check still asks for an acknowledgment. Reload the page and try again.';

/** The book tag (StatusPill) beside a row that another record at Almstins matches, financed or not. */
export const TAG_POSSIBLE_DUPLICATE = 'possible duplicate';
export const TAG_POSSIBLE_DUPLICATE_TITLE = 'Another record at Almstins matches this invoice.';

/** The desk's "Before you advance": what the duplicate check does not prove. */
export const NOT_PROVEN_DUPLICATE_TITLE = 'That the invoice is not a duplicate';
export const NOT_PROVEN_DUPLICATE_DETAIL = 'The duplicate check compares this invoice with other records at Almstins, on the debtor’s reference or the invoice number, at the same amount and currency. A record with a different amount, or one kept outside Almstins, is not compared.';
