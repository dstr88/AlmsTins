import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mountDuplicateFlag } from '../../src/components/receivables/DuplicateFlag/duplicateFlag.client';
import * as copy from '../../src/lib/receivables/copy/duplicate';

/**
 * src/components/receivables/DuplicateFlag (S4): the possible-duplicate warning widget. Its
 * behavior runs over a small fake DOM that mirrors DuplicateFlag.astro; the last block pins that
 * markup (the live region is the root and is never hidden; the panel inside it is).
 */

const RID = 'a'.repeat(64);
const DUP_TAG = '<span class="rcv-pill rcv-pill--tag" title="Another record at Almstins matches this invoice.">possible duplicate</span>';

interface FakeEl {
	tag: string; className: string; textContent: string; href?: string; target?: string; rel?: string; hidden: boolean; innerHTML: string;
	children: Array<FakeEl | string>; classes: Set<string>;
	append(...n: Array<FakeEl | string>): void;
	replaceChildren(...n: Array<FakeEl | string>): void;
	classList: { toggle(c: string, on: boolean): void; contains(c: string): boolean };
}
function el(tag: string, hidden = false): FakeEl {
	const e: FakeEl = {
		tag, className: '', textContent: '', hidden, innerHTML: '', children: [], classes: new Set(),
		append(...n) { e.children.push(...n); },
		replaceChildren(...n) { e.children = [...n]; },
		classList: { toggle: (c, on) => { if (on) e.classes.add(c); else e.classes.delete(c); }, contains: (c) => e.classes.has(c) },
	};
	return e;
}
/** Text of a node tree, the way a reader would hear it. */
const text = (n: FakeEl | string): string => (typeof n === 'string' ? n : n.textContent + n.children.map(text).join(''));

let writes: number;
function fakeFlag() {
	const parts = {
		panel: el('div', true), pill: el('p'), body: el('div'),
		own: el('div', true), ownLead: el('p'), ownList: el('ul'),
	};
	const map: Record<string, FakeEl> = {
		'[data-dupf-panel]': parts.panel, '[data-dupf-pill]': parts.pill,
		'[data-dupf-body]': parts.body, '[data-dupf-own]': parts.own, '[data-dupf-own-lead]': parts.ownLead, '[data-dupf-own-list]': parts.ownList,
	};
	const root = { hidden: false, querySelector: (sel: string) => map[sel] ?? null };
	const orig = parts.body.replaceChildren;
	parts.body.replaceChildren = (...n) => { writes++; orig(...n); };
	return { root, ...parts };
}

beforeEach(() => {
	writes = 0;
	vi.stubGlobal('document', { createElement: (tag: string) => el(tag) });
});
afterEach(() => { vi.unstubAllGlobals(); });

const FULL = { state: 'possible_duplicate', basis: 'invoice_number', encumbered: true, anySettled: false, hasDebtorReference: true };

