import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountClaimAging, type ClaimAgingHost } from '../../src/components/receivables/ClaimAging/claimAging.client';
import {
	ACTION_CANCEL, ACTION_EXTEND, ACTION_SETTLED, ACTION_UNPAID, CHAIN_HEADING,
	EXTEND_DONE, EXTEND_GO, EXTENSION_DATE_REQUIRED, EXTENSION_REASON_REQUIRED,
	LAPSED_NOT_COUNTED, SETTLED_GO, STATUS_DEMO, STATUS_SESSION_LINK, UNPAID_DONE, UNPAID_GO,
} from '../../src/lib/receivables/copy/aging';

/**
 * src/components/receivables/ClaimAging (aging A2): the status row under each desk claim —
 * pill, promised date, the dated chain, and the one-click Settled / Extend / Unpaid. Runs over
 * a small fake DOM (the duplicateFlag.test pattern: node environment, document.createElement
 * stubbed). Invented data throughout.
 */

// ---- fake DOM ----

interface FakeEl {
	tag: string; className: string; textContent: string; hidden: boolean; innerHTML: string;
	href: string; type: string; placeholder: string; value: string; maxLength: number;
	colSpan: number; disabled: boolean;
	children: FakeEl[]; dataset: Record<string, string>;
	listeners: Record<string, Array<() => void>>;
	afterEls: FakeEl[];
	append(...n: Array<FakeEl | string>): void;
	replaceChildren(...n: Array<FakeEl | string>): void;
	addEventListener(t: string, fn: () => void): void;
	remove(): void;
	after(el: FakeEl): void;
}

function el(tag: string): FakeEl {
	const e: FakeEl = {
		tag, className: '', textContent: '', hidden: false, innerHTML: '',
		href: '', type: '', placeholder: '', value: '', maxLength: 0, colSpan: 0, disabled: false,
		children: [], dataset: {}, listeners: {}, afterEls: [],
		append(...n) { for (const x of n) e.children.push(typeof x === 'string' ? text(x) : x); },
		replaceChildren(...n) { e.children = []; e.append(...n); },
		addEventListener(t, fn) { (e.listeners[t] ??= []).push(fn); },
		remove() { /* detached with the host's redraw; nothing to do here */ },
		after(x) { e.afterEls.push(x); },
	};
	return e;
}
function text(s: string): FakeEl { const t = el('#text'); t.textContent = s; return t; }

/** Every element in the tree, depth first. */
function all(root: FakeEl): FakeEl[] {
	return [root, ...root.children.flatMap(all)];
}
const textOf = (root: FakeEl): string => all(root).map((x) => x.textContent).join('');
const buttons = (root: FakeEl): FakeEl[] => all(root).filter((x) => x.tag === 'button');
const buttonLabels = (root: FakeEl): string[] => buttons(root).map((b) => b.textContent);
function button(root: FakeEl, label: string): FakeEl {
	const b = buttons(root).find((x) => x.textContent === label);
	if (!b) throw new Error(`no button "${label}" in [${buttonLabels(root).join(', ')}]`);
	return b;
}
const click = (b: FakeEl) => { for (const fn of b.listeners.click ?? []) fn(); };
const find = (root: FakeEl, pred: (x: FakeEl) => boolean): FakeEl | undefined => all(root).find(pred);

/** The claims container the desk hands the mount: rows rendered by the host's own table. */
function fakeClaims(rows: FakeEl[]) {
	const claims = el('div');
	(claims as any).querySelectorAll = (sel: string) => (sel === 'tr[data-claim-row]' ? rows : []);
	return claims;
}
function fakeRow(claimId: string, cells = 6): FakeEl {
	const row = el('tr');
	row.dataset.claimRow = claimId;
	for (let i = 0; i < cells; i++) row.children.push(el('td'));
	return row;
}

// ---- fake network ----

type Reply = { status: number; body: unknown };
let posts: Array<{ url: string; body: any }>;
let gets: string[];
let replyTo: (url: string) => Reply;
const fakeFetch = vi.fn((url: string, init?: RequestInit) => {
	if (init?.method === 'POST') posts.push({ url, body: JSON.parse(String(init.body)) });
	else gets.push(url);
	const r = replyTo(url);
	return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body });
});
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---- fixtures (invented) ----

const RID = 'a1'.repeat(32);
const claim = (over: Record<string, unknown> = {}) => ({
	id: 'claim-1', status: 'active', aging: 'past_due_not_updated', promisedDate: '2026-10-20',
	statusEvents: [], ...over,
});
const record = (over: Record<string, unknown> = {}, claims: unknown[] = [claim()]) =>
	({ id: RID, settled: false, claims, ...over });

