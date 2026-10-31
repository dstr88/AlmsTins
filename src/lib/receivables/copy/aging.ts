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
