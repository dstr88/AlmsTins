/**
 * Marks withdrawn rows (S2 soft delete) in the lists the host pages draw: the desk's "Your book"
 * table and the registry page's "Your receivables". Only a claimant ever sees such a row: an
 * owner's own withdrawn records are not listed to the owner (listReceivables).
 *
 * The page entry modules call these after each redraw, with the IDs from bookWithdrawnIds
 * (src/lib/receivables/withdrawn.ts). Both are idempotent, so calling them again on an already
 * marked list changes nothing. Markup comes only from the StatusPill fragment helper.
 */
import { statusPillHtml } from '@/components/receivables/StatusPill/statusPill';

/**
 * Desk "Your book": a withdrawn row's State cell (the row's last cell, after the receivable-ID
 * cell with its data-open button) gets a "withdrawn" tag after its "open" or "settled", which it
 * keeps: the withdrawal is shown beside the record's state, never in place of it.
 * tests/receivables/withdrawnHosts.test.ts pins that the State column is the last one.
 */
export function markDeskBook(root: ParentNode, ids: ReadonlySet<string>): void {
	if (!ids.size) return;
	for (const row of Array.from(root.querySelectorAll<HTMLElement>('tr.book-row'))) {
		const id = row.querySelector<HTMLElement>('[data-open]')?.dataset.open;
		const state = row.lastElementChild as HTMLElement | null;
		if (!id || !ids.has(id) || !state || state.querySelector('[data-rcv-withdrawn]')) continue;
		state.append(' ', withdrawnTag());
	}
}

/** The "withdrawn" tag pill in a marker span, so a second pass can tell it is already there. */
function withdrawnTag(): HTMLElement {
	const tag = document.createElement('span');
	tag.dataset.rcvWithdrawn = '';
	tag.innerHTML = statusPillHtml({ kind: 'tag', tag: 'withdrawn' });
	return tag;
}

/** Registry "Your receivables": a withdrawn row gets a "withdrawn" tag after its title. */
export function markRegistryMine(root: ParentNode, ids: ReadonlySet<string>): void {
	if (!ids.size) return;
	for (const row of Array.from(root.querySelectorAll<HTMLElement>('[data-mid]'))) {
		const id = row.dataset.mid;
		const main = row.querySelector<HTMLElement>('.mine-main');
		if (!id || !ids.has(id) || !main || main.querySelector('[data-rcv-withdrawn]')) continue;
		main.append(' ', withdrawnTag());
	}
}
