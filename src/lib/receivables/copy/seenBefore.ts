/**
 * Copy for "Seen before?" (S5): the check that asks whether an invoice is already on record at
 * Almstins, before anyone advances against it. The answers of POST /api/verify/receivables/check
 * that carry words: sign in, the demo account, the check not running, and the 400 messages. Pure
 * and import-free, like every module under src/lib/receivables/copy/. Held to the bright-line
 * rules by tests/receivables/copy.test.ts.
 *
 * The registry is a voluntary record. A match is "on record at Almstins" or "recorded as financed";
 * no match is never a clean bill, and nothing here says anything about rank or legal effect. When
 * the check cannot run, the answer says so and is never read as no match. The check warns; the
 * person decides.
 */

/** 401: no session. */
export const SEEN_BEFORE_SIGN_IN = 'Sign in to check whether an invoice is on record at Almstins.';

/** 403: the shared demo account. */
export const SEEN_BEFORE_DEMO = 'The demo account cannot run this check. Sign up free to check whether an invoice is on record at Almstins.';

/** 503: the check could not run (no key, fingerprints still being computed, or a store error). */
export const SEEN_BEFORE_UNAVAILABLE = 'The check could not run just now. Try again in a minute. This is not an answer about the invoice.';

/** What "not found" means, and what it does not. */
export const SEEN_BEFORE_NOT_FOUND_MEANING = 'No exact record of this invoice is on record at Almstins. That is not a clean bill: it covers only records kept at Almstins with the same supplier, debtor, invoice number, amount and currency.';

// ── 400 answers (parseSeenBeforeBody) ──

/** The body is not { invoice: { ... } }. */
export const SEEN_BEFORE_INVALID_BODY = 'Send a JSON body with an invoice object: supplier, buyer, invoiceNo, face and currency, and buyerRef if you have it.';

/** The supplier, the debtor (buyer) or the invoice number is missing or empty. */
export const SEEN_BEFORE_INVALID_PARTIES = 'The supplier, the debtor (buyer) and the invoice number are required, as text.';

/** No currency. Checked as typed, so an empty currency is never read as a default one. */
export const SEEN_BEFORE_INVALID_CURRENCY = 'A currency is required, as text (for example USD).';

/** The face value is not a positive number. */
export const SEEN_BEFORE_INVALID_FACE = 'Face value must be a positive number, sent as a JSON number (not text).';

/** buyerRef was sent, but not as text. */
export const SEEN_BEFORE_INVALID_BUYER_REF = 'The debtor’s own reference (buyerRef) must be text when it is sent.';

/** A name or the invoice number has no letter or digit left once punctuation is set aside. */
export const SEEN_BEFORE_INVALID_NAMES = 'The supplier, the debtor and the invoice number each need at least one letter or number.';
