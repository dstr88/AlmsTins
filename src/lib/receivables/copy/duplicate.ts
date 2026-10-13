/**
 * Copy for the duplicate check (S3): the Verify now row, the claim-time warning and the answer to
 * a create whose exact details are already on record under another account. Pure and import-free,
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