let host: ClaimAgingHost & { refresh: ReturnType<typeof vi.fn> };

beforeEach(() => {
	posts = [];
	gets = [];
	replyTo = () => ({ status: 200, body: { ok: true } });
	fakeFetch.mockClear();
	vi.stubGlobal('document', { createElement: (tag: string) => el(tag) });
	vi.stubGlobal('fetch', fakeFetch);
	host = { refresh: vi.fn(), signInHref: '/verify/login?next=/verify/desk', formatAmount: (n: number) => `NGN ${n}` };
});
afterEach(() => { vi.unstubAllGlobals(); });

function mounted(rows: FakeEl[]) {
	const claims = fakeClaims(rows);
	const handle = mountClaimAging(claims as unknown as HTMLElement, host);
	const note = claims.afterEls[0]; // the outcome note, a sibling the redraw never wipes
	return { claims, handle, note };
}

describe('the status row', () => {
	it('injects one row per claim: the pill, the promised date, and the three actions', () => {
		const row = fakeRow('claim-1');
		const { handle, note } = mounted([row]);
		handle.update(record());
		expect(note.hidden).toBe(true);
		expect(row.afterEls).toHaveLength(1);
		const injected = row.afterEls[0];
		expect(injected.tag).toBe('tr');
		expect(injected.children[0].tag).toBe('td');
		expect(injected.children[0].colSpan).toBe(6);
		const pill = find(injected, (x) => x.className === 'clag__pill')!;
		expect(pill.innerHTML).toContain('rcv-pill--ag-past_due_not_updated');
		expect(textOf(injected)).toContain('Promised 2026-10-20');
		expect(buttonLabels(injected)).toEqual([ACTION_SETTLED, ACTION_EXTEND, ACTION_UNPAID]);
	});

	it('a discharged claim gets its pill and no actions; a claim with no date shows no promised line', () => {
		const rows = [fakeRow('claim-1'), fakeRow('claim-2')];
		const { handle } = mounted(rows);
		handle.update(record({}, [
			claim({ id: 'claim-1', status: 'discharged', aging: 'settled' }),
			claim({ id: 'claim-2', aging: 'no_promised_date', promisedDate: null }),
		]));
		expect(buttonLabels(rows[0].afterEls[0])).toEqual([]);
		expect(find(rows[0].afterEls[0], (x) => x.className === 'clag__pill')!.innerHTML).toContain('rcv-pill--ag-settled');
		expect(textOf(rows[1].afterEls[0])).not.toContain('Promised');
	});

	it('a withdrawn record and a settled receivable keep Settled only: no new status events there', () => {
		for (const over of [{ withdrawn: true as const }, { settled: true }]) {
			const row = fakeRow('claim-1');
			const { handle } = mounted([row]);
			handle.update(record(over));
			expect(buttonLabels(row.afterEls[0])).toEqual([ACTION_SETTLED]);
		}
	});

	it('a lapsed claim carries the not-counted line, revival path included', () => {
		const row = fakeRow('claim-1');
		const { handle } = mounted([row]);
		handle.update(record({}, [claim({ aging: 'lapsed' })]));
		expect(textOf(row.afterEls[0])).toContain(LAPSED_NOT_COUNTED);
	});

	it('update with no record injects nothing and a later update replaces earlier rows', () => {
		const row = fakeRow('claim-1');
		const { handle } = mounted([row]);
		handle.update(null);
		expect(row.afterEls).toHaveLength(0);
		handle.update(record());
		handle.update(record());
		// Each update injects afresh; the host's redraw discards the old rows with its innerHTML.
		expect(row.afterEls).toHaveLength(2);
	});
});

