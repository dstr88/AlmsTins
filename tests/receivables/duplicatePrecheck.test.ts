import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	PRECHECK_DELAY_MS, PRECHECK_URL, precheckBody, precheckReady, readPrecheckFields, wirePrecheck,
	type PrecheckAnswer, type PrecheckFields,
} from '../../src/components/receivables/duplicatePrecheck.client';

/**
 * src/components/receivables/duplicatePrecheck.client.ts (Addendum A, S4): the live duplicate
 * check while a receivable is entered. The pure helpers run as plain functions; the wiring runs on
 * fake timers, a fake form (an event target) and a fake fetch, so these pin what it sends, when,
 * and what it does with each answer. Nothing here ever touches a submit button: the fake form has
 * none, and the module is given nothing it could disable.
 */

const FIELDS: PrecheckFields = {
	supplier: 'Lagos Foods Ltd', buyer: 'MegaRetail PLC', invoiceNo: 'INV-42', face: '1000', currency: 'NGN', buyerRef: '', isTest: false,
};

describe('precheckReady', () => {
	it('a debtor, a positive amount, a currency, and the client with the invoice number', () => {
		expect(precheckReady(FIELDS)).toBe(true);
	});

	it('the debtor reference alone is enough in place of the client and invoice number', () => {
		expect(precheckReady({ ...FIELDS, supplier: '', invoiceNo: '', buyerRef: 'PO-7' })).toBe(true);
	});

	it('the invoice number needs the client (the invoice key compares both)', () => {
		expect(precheckReady({ ...FIELDS, supplier: '' })).toBe(false);
		expect(precheckReady({ ...FIELDS, invoiceNo: '' })).toBe(false);
	});

	it('no debtor, no currency, or no positive amount: not ready', () => {
		expect(precheckReady({ ...FIELDS, buyer: '' })).toBe(false);
		expect(precheckReady({ ...FIELDS, currency: '' })).toBe(false);
		for (const face of ['', '0', '-5', 'abc', 'Infinity']) expect(precheckReady({ ...FIELDS, face }), face).toBe(false);
	});
});

describe('precheckBody', () => {
	it('the create form fields, the amount as a number, no details without a reference', () => {
		expect(precheckBody(FIELDS)).toEqual({ supplier: 'Lagos Foods Ltd', buyer: 'MegaRetail PLC', invoiceNo: 'INV-42', face: 1000, currency: 'NGN', isTest: false });
	});

	it('details.buyerRef only when a reference is filled; isTest carried', () => {
		expect(precheckBody({ ...FIELDS, buyerRef: 'PO-7', isTest: true })).toEqual({
			supplier: 'Lagos Foods Ltd', buyer: 'MegaRetail PLC', invoiceNo: 'INV-42', face: 1000, currency: 'NGN', isTest: true, details: { buyerRef: 'PO-7' },
		});
	});
});

describe('readPrecheckFields', () => {
	const form = (vals: Record<string, { value?: string; checked?: boolean }>) => ({
		querySelector: (sel: string) => {
			const m = /^\[data-rcv-field="([\w-]+)"\]$/.exec(sel);
			return m && vals[m[1]] ? vals[m[1]] : null;
		},
	}) as unknown as ParentNode;

	it('reads and trims the marked fields; test mode by .checked', () => {
		expect(readPrecheckFields(form({
			supplier: { value: ' Lagos Foods ' }, buyer: { value: 'Mega' }, invoiceNo: { value: 'INV-1' }, face: { value: ' 50 ' },
			currency: { value: 'USD' }, buyerRef: { value: ' PO-9 ' }, 'test-mode': { checked: true },
		}))).toEqual({ supplier: 'Lagos Foods', buyer: 'Mega', invoiceNo: 'INV-1', face: '50', currency: 'USD', buyerRef: 'PO-9', isTest: true });
	});

	it('"__other" reads the free-text currency; a missing field reads empty; no test field is real', () => {
		expect(readPrecheckFields(form({ currency: { value: '__other' }, 'currency-other': { value: ' xof ' } }))).toEqual({
			supplier: '', buyer: '', invoiceNo: '', face: '', currency: 'xof', buyerRef: '', isTest: false,
		});
	});
});

// ---- The wiring ----

class FakeForm {
	listeners: Record<string, Array<(e: Event) => void>> = {};
	addEventListener(type: string, fn: (e: Event) => void) { (this.listeners[type] ??= []).push(fn); }
	/** An event from a marked field (or, with marked: false, from any other control in the form). */
	fire(type: 'input' | 'change', marked = true) {
		const target = { closest: (sel: string) => (marked && sel === '[data-rcv-field]' ? {} : null) };
		for (const fn of this.listeners[type] ?? []) fn({ target } as unknown as Event);
	}
}

