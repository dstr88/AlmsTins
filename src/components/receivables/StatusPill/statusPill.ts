/**
 * StatusPill: the receivables status pill, as an HTML string for the pages' innerHTML builders.
 * Two looks, reproduced from the pages they came from:
 *   - record: a receivable's one-glance financing state (ragState), with a dot;
 *   - tag: a short marker beside a list row ("test", "claimed only", "withdrawn").
 * Every interpolated value goes through escapeHtml here. An unknown state or tag renders ''
 * rather than falling back to a state, and raw input never reaches a class name.
 * Styles: StatusPill.css, loaded through fragments.css.
 */
import { escapeHtml } from '@/lib/escapeHtml';
import { ragState, type RagInput, type RagState } from '@/lib/receivables/status';
import {
	PILL_DISPUTED, PILL_FULL, PILL_OPEN, PILL_PARTIAL, PILL_SETTLED, PILL_TEST,
	TAG_CLAIMED_ONLY, TAG_CLAIMED_ONLY_TITLE, TAG_TEST,
} from '@/lib/receivables/copy/statusPill';
import { TAG_WITHDRAWN, TAG_WITHDRAWN_TITLE } from '@/lib/receivables/copy/withdrawn';

export type TagPill = 'test' | 'claimed_only' | 'withdrawn';
export type StatusPillView = { kind: 'record'; state: RagState } | { kind: 'tag'; tag: TagPill };

const RECORD: Readonly<Record<RagState, string>> = {
	test: PILL_TEST, disputed: PILL_DISPUTED, settled: PILL_SETTLED,
	partial: PILL_PARTIAL, full: PILL_FULL, open: PILL_OPEN,
};
const TAGS: Readonly<Record<TagPill, { label: string; title?: string }>> = {
	test: { label: TAG_TEST },
	claimed_only: { label: TAG_CLAIMED_ONLY, title: TAG_CLAIMED_ONLY_TITLE },
	withdrawn: { label: TAG_WITHDRAWN, title: TAG_WITHDRAWN_TITLE },
};

export function recordPill(rcv: RagInput): StatusPillView {
	return { kind: 'record', state: ragState(rcv) };
}

export function statusPillHtml(view: StatusPillView): string {
	if (view?.kind === 'tag') {
		if (!Object.prototype.hasOwnProperty.call(TAGS, view.tag)) return '';
		const t = TAGS[view.tag];
		const title = t.title ? ` title="${escapeHtml(t.title)}"` : '';
		return `<span class="rcv-pill rcv-pill--tag"${title}>${escapeHtml(t.label)}</span>`;
	}
	if (view?.kind !== 'record' || !Object.prototype.hasOwnProperty.call(RECORD, view.state)) return '';
	return `<span class="rcv-pill rcv-pill--record rcv-pill--${view.state}"><span class="rcv-pill__dot"></span>${escapeHtml(RECORD[view.state])}</span>`;
}
