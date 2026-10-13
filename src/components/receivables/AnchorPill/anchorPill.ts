/**
 * AnchorPill: a record's Bitcoin timestamp control, as an HTML string for the pages' innerHTML
 * builders: a confirmed block-date badge, a pending re-check button, or an "Anchor to Bitcoin"
 * button. With actionable:false it is a read-only badge in every state. Every interpolated value
 * goes through escapeHtml here. Styles: AnchorPill.css, loaded through fragments.css.
 */
import { escapeHtml } from '@/lib/escapeHtml';
import { anchorPillLabel, anchorStateOf, type AnchorFields, type PageAnchorKind } from '@/lib/receivables/anchorView';

export interface AnchorPillRecord extends AnchorFields { id: string }
export interface AnchorPillClick { kind: PageAnchorKind; id: string; upgrade: boolean }

export function anchorPillHtml(kind: PageAnchorKind, rec: AnchorPillRecord, opts: { actionable: boolean }): string {
	const state = anchorStateOf(rec);
	const label = escapeHtml(anchorPillLabel(rec, opts.actionable));
	if (state === 'confirmed' || !opts.actionable) return `<span class="rcv-anchor rcv-anchor--${state}">${label}</span>`;
	const up = state === 'pending' ? ' data-up="1"' : '';
	return `<button class="rcv-anchor rcv-anchor--action" data-anchor="${escapeHtml(kind)}:${escapeHtml(rec.id)}"${up} type="button">${label}</button>`;
}

/**
 * Binds every anchor pill inside root, once, to onAnchor. Call it after each render that put
 * pills into root. It binds per element, never a delegated listener on root: a page that
 * re-renders the same container would otherwise stack listeners and post more than once.
 * The caller owns the request (the registry's sign-in, demo and error notes live there).
 */
export function bindAnchorPills(root: ParentNode, onAnchor: (click: AnchorPillClick) => void): void {
	root.querySelectorAll<HTMLElement>('.rcv-anchor[data-anchor]').forEach((el) => {
		const [kind, id] = String(el.dataset.anchor).split(':');
		el.addEventListener('click', () => onAnchor({ kind: kind as PageAnchorKind, id, upgrade: el.dataset.up === '1' }));
	});
}
