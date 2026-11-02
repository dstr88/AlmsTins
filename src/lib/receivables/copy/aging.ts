/**
 * Aging copy — every string the aging feature shows or returns, in one place, so
 * tests/receivables/copy.test.ts holds all of it to the bright lines (verifies / flags /
 * records / revalidates; never stop, block, halt or prevent; no lien, priority or
 * credit-bureau implication).
 *
 * The lapse wording is about the RECORD, never the loan or the lender's rights: a lapsed
 * claim's record was not maintained, so it is no longer counted — nothing is said about
 * whether the debt stands or who may collect it (D7's "lapsed, never abandoned" rule).
 */
import type { ClaimAgingState } from '../aging';
import type { ExtensionReasonCode } from '../statusEvents';

/** The one-glance label for each aging state. */
export const AGING_STATE_LABELS: Record<ClaimAgingState, string> = {
	active: 'Active',
	due_in_grace: 'Due, in grace',
	past_due_not_updated: 'Past due, not updated',
	no_promised_date: 'No promised date on record',
	lapsed: 'Lapsed',
	settled: 'Settled',
};

/** The public word for a lapsed record (D7): about the record, never the loan. */
export const LAPSED_LINE = 'lapsed — record not maintained';

/** What lapsing means for the financing answer, stated without adjudicating anything. */
export const LAPSED_NOT_COUNTED =
	'A lapsed claim is no longer counted in the financing answer. Its signed record and full history stay visible, and one dated update from its financier counts it again.';

/** The structured reasons an extension records (stored per signed, dated event). */
export const EXTENSION_REASON_LABELS: Record<ExtensionReasonCode, string> = {
	debtor_requested: 'Debtor requested more time',
	partial_payment_received: 'Partial payment received',
	renegotiated_terms: 'Terms renegotiated',
	awaiting_delivery: 'Awaiting delivery or acceptance',
	other: 'Other',
};

/** The frame over the reason field: the reason describes the deal, never the debtor. */
export const EXTENSION_REASON_FRAME = 'Why you extended: about the deal, not the debtor.';

/** 400 invalid_reason — an extension without a structured reason records nothing. */
export const EXTENSION_REASON_REQUIRED =
	'A structured reason is required to extend: debtor_requested, partial_payment_received, renegotiated_terms, awaiting_delivery, or other.';

/** 400 invalid — an extension needs the new promised date it resets the clock to. */
export const EXTENSION_DATE_REQUIRED = 'A new promised date (YYYY-MM-DD) is required to extend.';

/** 409 — a discharged claim is done; its record needs no status update. */
export const CLAIM_ALREADY_DISCHARGED = 'That claim is already discharged. A discharged claim needs no status update.';

/** 404 — the claim is not this account's (same wording family as discharge). */
export const CLAIM_NOT_FOUND = 'No claim of yours found for that ID.';

// ── A2: the lender UI (desk status row, Extend panel, pills) ────────────────────

/** The hover line behind each aging pill: what the state says about the RECORD. */
export const AGING_STATE_TITLES: Record<ClaimAgingState, string> = {
	active: 'On time against its promised payment date.',
	due_in_grace: 'The promised date just passed. A normal slip; the record still counts in full.',
	past_due_not_updated: 'Past its promised date, with no update from its financier. Revalidate before relying on it.',
	no_promised_date: 'The record carries no promised payment date to age against.',
	lapsed: LAPSED_NOT_COUNTED,
	settled: 'The claim is discharged, or its receivable is settled. Nothing is left to age.',
};

/** The date a claim currently promises payment by, beside its pill. */
export const ROW_PROMISED_DATED = 'Promised {day}';

/** The three one-click updates on a lender's own entry. */
export const ACTION_SETTLED = 'Settled';
export const ACTION_EXTEND = 'Extend';
export const ACTION_UNPAID = 'Unpaid';
export const ACTION_CANCEL = 'Cancel';

/** Settled rides the existing discharge: the financing came back, so the claim releases. */
export const SETTLED_TITLE = 'Mark it settled';
export const SETTLED_BODY = 'The financing came back: repaid, or released. Recording it discharges the claim and frees the headroom.';
export const SETTLED_NOTE_PLACEHOLDER = 'Optional note for your own record, e.g. wire received Sept 28';
export const SETTLED_GO = 'Record it settled';
export const SETTLED_DONE = 'Claim settled. {available} is unencumbered again.';

