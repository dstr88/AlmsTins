/**
 * FreshnessLine (receivables aging, A3): the story line a relying party reads under a claim on
 * the public lookup, as an HTML string for the pages' innerHTML builders — the AgingPill
 * fragment-helper pattern, and styled beside it in AgingPill.css.
 *
 * Only two states carry a line, straight from the lookup's own fields (nothing is recomputed):
 *   past_due_not_updated — actor-voiced, the lender named by role and duration only, never by
 *   name: "has not been updated by its lender in 4 months" once a month has passed since the
 *   last financier update, the plain date until then;
 *   lapsed — "lapsed — record not maintained", about the record, never the loan or anyone's
 *   rights to it (anyone holding the receivable ID still sees the claim and its dated chain;
 *   only the financing answer stops counting it).
 * Every other state renders '' — current records read as they always did. Unknown input renders
 * '' too, and raw input never reaches the markup (the state picks from a fixed pair of class
 * names; the copy is escaped like every fragment).
 */
import { escapeHtml } from '@/lib/escapeHtml';
import { wholeMonthsSince } from '@/lib/receivables/aging';
import { fillCopy } from '@/lib/receivables/fillCopy';
import {
	FRESHNESS_NOT_UPDATED_FOR,
	FRESHNESS_NOT_UPDATED_SINCE,
	LAPSED_PUBLIC_LINE,
} from '@/lib/receivables/copy/aging';

function wrap(state: 'past_due_not_updated' | 'lapsed', line: string): string {
	return `<div class="rcv-freshline rcv-freshline--${state}">${escapeHtml(line)}</div>`;
}

/** The freshness line for one claim of the public lookup (aging + lastOwnerTouchAt), or ''. */
export function freshnessLineHtml(claim: unknown, now: Date = new Date()): string {
	if (claim === null || typeof claim !== 'object') return '';
	const aging = (claim as Record<string, unknown>).aging;
	if (aging === 'lapsed') return wrap('lapsed', LAPSED_PUBLIC_LINE);
	if (aging !== 'past_due_not_updated') return '';
	const touch = (claim as Record<string, unknown>).lastOwnerTouchAt;
	const ts = typeof touch === 'string' && touch.trim() !== '' ? touch : null;
	const months = wholeMonthsSince(ts, now);
	if (months !== null && months >= 1) {
		const duration = months === 1 ? '1 month' : `${months} months`;
		return wrap('past_due_not_updated', fillCopy(FRESHNESS_NOT_UPDATED_FOR, { duration }));
	}
	// Under a month (or an unparseable touch with at least a date part): the dated wording.
	const day = ts !== null && /^\d{4}-\d{2}-\d{2}/.test(ts) ? ts.slice(0, 10) : null;
	return day === null ? '' : wrap('past_due_not_updated', fillCopy(FRESHNESS_NOT_UPDATED_SINCE, { day }));
}