interface Call { url: string; init: RequestInit; resolve: (r: unknown) => void; reject: (e: unknown) => void }
function fakeFetch() {
	const calls: Call[] = [];
	const impl = vi.fn((url: RequestInfo | URL, init?: RequestInit) => new Promise((resolve, reject) => {
		calls.push({ url: String(url), init: init!, resolve, reject });
		init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
	}));
	return { impl: impl as unknown as typeof fetch, calls };
}
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
	ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: (k: string) => headers[k] ?? null },
});
const ANSWER = { ok: true, duplicateCheck: { state: 'possible_duplicate' } };

let form: FakeForm;
let fields: PrecheckFields;
let results: Array<PrecheckAnswer | null>;
let f: ReturnType<typeof fakeFetch>;
let clock: number;

function wire() {
	return wirePrecheck({
		root: form as unknown as HTMLElement, read: () => ({ ...fields }), onResult: (a) => { results.push(a); },
		fetchImpl: f.impl, now: () => clock,
	});
}
/** Let the timers and the fake fetch's promise chains run. */
async function settle(ms = 0) { await vi.advanceTimersByTimeAsync(ms); }

beforeEach(() => {
	vi.useFakeTimers();
	form = new FakeForm();
	fields = { ...FIELDS };
	results = [];
	f = fakeFetch();
	clock = 1_000_000;
});
afterEach(() => { vi.useRealTimers(); });

describe('wirePrecheck: when it asks', () => {
	it('waits 600 ms after typing stops: five inputs inside 500 ms send one POST', async () => {
		expect(PRECHECK_DELAY_MS).toBe(600);
		wire();
		for (let i = 0; i < 5; i++) { if (i) await settle(100); form.fire('input'); } // 5 inputs over 400 ms
		expect(f.calls).toHaveLength(0);
		await settle(599);
		expect(f.calls).toHaveLength(0);
		await settle(1);
		expect(f.calls).toHaveLength(1);
		const c = f.calls[0];
		expect(c.url).toBe(PRECHECK_URL);
		expect(c.init.method).toBe('POST');
		expect(JSON.parse(String(c.init.body))).toEqual(precheckBody(FIELDS));
		expect(c.url).not.toContain('?');
	});

	it('change events count too; events from unmarked controls (the debtor email, the terms) do not', async () => {
		wire();
		form.fire('input', false);
		form.fire('change', false);
		await settle(2000);
		expect(f.calls).toHaveLength(0);
		form.fire('change');
		await settle(600);
		expect(f.calls).toHaveLength(1);
	});

	it('not ready: no request, and the flag is cleared', async () => {
		wire();
		fields.supplier = '';
		form.fire('input');
		await settle(600);
		expect(f.calls).toHaveLength(0);
		expect(results).toEqual([null]);
	});

	it('the same fields as the answer on screen are not asked again', async () => {
		wire();
		form.fire('input');
		await settle(600);
		f.calls[0].resolve(reply(200, ANSWER));
		await settle();
		expect(results).toEqual([{ duplicateCheck: ANSWER.duplicateCheck, ownMatches: undefined }]);
		form.fire('input');
		await settle(600);
		expect(f.calls).toHaveLength(1);
		fields.invoiceNo = 'INV-43';
		form.fire('input');
		await settle(600);
		expect(f.calls).toHaveLength(2);
	});
});

describe('wirePrecheck: stale answers', () => {
	it('a change while a request is out aborts it, and its answer never shows', async () => {
		wire();
		form.fire('input');
		await settle(600);
		const first = f.calls[0];
		fields.face = '2000';
		form.fire('input');
		expect(first.init.signal?.aborted).toBe(true);
		first.resolve(reply(200, { ok: true, duplicateCheck: { state: 'no_match' } }));
		await settle(600);
		expect(f.calls).toHaveLength(2);
		f.calls[1].resolve(reply(200, ANSWER));
		await settle();
		expect(results).toEqual([{ duplicateCheck: ANSWER.duplicateCheck, ownMatches: undefined }]);
	});

	it('an aborted request is not counted as answered: the same fields are asked again', async () => {
		wire();
		form.fire('input');
		await settle(600);
		form.fire('input'); // same fields; the first request is aborted
		await settle(600);
		expect(f.calls).toHaveLength(2);
	});
});

