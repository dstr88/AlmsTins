/**
 * AgingPill: a claim's aging state (receivables aging, A2), as an HTML string for the pages'
 * innerHTML builders — the StatusPill fragment-helper pattern. One pill per claim, on the desk's
 * status rows and the registry's claim list, always straight from the lookup's `aging` field:
 * agingStateOf (computed server-side) stays the single source of truth, and no surface
 * recomputes it.
 *
 * An unknown or missing state renders '' rather than falling back to one, and raw input never
 * reaches a class name (the state is checked against the fixed label map first). The title
 * carries the state's one-line meaning, so a checker hovering a pill is told what the record
 * says — about the record, never the loan.
 * Styles: AgingPill.css, loaded through fragments.css.
 */
import { escapeHtml } from '@/lib/escapeHtml';
import type { ClaimAgingState } from '@/lib/receivables/aging';
import { AGING_STATE_LABELS, AGING_STATE_TITLES } from '@/lib/receivables/copy/aging';

export function agingPillHtml(state: unknown): string {
	if (typeof state !== 'string' || !Object.prototype.hasOwnProperty.call(AGING_STATE_LABELS, state)) return '';
	const s = state as ClaimAgingState;
	return `<span class="rcv-pill rcv-pill--aging rcv-pill--ag-${s}" title="${escapeHtml(AGING_STATE_TITLES[s])}">${escapeHtml(AGING_STATE_LABELS[s])}</span>`;
}