/** Extend: a new promised date with a mandatory structured reason. */
export const EXTEND_TITLE = 'Extend the promised date';
export const EXTEND_DATE_LABEL = 'New promised date';
export const EXTEND_REASON_LABEL = 'Reason';
export const EXTEND_REASON_PICK = 'Pick a reason';
export const EXTEND_NOTE_LABEL = 'Note (optional)';
export const EXTEND_NOTE_PLACEHOLDER = 'One line about the deal, e.g. two more weeks agreed';
export const EXTEND_GO = 'Record the extension';
export const EXTEND_DONE = 'Extension recorded. The clock runs from the new promised date, with a fresh grace window.';

/** Unpaid: the flag itself is the signal (D4). */
export const UNPAID_TITLE = 'Flag it unpaid';
export const UNPAID_BODY = 'The flag is the signal; a note is optional. Notes and reasons stay off the public status.';
export const UNPAID_NOTE_PLACEHOLDER = 'Optional, e.g. the wire never arrived';
export const UNPAID_GO = 'Record the flag';
export const UNPAID_DONE = 'Flagged unpaid. The promised date stands, so the record honestly reads past due until it is extended, settled or discharged.';

/** The dated chain under a claim: every extension and unpaid flag, oldest first. The desk is a
 *  signed-in surface, so the lender's own reasons show beside his events (D3); anyone else's
 *  chain shows kinds and dates only. */
export const CHAIN_HEADING = 'Status history';
export const CHAIN_EXTENDED = 'Extended';
export const CHAIN_UNPAID = 'Flagged unpaid';
export const CHAIN_PROMISED = 'promised {day}';

/** How the status row reports a mutation's outcome. The demo line mirrors the registry's. */
export const STATUS_SESSION_LEAD = 'Your session ended. ';
export const STATUS_SESSION_LINK = 'Sign in again';
export const STATUS_SESSION_TAIL = ' to update the claim.';
export const STATUS_DEMO = 'Demo accounts are read-only for this action.';
export const STATUS_FAILED = 'Could not record that. Try again.';
export const STATUS_UNREACHABLE = 'Could not reach the registry. Try again.';

/** The client must hold his receivable ID: a lapsed record stays visible to anyone holding the
 *  ID (A3), so the acceptance page hands it to him where he puts his name to the record. */
export const CLIENT_ID_HEADING = 'Your receivable ID';
export const CLIENT_ID_KEEP = 'Keep this ID. It is how you check this record any time: what is claimed against it, and whether it is still maintained. Anyone holding the ID can look the record up; nobody can find it without one.';

// ── A3: relying-party surfaces (freshness line, lapse display, the Verify-now check) ─────
// Every line here is ACTOR-VOICED and about the RECORD: the lender is named by role and
// duration only, never by name, and nothing states or implies a default on the loan. Per
// record only — no line ever counts a lender's other records.

/** Verify now's freshness check (A3): is every active claim's record current against its
 *  promised payment date? past_due_not_updated is never silently 'confirmed'. */
export const FRESHNESS_CHECK_LABEL = 'Record freshness';
export const FRESHNESS_DETAIL_PASS = 'Every active claim is current against its promised payment date.';
export const FRESHNESS_DETAIL_GRACE = 'The promised date just passed, within the grace window. A normal slip; the record still counts in full.';
export const FRESHNESS_DETAIL_PAST_DUE = 'A claim on this record is past its promised date and has not been updated by its lender since {day}. Revalidate before relying on it.';
export const FRESHNESS_DETAIL_PAST_DUE_UNDATED = 'A claim on this record is past its promised date and has not been updated by its lender. Revalidate before relying on it.';
export const FRESHNESS_DETAIL_LAPSED = 'A claim on this record is lapsed — record not maintained. It is no longer counted in the financing answer; one dated update from its financier counts it again.';
export const FRESHNESS_DETAIL_NO_DATE = 'An active claim carries no promised payment date on record, so its freshness cannot be confirmed.';

/** The freshness story beside a past-due claim on the public lookup: the duration once a month
 *  has passed since the lender's last update, the plain date until then. */
export const FRESHNESS_NOT_UPDATED_FOR = 'This claim has not been updated by its lender in {duration}.';
export const FRESHNESS_NOT_UPDATED_SINCE = 'This claim is past its promised date and has not been updated by its lender since {day}.';

/** What a lapsed claim reads as wherever it IS shown (anyone holding the receivable ID sees the
 *  claim and its dated chain; only the financing answer stops counting it). */
export const LAPSED_PUBLIC_LINE = 'This claim is lapsed — record not maintained. It is no longer counted in the financing answer; one dated update from its financier counts it again.';
