import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	bookWithdrawnIds, isWithdrawn, withdrawnDay, withdrawnNote, withdrawnWriteMessage,
} from '../../src/lib/receivables/withdrawn';
import { mountWithdrawnNote } from '../../src/components/receivables/WithdrawnNote/withdrawnNote.client';
import { markDeskBook, markRegistryMine } from '../../src/lib/receivables/client/withdrawnRows';

/**
 * S2 withdrawn view logic: the pure module (src/lib/receivables/withdrawn.ts), the WithdrawnNote
 * widget's behavior and the list marks (src/lib/receivables/client/withdrawnRows.ts). The CI
 * environment is node, so the DOM pieces run against small fakes that record what was written.
 */

const AT = '2026-10-12 09:30:00';
const BODY = 'Everything already on file stays here, every claim and statement included. Almstins records nothing new against it, and a claim already on it can still be marked repaid.';
const TAG = '<span class="rcv-pill rcv-pill--tag" title="Whoever recorded this receivable withdrew it. Your claim and the rest of its record stay on file.">withdrawn</span>';

afterEach(() => { vi.unstubAllGlobals(); });

describe('withdrawn.ts', () => {
	it('withdrawnDay: the date part of a stored time, or null', () => {
		expect(withdrawnDay(AT)).toBe('2026-10-12');
		expect(withdrawnDay('2026-10-12')).toBe('2026-10-12');
		for (const bad of [null, undefined, '', 'yesterday', 20261012, '<b>2026</b>']) expect(withdrawnDay(bad), String(bad)).toBeNull();
	});

	it('isWithdrawn: only an explicit true', () => {
		expect(isWithdrawn({ withdrawn: true })).toBe(true);
		for (const v of [{}, { withdrawn: false }, { withdrawn: 'true' }, { withdrawn: 1 }, null, undefined]) expect(isWithdrawn(v as any)).toBe(false);
	});

	it('withdrawnNote: dated, undated, and none for a live record', () => {
		expect(withdrawnNote({ withdrawn: true, withdrawnAt: AT })).toBe(`Withdrawn on 2026-10-12 by whoever recorded it. ${BODY}`);
		expect(withdrawnNote({ withdrawn: true, withdrawnAt: 'garbage' })).toBe(`Withdrawn by whoever recorded it. ${BODY}`);
		expect(withdrawnNote({ withdrawn: true })).toBe(`Withdrawn by whoever recorded it. ${BODY}`);
		expect(withdrawnNote({ withdrawnAt: AT })).toBeNull();
		expect(withdrawnNote(null)).toBeNull();
	});

	it('withdrawnWriteMessage: the 410 message, dated', () => {
		expect(withdrawnWriteMessage(AT)).toBe('This receivable was withdrawn on 2026-10-12 by whoever recorded it. Almstins no longer records new claims, statements, requests or files on it. Everything already on file stays there.');
	});

	it('bookWithdrawnIds: the withdrawn rows by string ID only', () => {
		const ids = bookWithdrawnIds([
			{ id: 'a', withdrawn: true }, { id: 'b', withdrawn: false }, { id: 'c' }, { id: 7, withdrawn: true } as any, { withdrawn: true },
		]);
		expect([...ids]).toEqual(['a']);
		expect(bookWithdrawnIds(null).size).toBe(0);
	});
});

describe('WithdrawnNote: mountWithdrawnNote', () => {
	function fakeNote(withPill: boolean) {
		const pill = { innerHTML: '' };
		const text = { textContent: '' };
		const root = {
			hidden: true,
			querySelector: (sel: string) => (sel === '[data-wdn-pill]' ? (withPill ? pill : null) : sel === '[data-wdn-text]' ? text : null),
		};
		return { root, pill, text };
	}

	it('shows the withdrawn tag and the sentence for a withdrawn record, hides for the next live one', () => {
		const { root, pill, text } = fakeNote(true);
		const note = mountWithdrawnNote(root as unknown as HTMLElement);
		note.update({ withdrawn: true, withdrawnAt: AT });
		expect(root.hidden).toBe(false);
		// The tag, never a record pill: the record's own status pill keeps its state (S2).
		expect(pill.innerHTML).toBe(TAG);
		expect(text.textContent).toBe(`Withdrawn on 2026-10-12 by whoever recorded it. ${BODY}`);
		note.update({ withdrawn: undefined });
		expect(root.hidden).toBe(true);
		expect(text.textContent).toBe('');
		note.update({ withdrawn: true, withdrawnAt: AT });
		note.update(null);
		expect(root.hidden).toBe(true);
	});

	it('a root without a pill slot still shows the sentence', () => {
		const { root, text } = fakeNote(false);
		mountWithdrawnNote(root as unknown as HTMLElement).update({ withdrawn: true, withdrawnAt: AT });
		expect(root.hidden).toBe(false);
		expect(text.textContent).toContain('Withdrawn on 2026-10-12');
	});

	it('a hostile withdrawnAt never reaches the page as markup', () => {
		const { root, pill, text } = fakeNote(true);
		mountWithdrawnNote(root as unknown as HTMLElement).update({ withdrawn: true, withdrawnAt: '<img src=x onerror=1>' });
		expect(pill.innerHTML).toBe(TAG);
		expect(text.textContent).toBe(`Withdrawn by whoever recorded it. ${BODY}`);
	});
});