describe('wirePrecheck: answers it cannot use', () => {
	for (const status of [401, 403]) {
		it(`${status}: clears the flag and never asks again this visit`, async () => {
			wire();
			form.fire('input');
			await settle(600);
			f.calls[0].resolve(reply(status, { ok: false }));
			await settle();
			expect(results).toEqual([null]);
			fields.invoiceNo = 'INV-99';
			for (let i = 0; i < 3; i++) { form.fire('input'); await settle(1000); }
			expect(f.calls).toHaveLength(1);
		});
	}

	for (const status of [400, 413, 503, 500]) {
		it(`${status}: clears the flag quietly and asks again on the next change`, async () => {
			wire();
			form.fire('input');
			await settle(600);
			f.calls[0].resolve(reply(status, { ok: false, error: 'x' }));
			await settle();
			expect(results).toEqual([null]);
			form.fire('input');
			await settle(600);
			expect(f.calls).toHaveLength(2);
		});
	}

	it('429: clears the flag and waits out Retry-After before asking again', async () => {
		wire();
		form.fire('input');
		await settle(600);
		f.calls[0].resolve(reply(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '30' }));
		await settle();
		expect(results).toEqual([null]);
		form.fire('input');
		await settle(600);
		expect(f.calls).toHaveLength(1);
		clock += 30_000;
		form.fire('input');
		await settle(600);
		expect(f.calls).toHaveLength(2);
	});

	it('a network error or a body that is not ok clears the flag', async () => {
		wire();
		form.fire('input');
		await settle(600);
		f.calls[0].reject(new TypeError('network down'));
		await settle();
		fields.invoiceNo = 'INV-2';
		form.fire('input');
		await settle(600);
		f.calls[1].resolve(reply(200, { ok: false }));
		await settle();
		expect(results).toEqual([null, null]);
	});

	it('passes on the answer as sent, the unavailable state included (the view decides what shows)', async () => {
		wire();
		form.fire('input');
		await settle(600);
		f.calls[0].resolve(reply(200, { ok: true, duplicateCheck: { state: 'unavailable' }, ownMatches: [] }));
		await settle();
		expect(results).toEqual([{ duplicateCheck: { state: 'unavailable' }, ownMatches: [] }]);
	});
});

describe('wirePrecheck: around a save', () => {
	it('suspend holds through the create: a late answer is dropped, and nothing is asked until a field changes', async () => {
		const h = wire();
		form.fire('input');
		await settle(600);
		h.suspend();
		f.calls[0].resolve(reply(200, ANSWER));
		await settle(5000);
		expect(results).toEqual([]);
		expect(f.calls).toHaveLength(1);
		form.fire('input'); // the next change resumes, and asks again even for the same fields
		await settle(600);
		expect(f.calls).toHaveLength(2);
	});

	it('suspend also cancels a check that was waiting for the delay', async () => {
		const h = wire();
		form.fire('input');
		await settle(300);
		h.suspend();
		await settle(1000);
		expect(f.calls).toHaveLength(0);
	});

	it('reset forgets the last answer, so the same fields are asked again after the form is reused', async () => {
		const h = wire();
		form.fire('input');
		await settle(600);
		f.calls[0].resolve(reply(200, ANSWER));
		await settle();
		h.reset();
		form.fire('input');
		await settle(600);
		expect(f.calls).toHaveLength(2);
	});

	it('paused (the desk intake is recorded and locked): changes start nothing and the answer on screen stays', async () => {
		let locked = false;
		const h = wirePrecheck({
			root: form as unknown as HTMLElement, read: () => ({ ...fields }), onResult: (a) => { results.push(a); },
			fetchImpl: f.impl, now: () => clock, paused: () => locked,
		});
		h.suspend(); // the create answered
		locked = true;
		form.fire('change'); // the desk's mode radios sit outside the locked intake
		await settle(2000);
		expect(f.calls).toHaveLength(0);
		expect(results).toEqual([]);
		locked = false; // "Start another deal"
		h.reset();
		form.fire('input');
		await settle(600);
		expect(f.calls).toHaveLength(1);
	});

	it('paused also drops a check that was already waiting for the delay', async () => {
		let locked = false;
		wirePrecheck({
			root: form as unknown as HTMLElement, read: () => ({ ...fields }), onResult: (a) => { results.push(a); },
			fetchImpl: f.impl, now: () => clock, paused: () => locked,
		});
		form.fire('input');
		await settle(300);
		locked = true;
		await settle(1000);
		expect(f.calls).toHaveLength(0);
		expect(results).toEqual([]);
	});

	it('flush checks at once', async () => {
		const h = wire();
		void h.flush();
		await settle();
		expect(f.calls).toHaveLength(1);
	});
});
