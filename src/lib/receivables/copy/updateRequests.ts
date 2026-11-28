/**
 * Update-request copy (Part A, approved 2026-11-28): every string the "Ask the lender to update"
 * card and the lender's request emails show. Pure and import-free, like the other copy modules.
 *
 * Rules: the requester is never named to the lender unless it is the client ("your client", never
 * a name); the lender's address never appears to a requester; the public line counts days, not
 * clicks; the line a clicker sees is the same for the first and the eleventh ("has been asked",
 * never "email sent"); the lender's answer is the update itself, so nothing here invites a reply.
 * No em dashes.
 */

export const UR_TITLE = 'Ask the lender to update';
export const UR_LEDE_PUBLIC =
	'A claim on this record has passed its promised date with no update from its lender. You can ask the lender to update it. The lender is not told who asked.';
export const UR_LEDE_CLIENT =
	'You can ask the lender to update any open claim on your invoice. The lender is told the request came from you. Updating the claim is the answer.';
export const UR_LEDE_LENDER =
	'Requests for an update on your claims. Updating the claim is the answer: record it settled, extended or unpaid.';
export const UR_BUTTON = 'Ask the lender to update';
export const UR_SENDING = 'Asking…';
export const UR_NOTE_LABEL = 'Note for the lender (optional)';
export const UR_NOTE_HINT = 'Up to 280 characters. Only the lender sees it. It never goes on the public record.';
export const UR_NOTE_PLACEHOLDER = 'For example: the debtor paid on the 20th, please release';

/** One claim's name on the card: public fields only. */
export const UR_CLAIM_LABEL = '{financier}, {amount}, recorded {date}';

/** The honest line every clicker sees. {when} is "today, 2:14 PM" or a date and time. */
export const UR_ASKED = 'The lender has been asked to update this record. Last asked: {when}.';
export const UR_TODAY = 'today, {time}';

/** The public record line: days, not clicks. */
export const UR_REQUESTED_ONE = 'Update requested on {first}.';
export const UR_REQUESTED_MANY = 'Update requested on {days} days since {first}; last {last}.';

/** A client request, on the lender's and the client's own pages. */
export const UR_CLIENT_LINE = 'The client asked for an update on {when}.';
export const UR_YOUR_LINE = 'You asked for an update on {when}.';
export const UR_CLIENT_NOTE = 'Note: {note}';

export const UR_ERR_RATE = 'Too many requests. Try again in a minute.';
export const UR_ERR_WITHDRAWN = 'This record was withdrawn by its owner, so it takes no requests.';
export const UR_ERR_NOT_OPEN = 'This claim takes no request right now.';
export const UR_ERR_DEMO = 'The demo is read-only, so it sends no requests.';
export const UR_ERR_FAILED = 'The request did not go through. Try again.';
export const UR_ERR_NOTE = 'The note can be at most 280 characters.';

/** The version of the lender's request emails below, written to each log row on send (email
 *  statement). Bump it whenever their wording changes; emailTemplateVersions.test.ts pins it. */
export const UR_TEMPLATE_VERSION = 'update-requests/1';

// ── The lender's emails (account mail, generic subjects, a link to his desk only) ─────────

export const UR_SUBJECT_CLIENT = 'Your financing desk: your client asked for an update';
export const UR_SUBJECT_SUMMARY = 'Your financing desk: updates requested';
/** {deal} is the aging notices' lender deal block; {state} the record's public aging label. */
export const UR_EMAIL_CLIENT =
	'Your client asked you to update your claim against {deal}. The record reads: {state}.';
export const UR_EMAIL_CLIENT_NOTE = 'Their note: "{note}"';
export const UR_EMAIL_SUMMARY_LEAD =
	'Someone holding the receivable ID asked you to update these claims. Almstins does not know or record who asked.';
export const UR_EMAIL_SUMMARY_ITEM =
	'Your claim against {deal} reads: {state}. An update was asked for on {count} ({days}).';
export const UR_EMAIL_ANSWER = 'Updating the claim on your desk is the answer. Nobody is waiting on a reply.';