describe('Extend: the mandatory structured reason, enforced before anything posts', () => {
	function openExtend() {
		const row = fakeRow('claim-1');
		const m = mounted([row]);
		m.handle.update(record());
		const injected = row.afterEls[0];
		click(button(injected, ACTION_EXTEND));
		const panel = find(injected, (x) => x.className === 'clag__panel')!;
		const date = find(panel, (x) => x.tag === 'input' && x.type === 'date')!;
		const reason = find(panel, (x) => x.tag === 'select')!;
		// noteIn is the panel's optional-note input; m.note (the outcome note element) rides the spread.
		const noteIn = find(panel, (x) => x.tag === 'input' && x.type !== 'date')!;
		const err = find(injected, (x) => x.className === 'clag__panel-err')!;
		return { ...m, injected, panel, date, reason, noteIn, err };
	}

	it('the panel offers the date, the five reasons behind a pick-one blank, the note, and the frame', () => {
		const { panel, reason } = openExtend();
		expect(textOf(panel)).toContain('Why you extended: about the deal, not the debtor.');
		const options = all(reason).filter((x) => x.tag === 'option');
		expect(options.map((o) => (o as any).value)).toEqual([
			'', 'debtor_requested', 'partial_payment_received', 'renegotiated_terms', 'awaiting_delivery', 'other',
		]);
		expect(options[0].textContent).toBe('Pick a reason');
		expect(options[1].textContent).toBe('Debtor requested more time');
	});

	it('no reason: the API line shows and nothing is posted; then no date: same', () => {
		const { injected, date, reason, err } = openExtend();
		click(button(injected, EXTEND_GO));
		expect(err.hidden).toBe(false);
		expect(err.textContent).toBe(EXTENSION_REASON_REQUIRED);
		expect(fakeFetch).not.toHaveBeenCalled();
		reason.value = 'debtor_requested';
		click(button(injected, EXTEND_GO));
		expect(err.textContent).toBe(EXTENSION_DATE_REQUIRED);
		expect(fakeFetch).not.toHaveBeenCalled();
		expect(date.value).toBe('');
	});

	it('filled in, it posts the extension and reports back; the note (optional) rides only when written', async () => {
		const { injected, date, reason, noteIn, note } = openExtend();
		reason.value = 'debtor_requested';
		date.value = '2026-12-15';
		noteIn.value = '  two more weeks agreed ';
		click(button(injected, EXTEND_GO));
		await flush();
		expect(posts).toEqual([{
			url: '/api/verify/receivables/extend',
			body: { claimId: 'claim-1', newPromisedDate: '2026-12-15', reasonCode: 'debtor_requested', reasonNote: 'two more weeks agreed' },
		}]);
		expect(host.refresh).toHaveBeenCalledTimes(1);
		expect(note.hidden).toBe(false);
		expect(note.className).toContain('clag__note--gain');
		expect(textOf(note)).toBe(EXTEND_DONE);
	});

	it('Cancel closes the panel and posts nothing', () => {
		const { injected } = openExtend();
		click(button(injected, ACTION_CANCEL));
		expect(find(injected, (x) => x.className === 'clag__panel')).toBeUndefined();
		expect(fakeFetch).not.toHaveBeenCalled();
	});
});

describe('Unpaid and Settled', () => {
	function openAction(label: string) {
		const row = fakeRow('claim-1');
		const m = mounted([row]);
		m.handle.update(record());
		const injected = row.afterEls[0];
		click(button(injected, label));
		return { ...m, injected };
	}

	it('Unpaid posts the flag alone; a written note rides along', async () => {
		const a = openAction(ACTION_UNPAID);
		click(button(a.injected, UNPAID_GO));
		await flush();
		expect(posts).toEqual([{ url: '/api/verify/receivables/unpaid', body: { claimId: 'claim-1' } }]);
		expect(textOf(a.note)).toBe(UNPAID_DONE);
		expect(host.refresh).toHaveBeenCalledTimes(1);

		const b = openAction(ACTION_UNPAID);
		const noteIn = find(b.injected, (x) => x.tag === 'input')!;
		noteIn.value = 'the wire never arrived';
		click(button(b.injected, UNPAID_GO));
		await flush();
		expect(posts[1]).toEqual({ url: '/api/verify/receivables/unpaid', body: { claimId: 'claim-1', note: 'the wire never arrived' } });
	});

	it('Settled posts the EXISTING discharge (no parallel path) and reports the freed headroom', async () => {
		replyTo = () => ({ status: 200, body: { ok: true, available: 600 } });
		const a = openAction(ACTION_SETTLED);
		const noteIn = find(a.injected, (x) => x.tag === 'input')!;
		noteIn.value = 'wire received Sept 28';
		click(button(a.injected, SETTLED_GO));
		await flush();
		expect(posts).toEqual([{ url: '/api/verify/receivables/discharge', body: { claimId: 'claim-1', reason: 'wire received Sept 28' } }]);
		expect(textOf(a.note)).toBe('Claim settled. NGN 600 is unencumbered again.');
		expect(host.refresh).toHaveBeenCalledTimes(1);
	});

	it('401 offers the sign-in link; 403 demo reads as the registry says it; 404 shows the server line; none refresh', async () => {
		const cases: Array<[Reply, (noteEl: FakeEl) => void]> = [
			[{ status: 401, body: { ok: false, error: 'unauthenticated' } }, (n) => {
				const a = find(n, (x) => x.tag === 'a')!;
				expect(a.href).toBe('/verify/login?next=/verify/desk');
				expect(a.textContent).toBe(STATUS_SESSION_LINK);
			}],
			[{ status: 403, body: { ok: false, error: 'demo_readonly' } }, (n) => {
				expect(textOf(n)).toBe(STATUS_DEMO);
			}],
			[{ status: 404, body: { ok: false, error: 'not_found', message: 'No claim of yours found for that ID.' } }, (n) => {
				expect(textOf(n)).toBe('No claim of yours found for that ID.');
			}],
		];
		for (const [reply, check] of cases) {
			replyTo = () => reply;
			const a = openAction(ACTION_UNPAID);
			click(button(a.injected, UNPAID_GO));
			await flush();
			expect(a.note.className).toContain('clag__note--loss');
			check(a.note);
			expect(host.refresh).not.toHaveBeenCalled();
			host.refresh.mockClear();
		}
	});

	it('the outcome note survives a same-record update (the refresh redraw) and clears on another record', async () => {
		const row = fakeRow('claim-1');
		const { handle, note } = mounted([row]);
		handle.update(record());
		click(button(row.afterEls[0], ACTION_UNPAID));
		click(button(row.afterEls[0], UNPAID_GO));
		await flush();
		expect(note.hidden).toBe(false);
		handle.update(record());
		expect(note.hidden).toBe(false);
		handle.update(record({ id: 'b2'.repeat(32) }));
		expect(note.hidden).toBe(true);
	});
});