describe('mountDuplicateFlag', () => {
	it('a possible duplicate: the caution panel headed by the tag, then the lines, as text', () => {
		const f = fakeFlag();
		mountDuplicateFlag(f.root as unknown as HTMLElement, { variant: 'desk' }).update({ duplicateCheck: FULL }, 'precheck');
		expect(f.panel.hidden).toBe(false);
		expect(f.root.hidden).toBe(false);
		expect(f.panel.classes).toEqual(new Set(['dupf__panel--caution']));
		expect(f.pill.innerHTML).toBe(DUP_TAG);
		expect(f.pill.hidden).toBe(false);
		expect(f.body.children.map((c) => (c as FakeEl).textContent)).toEqual([copy.PRECHECK_FINANCED, copy.PRECHECK_PROCEED]);
		expect(f.body.children.every((c) => (c as FakeEl).className === 'dupf__line')).toBe(true);
		expect(f.own.hidden).toBe(true);
	});

	it('own matches become links to the same page with ?id=, in a new tab, the withdrawn one marked', () => {
		const f = fakeFlag();
		const own = [{ id: RID, invoiceNo: '<img src=x onerror=1>', withdrawn: false }, { id: 'b'.repeat(64), invoiceNo: 'INV 42', withdrawn: true }];
		mountDuplicateFlag(f.root as unknown as HTMLElement, { variant: 'registry' }).update({ duplicateCheck: FULL, ownMatches: own }, 'created');
		expect(f.own.hidden).toBe(false);
		expect(f.ownLead.textContent).toBe(copy.OWN_MATCHES_LEAD);
		const items = f.ownList.children as FakeEl[];
		expect(items).toHaveLength(2);
		const a0 = items[0].children[0] as FakeEl;
		expect(a0.href).toBe(`?id=${RID}`);
		// A new tab, so a form still being filled in is not lost.
		expect(a0.target).toBe('_blank');
		expect(a0.rel).toBe('noopener');
		expect(a0.className).toBe('dupf__own-link');
		// Hostile text lands as text, never markup.
		expect(text(a0)).toBe('<img src=x onerror=1> · aaaaaaaa…');
		expect(a0.innerHTML).toBe('');
		expect(text(items[1])).toBe(`INV 42 · bbbbbbbb… ${copy.OWN_MATCH_WITHDRAWN}`);
	});

	it('hrefFor overrides where an own match goes', () => {
		const f = fakeFlag();
		mountDuplicateFlag(f.root as unknown as HTMLElement, { variant: 'desk', hrefFor: (id) => `/receivables/desk?id=${id}` })
			.update({ duplicateCheck: FULL, ownMatches: [{ id: RID, invoiceNo: 'X', withdrawn: false }] }, 'precheck');
		expect(((f.ownList.children[0] as FakeEl).children[0] as FakeEl).href).toBe(`/receivables/desk?id=${RID}`);
	});

	it('a muted note has no tag', () => {
		const f = fakeFlag();
		mountDuplicateFlag(f.root as unknown as HTMLElement, { variant: 'client' }).update({ duplicateCheck: { state: 'unavailable' } }, 'created');
		expect(f.panel.hidden).toBe(false);
		expect(f.panel.classes).toEqual(new Set(['dupf__panel--muted']));
		expect(f.pill.innerHTML).toBe('');
		expect(f.pill.hidden).toBe(true);
		expect(f.body.children.map((c) => (c as FakeEl).textContent)).toEqual([copy.DUPLICATE_DETAIL_UNAVAILABLE]);
	});

	it('nothing to show, clear(), and a record view after a precheck: hidden and emptied', () => {
		const f = fakeFlag();
		const flag = mountDuplicateFlag(f.root as unknown as HTMLElement, { variant: 'desk' });
		flag.update({ duplicateCheck: FULL, ownMatches: [{ id: RID, invoiceNo: 'X', withdrawn: false }] }, 'precheck');
		flag.update({ duplicateCheck: { state: 'no_match' } }, 'precheck');
		expect(f.panel.hidden).toBe(true);
		expect(f.body.children).toEqual([]);
		expect(f.ownList.children).toEqual([]);
		flag.update({ duplicateCheck: FULL }, 'record');
		expect(f.panel.hidden).toBe(false);
		flag.clear();
		expect(f.panel.hidden).toBe(true);
		flag.update(null, 'record');
		expect(f.panel.hidden).toBe(true);
	});

	it('the same view again writes nothing, so the live region does not repeat itself', () => {
		const f = fakeFlag();
		const flag = mountDuplicateFlag(f.root as unknown as HTMLElement, { variant: 'desk' });
		flag.update({ duplicateCheck: FULL }, 'precheck');
		flag.update({ duplicateCheck: { ...FULL } }, 'precheck');
		expect(writes).toBe(1);
		flag.update({ duplicateCheck: { ...FULL, encumbered: false } }, 'precheck');
		expect(writes).toBe(2);
		flag.clear();
		flag.update({ duplicateCheck: FULL }, 'precheck');
		expect(writes).toBe(4);
	});
});

describe('DuplicateFlag.astro markup matches what the client looks for', () => {
	const SRC = fs.readFileSync(fileURLToPath(new URL('../../src/components/receivables/DuplicateFlag/DuplicateFlag.astro', import.meta.url)), 'utf8');

	it('the root is a polite live region that is never hidden; the panel inside it starts hidden', () => {
		expect(SRC).toMatch(/<div class=\{`dupf dupf--\$\{variant\} dupf--\$\{name\}`\} data-rcv-root=\{`dup-\$\{name\}`\} aria-live="polite">/);
		expect(SRC).toMatch(/<div class="dupf__panel" data-dupf-panel hidden>/);
		const markup = SRC.split(/^---$/m)[2];
		expect(markup.match(/\shidden>/g)).toHaveLength(2); // the panel and the own-matches block, never the root
	});

	it('every slot the client reads is there once', () => {
		for (const slot of ['data-dupf-panel', 'data-dupf-pill', 'data-dupf-body', 'data-dupf-own ', 'data-dupf-own-lead', 'data-dupf-own-list']) {
			expect(SRC.split(slot).length - 1, slot).toBe(1);
		}
	});

	it('props are the three pages and the two uses', () => {
		expect(SRC).toContain("interface Props { variant: 'desk' | 'registry' | 'client'; name: 'create' | 'record' }");
	});
});
