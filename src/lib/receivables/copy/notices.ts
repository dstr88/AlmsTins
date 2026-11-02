/**
 * Aging-notice copy (A4 / D8) — every string the desk inbox and the notice emails show, in one
 * place, so tests/receivables/copy.test.ts holds all of it to the bright lines (verifies /
 * records / flags / reminds; never stop, block, halt or prevent; no lien, priority or
 * credit-bureau implication; never "abandoned" — the public lapse word stays "lapsed — record
 * not maintained").
 *
 * Hard content rules (D8, locked 2026-10-31):
 *   - Every notice line carries the deal-identifier block — invoice number, amount + currency,
 *     promised payment date, claim-recorded date — so a client with several loans knows WHICH
 *     claim is meant.
 *   - NEVER in an email: the debtor/customer name (misdelivery would expose a commercial
 *     relationship), the extension reasons or notes (signed-in tier, D3), or a judgment word.
 *     No template below takes a party name; the only names a line carries are an invoice
 *     number and figures.
 *   - Subject lines stay generic: zero identifiers (lock screens, forward previews).
 *   - An email never says more than the record publicly shows: day 9 is lender-only exactly
 *     because the record still reads "due, in grace" then.
 */

// ── Subjects: generic on purpose, nothing a lock screen could leak ─────────────

export const NOTICE_SUBJECT_LENDER = 'Your financing desk: a record needs your update';
export const NOTICE_SUBJECT_CLIENT = 'A notice about a financing record on one of your invoices';

// ── The deal-identifier block (every line embeds it through these) ─────────────

/** The parenthetical facts: amount + currency, then the promised payment date when one exists. */
export const NOTICE_FACTS_DATED = '{amount}, payment promised {promised}';
export const NOTICE_FACTS_UNDATED = '{amount}, no promised payment date on record';

/** How a lender's own lines name the deal (the client lines spell theirs out in full). */
export const NOTICE_LENDER_DEAL = 'invoice {invoice} ({facts}, claim recorded {recorded})';

// ── Lender lines, one per notice ─────────────────────────────────────────────

export const NOTICE_LENDER_DAY9 =
	'Grace ends tomorrow on your claim against {deal}. One click on your desk records it settled, extended, or unpaid.';
export const NOTICE_LENDER_DAY15 =
	'Your claim against {deal} reads past due, not updated. Anyone checking the record sees that freshness.';
export const NOTICE_LENDER_DAY20 =
	'Your claim against {deal} still reads past due, not updated. This is the last reminder about this claim: one click on your desk records it settled, extended, or unpaid.';
export const NOTICE_LENDER_LAPSE_WARN =
	'Your claim against {deal} has had no dated update from you since {touched}. It lapses on {lapse} and is then no longer counted in the financing answer. One dated update keeps it counted.';
export const NOTICE_LENDER_LAPSED =
	'Your claim against {deal} is lapsed — record not maintained. It is no longer counted in the financing answer. One dated update from you counts it again.';

// ── Client lines (actor-voiced, same register as the A3 lookup copy) ────────────

export const NOTICE_CLIENT_DAY15 =
	'The claim recorded {recorded} against your invoice {invoice} ({facts}) has not been updated by its lender in {days} days.';
export const NOTICE_CLIENT_DAY20 =
	'The claim recorded {recorded} against your invoice {invoice} ({facts}) has not been updated by its lender in {days} days. This is the last reminder about this claim.';
export const NOTICE_CLIENT_LAPSED =
	'The claim recorded {recorded} against your invoice {invoice} ({facts}) is lapsed — record not maintained — and is no longer counted in the financing answer.';

// ── The lines under a deal block ────────────────────────────────────────────────

export const NOTICE_LENDER_OPEN = 'Update it from your desk: {url}';
export const NOTICE_CLIENT_CHECK = 'Check the record any time: {url}';

// ── Footers ─────────────────────────────────────────────────────────────────────

/** The same boundary line every receivables email already ends on. */
export const NOTICE_FOOTER =
	'Almstins Verify records and proves. It never holds or moves money, and it never says who anyone is.';
/** Client emails only: the opt-out link behind the suppression flag. */
export const NOTICE_OPTOUT_LINE = 'No more of these notices: {url}';

// ── The opt-out page (public, token-based, the unsubscribe pattern) ─────────────

export const OPTOUT_DONE_TITLE = 'Notices off';
export const OPTOUT_DONE_BODY =
	'You will get no further aging notices at this address. The records themselves are unchanged, and anyone holding a receivable ID can still check one any time.';
export const OPTOUT_BAD_TITLE = 'Link not recognized';
export const OPTOUT_BAD_BODY =
	'That opt-out link looks invalid. If these notices keep coming, write to support@almstins.com and we will turn them off for you.';

// ── The desk inbox (D5) ─────────────────────────────────────────────────────────

export const INBOX_HEADING = 'Needs an update';
export const INBOX_HINT =
	'Your own claims past their promised payment date, or in the grace window after it. Open one and record it settled, extended, or unpaid; the item clears itself once the record is current.';
export const INBOX_OPEN_TITLE = 'Open this record on your desk';