describe('the dated chain and the signed-in reasons (D3)', () => {
	const events = [
		{ id: 'ev-1', kind: 'extended', date: '2026-10-05 10:00:00', newPromisedDate: '2026-10-20', signed: true, anchored: false, anchoredAt: null },
		{ id: 'ev-2', kind: 'unpaid', date: '2026-10-28 09:00:00', newPromisedDate: null, signed: true, anchored: false, anchoredAt: null },
	];

	it('renders each event dated, oldest first, and lays the owner\'s reasons in from /status-events', async () => {
		replyTo = () => ({
			status: 200,
			body: {
				ok: true,
				events: [
					{ id: 'ev-1', kind: 'extended', date: '2026-10-05 10:00:00', newPromisedDate: '2026-10-20', reasonCode: 'debtor_requested', reasonNote: 'two more weeks agreed' },
					{ id: 'ev-2', kind: 'unpaid', date: '2026-10-28 09:00:00', newPromisedDate: null, reasonCode: null, reasonNote: null },
				],
			},
		});
		const row = fakeRow('claim-1');
		const { handle } = mounted([row]);
		handle.update(record({}, [claim({ statusEvents: events })]));
		const injected = row.afterEls[0];
		expect(textOf(injected)).toContain(CHAIN_HEADING);
		const items = all(injected).filter((x) => x.className === 'clag__chain-item');
		expect(items).toHaveLength(2);
		expect(textOf(items[0])).toContain('2026-10-05');
		expect(textOf(items[0])).toContain('Extended · promised 2026-10-20');
		expect(textOf(items[1])).toContain('2026-10-28');
		expect(textOf(items[1])).toContain('Flagged unpaid');
		await flush();
		expect(gets).toEqual(['/api/verify/receivables/status-events?claimId=claim-1']);
		expect(textOf(items[0])).toContain('Debtor requested more time · two more weeks agreed');
		expect(textOf(items[1])).not.toContain('·');
	});

	it('another financier\'s claim answers 404 and his chain stays dates-only, with no error shown', async () => {
		replyTo = () => ({ status: 404, body: { ok: false, error: 'not_found' } });
		const row = fakeRow('claim-1');
		const { handle, note } = mounted([row]);
		handle.update(record({}, [claim({ statusEvents: events })]));
		await flush();
		const items = all(row.afterEls[0]).filter((x) => x.className === 'clag__chain-item');
		expect(textOf(items[0])).toContain('Extended · promised 2026-10-20');
		expect(textOf(items[0])).not.toContain('Debtor requested');
		expect(note.hidden).toBe(true);
	});

	it('a claim with no events fetches nothing', async () => {
		const row = fakeRow('claim-1');
		const { handle } = mounted([row]);
		handle.update(record());
		await flush();
		expect(gets).toEqual([]);
	});
});
