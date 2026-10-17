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

/** 429: too many checks in a short time. */
export const SEEN_BEFORE_RATE_LIMITED = 'Too many checks in a short time. Wait a minute and try again.';

// ── Result lines (the form's rendered answer; S6) ──
// Assembled by src/lib/receivables/seenBeforeView.ts. Only neutral values (a count, a date) are
// ever interpolated around these, so every sensitive phrase lives here where
// tests/receivables/copy.test.ts holds it to the bright line. A match is "on record", never a
// lien, a rank or a legal status; "not found" is never a clean bill. The check warns; the person
// decides.

/** Heading: a match exists but carries no active financing claim. */
export const SEEN_BEFORE_ON_RECORD = 'This invoice is already on record at Almstins.';

/** Heading: some matching record is recorded as financed. */
export const SEEN_BEFORE_FINANCED = 'This invoice is recorded as financed at Almstins.';

/** Heading: a match is settled, and none is financed. */
export const SEEN_BEFORE_SETTLED = 'This invoice is on record at Almstins and recorded as settled.';

/** The caution every match carries: a warning, not a clearance and not a legal status. */
export const SEEN_BEFORE_MATCH_CAVEAT = 'This is a warning that a record exists, not a clean bill and not a legal status. Almstins keeps the record; it does not rank claims or decide anything. You decide how to proceed.';

/** One matching record. */
export const SEEN_BEFORE_MATCHES_ONE = 'One matching record is on file.';

/** 2 to 4 matching records: shown as "<n> matching records are on file." */
export const SEEN_BEFORE_MATCHES_FEW = 'matching records are on file.';

/** 5 or more matching records. */
export const SEEN_BEFORE_MATCHES_MANY = 'Five or more matching records are on file.';

/** financing = partial. */
export const SEEN_BEFORE_FIN_PARTIAL = 'A financing claim covers part of its face value.';

/** financing = full. */
export const SEEN_BEFORE_FIN_FULL = 'A financing claim covers its full face value.';

/** financing = over. */
export const SEEN_BEFORE_FIN_OVER = 'Financing claims on record add up to more than its face value.';

/** claimsAffirmed = all. */
export const SEEN_BEFORE_AFFIRMED_ALL = 'The financing client confirms the advance arrived.';

/** claimsAffirmed = some. */
export const SEEN_BEFORE_AFFIRMED_SOME = 'Some financing on it is confirmed received, some is not.';

/** claimsAffirmed = none, with a claim present. */
export const SEEN_BEFORE_AFFIRMED_NONE = 'No financing client has confirmed an advance yet.';

/** debtor = confirmed. */
export const SEEN_BEFORE_DEBTOR_CONFIRMED = 'The debtor confirmed this debt through a request link.';

/** debtor = disputed. */
export const SEEN_BEFORE_DEBTOR_DISPUTED = 'The debtor disputed this record (not theirs, or the amount is wrong).';

/** A matching record was withdrawn by its owner (S2). */
export const SEEN_BEFORE_WITHDRAWN = 'A matching record was withdrawn by its owner. Its evidence stays answerable, but it is no longer active.';

/** refChecked and the reference matched too. */
export const SEEN_BEFORE_REF_MATCH = 'The debtor’s reference matched as well.';

/** refChecked but the reference differed: perhaps a separate item under one order. */
export const SEEN_BEFORE_REF_DIFF = 'The invoice matched, but the debtor’s reference differed. It may be a separate item under the same order.';

/** Prefix for the first-seen date; a plain YYYY-MM-DD follows. */
export const SEEN_BEFORE_FIRST_SEEN_PREFIX = 'First recorded at Almstins on ';

/** Shown to a signed-in account that is not verified, beneath a found or not-found answer. */
export const SEEN_BEFORE_VERIFY_FOR_MORE = 'Verify your email, or sign in with Google or GitHub, to see financing status, the debtor’s confirmation and when it was first recorded.';

/** The sign-in link's label (401). */
export const SEEN_BEFORE_SIGN_IN_CTA = 'Sign in to check';
