/**
 * Marks rows in the lists the host pages draw: the desk's "Your book" table, the registry page's
 * "Your receivables" and the Client Portal's "Your receivables".
 *
 *   - withdrawn (S2): a record its owner withdrew. Only a claimant ever sees such a row: an owner's
 *     own withdrawn records are not listed to the owner (listReceivables).
 *   - possible duplicate (S4): another record at Almstins matches the row (possibleDuplicate).
 *
 * The page entry modules call these after each redraw, with the IDs from bookWithdrawnIds
 * (src/lib/receivables/withdrawn.ts) and bookDuplicateIds (src/lib/receivables/duplicateView.ts).
 * Each tag has its own marker, so the marks are idempotent per tag: calling them again on an
 * already marked list changes nothing. Markup comes only from the StatusPill fragment helper.
 */
import { statusPillHtml, type TagPill } from '@/components/receivables/StatusPill/statusPill';

/** A tag and the dataset key that marks it as already there. */
interface RowTag { tag: TagPill; marker: string }
const WITHDRAWN: RowTag = { tag: 'withdrawn', marker: 'rcvWithdrawn' };
const DUPLICATE: RowTag = { tag: 'possible_duplicate', marker: 'rcvDup' };

/** data-rcv-withdrawn, data-rcv-dup: the attribute a dataset key is written as. */
const markerAttr = (marker: string) => `[data-${marker.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;

/** The tag pill in a marker span, so a second pass can tell it is already there. */
function tagEl(t: RowTag): HTMLElement {
	const el = document.createElement('span');
	el.dataset[t.marker] = '';
	el.innerHTML = statusPillHtml({ kind: 'tag', tag: t.tag });
	return el;
}

/** Appends the tag to `cell` unless it already holds one. */
function addTag(cell: HTMLElement, t: RowTag): void {
	if (cell.querySelector(markerAttr(t.marker))) return;
	cell.append(' ', tagEl(t));
}

/**
 * Desk "Your book": the row's State cell (its last cell, after the receivable-ID cell with its
 * data-open button) gets the tag after its "open" or "settled", which it keeps: the tag is shown
 * beside the record's state, never in place of it. tests/receivables/withdrawnHosts.test.ts pins
 * that the State column is the last one.
 */
function markDesk(root: ParentNode, ids: ReadonlySet<string>, t: RowTag): void {
	if (!ids.size) return;
	for (const row of Array.from(root.querySelectorAll<HTMLElement>('tr.book-row'))) {
		const id = row.querySelector<HTMLElement>('[data-open]')?.dataset.open;
		const state = row.lastElementChild as HTMLElement | null;
		if (!id || !ids.has(id) || !state) continue;
		addTag(state, t);
	}
}

/** Registry "Your receivables": the tag after the row's title. */
function markRegistry(root: ParentNode, ids: ReadonlySet<string>, t: RowTag): void {
	if (!ids.size) return;
	for (const row of Array.from(root.querySelectorAll<HTMLElement>('[data-mid]'))) {
		const id = row.dataset.mid;
		const main = row.querySelector<HTMLElement>('.mine-main');
		if (!id || !ids.has(id) || !main) continue;
		addTag(main, t);
	}
}

export function markDeskBook(root: ParentNode, ids: ReadonlySet<string>): void { markDesk(root, ids, WITHDRAWN); }
export function markDeskBookDuplicates(root: ParentNode, ids: ReadonlySet<string>): void { markDesk(root, ids, DUPLICATE); }
export function markRegistryMine(root: ParentNode, ids: ReadonlySet<string>): void { markRegistry(root, ids, WITHDRAWN); }
export function markRegistryMineDuplicates(root: ParentNode, ids: ReadonlySet<string>): void { markRegistry(root, ids, DUPLICATE); }

/**
 * Client Portal "Your receivables": each row is a .mine__row whose Track button carries the ID in
 * data-track; the tag goes after the row's text (the button's previous sibling), beside its test
 * tag when it has one.
 */
export function markClientMineDuplicates(root: ParentNode, ids: ReadonlySet<string>): void {
	if (!ids.size) return;
	for (const btn of Array.from(root.querySelectorAll<HTMLElement>('[data-track]'))) {
		const id = btn.dataset.track;
		const text = btn.previousElementSibling as HTMLElement | null;
		if (!id || !ids.has(id) || !text) continue;
		addTag(text, DUPLICATE);
	}
}