describe('markDeskBook: the State cell of a withdrawn row', () => {
	function deskRow(id: string, state = '<span class="ok">open</span>') {
		const appended: unknown[] = [];
		const cell = {
			innerHTML: state,
			appended,
			append: (...nodes: unknown[]) => { appended.push(...nodes); },
			querySelector: (sel: string) => (sel === '[data-rcv-withdrawn]' ? appended.find((n: any) => n && n.dataset && 'rcvWithdrawn' in n.dataset) ?? null : null),
		};
		const open = { dataset: { open: id } };
		return { cell, querySelector: (sel: string) => (sel === '[data-open]' ? open : null), lastElementChild: cell };
	}
	const book = (rows: unknown[]) => ({ querySelectorAll: vi.fn((sel: string) => (sel === 'tr.book-row' ? rows : [])) });

	it('adds one tag beside the state, which it keeps, on the withdrawn rows only', () => {
		vi.stubGlobal('document', { createElement: () => ({ dataset: {} as Record<string, string>, innerHTML: '' }) });
		const a = deskRow('a'), b = deskRow('b'), c = deskRow('c', '<span class="muted">settled</span>');
		const root = book([a, b, c]);
		markDeskBook(root as unknown as ParentNode, new Set(['b', 'c']));
		markDeskBook(root as unknown as ParentNode, new Set(['b', 'c']));
		expect(a.cell.appended).toEqual([]);
		expect(b.cell.innerHTML).toBe('<span class="ok">open</span>');
		expect(b.cell.appended).toEqual([' ', { dataset: { rcvWithdrawn: '' }, innerHTML: TAG }]);
		expect(c.cell.innerHTML).toBe('<span class="muted">settled</span>');
		expect(c.cell.appended).toEqual([' ', { dataset: { rcvWithdrawn: '' }, innerHTML: TAG }]);
	});

	it('an empty set reads nothing', () => {
		const root = book([deskRow('a')]);
		markDeskBook(root as unknown as ParentNode, new Set());
		expect(root.querySelectorAll).not.toHaveBeenCalled();
	});
});

describe('markRegistryMine: a tag after the row title', () => {
	function mineRow(id: string) {
		const appended: unknown[] = [];
		const main = {
			appended,
			append: (...nodes: unknown[]) => { appended.push(...nodes); },
			querySelector: (sel: string) => (sel === '[data-rcv-withdrawn]' ? appended.find((n: any) => n && n.dataset && 'rcvWithdrawn' in n.dataset) ?? null : null),
		};
		return { main, dataset: { mid: id }, querySelector: (sel: string) => (sel === '.mine-main' ? main : null) };
	}

	it('appends one tag to each withdrawn row and none twice', () => {
		vi.stubGlobal('document', { createElement: () => ({ dataset: {} as Record<string, string>, innerHTML: '' }) });
		const a = mineRow('a'), b = mineRow('b');
		const root = { querySelectorAll: (sel: string) => (sel === '[data-mid]' ? [a, b] : []) };
		markRegistryMine(root as unknown as ParentNode, new Set(['a']));
		markRegistryMine(root as unknown as ParentNode, new Set(['a']));
		expect(a.main.appended).toEqual([' ', { dataset: { rcvWithdrawn: '' }, innerHTML: TAG }]);
		expect(b.main.appended).toEqual([]);
	});
});
