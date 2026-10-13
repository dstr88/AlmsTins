import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The page entry modules (src/lib/receivables/client/pages/{desk,registry,client}.ts), run for real
 * (S4 review finding). duplicateHosts.test.ts pins their source; this runs them, over a fake page,
 * so a regression in how an entry module connects the live check, the flags and the book marks to
 * the host fails here even when each widget's own tests pass.
 *
 * What is real: hostBridge (a fresh copy per test, imported together with the entry module so they
 * share it), the live check (wirePrecheck and readPrecheckFields, on fake timers and a fake fetch),
 * and the ID helpers. What is recorded: the two DuplicateFlags, the book marks, closeAck, and the
 * live check's suspend and reset calls (passed through to the real ones). MutationObserver is a
 * fake the test triggers, standing in for the host's own redraws and lock changes.
 */

const rec = vi.hoisted(() => ({ log: [] as string[] }));

vi.mock('../../src/components/receivables/DuplicateFlag/duplicateFlag.client', () => ({
	mountDuplicateFlag: (root: { name: string }, opts: { variant: string }) => ({
		update: (answer: unknown, phase: string) => { rec.log.push(`${root.name}:${opts.variant}:update:${phase}:${JSON.stringify(answer)}`); },
		clear: () => { rec.log.push(`${root.name}:clear`); },
	}),
}));
vi.mock('../../src/components/receivables/WithdrawnNote/withdrawnNote.client', () => ({
	mountWithdrawnNote: () => ({ update: () => {} }),
}));
vi.mock('../../src/components/receivables/AckPrompt/ackPrompt.client', () => ({
	closeAck: () => { rec.log.push('closeAck'); },
}));
vi.mock('../../src/lib/receivables/client/withdrawnRows', () => {
	const mark = (name: string) => (_root: unknown, ids: ReadonlySet<string>) => { rec.log.push(`${name}:${[...ids].sort().join(',')}`); };
	return {
		markDeskBook: mark('desk-withdrawn'), markDeskBookDuplicates: mark('desk-dup'),
		markRegistryMine: mark('registry-withdrawn'), markRegistryMineDuplicates: mark('registry-dup'),
		markClientMineDuplicates: mark('client-dup'),
	};
});
vi.mock('../../src/components/receivables/duplicatePrecheck.client', async (importOriginal) => {
	const real = await importOriginal<typeof import('../../src/components/receivables/duplicatePrecheck.client')>();
	return {
		...real,
		wirePrecheck: (o: Parameters<typeof real.wirePrecheck>[0]) => {
			const h = real.wirePrecheck(o);
			return {
				suspend: () => { rec.log.push('precheck:suspend'); h.suspend(); },
				reset: () => { rec.log.push('precheck:reset'); h.reset(); },
				flush: () => h.flush(),
			};
		},
	};
});

type Bridge = typeof import('../../src/lib/receivables/client/hostBridge');
type Page = 'desk' | 'registry' | 'client';

// ---- The fake page ----

/** A create form: [data-rcv-field] values, the desk's [data-rcv-lock], and input/change events. */
class FakeForm {
	listeners: Record<string, Array<(e: Event) => void>> = {};
	lock = { dataset: {} as Record<string, string> };
	values: Record<string, string> = {
		supplier: 'Lagos Foods Ltd', buyer: 'MegaRetail PLC', invoiceNo: 'INV-42', face: '1000', currency: 'NGN', buyerRef: '',
	};
	constructor(private withLock: boolean) {}
	addEventListener(type: string, fn: (e: Event) => void) { (this.listeners[type] ??= []).push(fn); }
	querySelector(sel: string) {
		if (sel === '[data-rcv-lock]') return this.withLock ? this.lock : null;
		const m = /^\[data-rcv-field="([\w-]+)"\]$/.exec(sel);
		if (!m) return null;
		if (m[1] === 'test-mode') return { checked: false };
		return m[1] in this.values ? { value: this.values[m[1]] } : null;
	}
	/** The person types in a marked field. */
	type() {
		const target = { closest: (s: string) => (s === '[data-rcv-field]' ? {} : null) };
		for (const fn of this.listeners.input ?? []) fn({ target } as unknown as Event);
	}
}

/** MutationObserver stand-in: the test says when a watched node changed. */
let observers: Array<{ target: unknown; opts: MutationObserverInit; cb: () => void }>;
class FakeObserver {
	constructor(private cb: () => void) {}
	observe(target: unknown, opts: MutationObserverInit) { observers.push({ target, opts, cb: this.cb }); }
	disconnect() {}
}
const changed = (target: unknown) => { for (const o of observers) if (o.target === target) o.cb(); };

/** fetch stand-in: each precheck POST waits until the test answers it. It ignores abort on
 *  purpose, so a late answer really arrives and only the entry module's wiring can keep it off. */
let posts: Array<{ url: string; body: unknown; answer: (body: unknown) => void }>;
const fakeFetch = vi.fn((url: string, init: RequestInit) => new Promise((resolve) => {
	posts.push({
		url, body: JSON.parse(String(init.body)),
		answer: (body) => resolve({ ok: true, status: 200, json: async () => body, headers: { get: () => null } }),
	});
}));
const MATCH = { ok: true, duplicateCheck: { state: 'possible_duplicate' } };

let form: FakeForm;
let roots: Record<string, unknown>;
let bridge: Bridge;

async function load(page: Page): Promise<void> {
	form = new FakeForm(page === 'desk');
	roots = {
		'ack-claim': { name: 'ack-claim' },
		'withdrawn-record': { name: 'withdrawn-record' },
		'create-form': form,
		'dup-create': { name: 'dup-create' },
		'dup-record': { name: 'dup-record' },
		book: { name: 'book' },
		mine: { name: 'mine' },
	};
	vi.stubGlobal('document', {
		querySelector: (sel: string) => {
			const m = /^\[data-rcv-root="([\w-]+)"\]$/.exec(sel);
			return (m && roots[m[1]]) ?? null;
		},
	});
	vi.resetModules();
	bridge = await import('../../src/lib/receivables/client/hostBridge');
	await import(`../../src/lib/receivables/client/pages/${page}.ts`);
}

/** Let the debounce, the fake fetch and its promise chains run. */
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const flagLog = (name: string) => rec.log.filter((l) => l.startsWith(`${name}:`));

beforeEach(() => {
	rec.log = [];
	observers = [];
	posts = [];
	fakeFetch.mockClear();
	vi.useFakeTimers();
	vi.stubGlobal('fetch', fakeFetch);
	vi.stubGlobal('MutationObserver', FakeObserver);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('desk: the New client card', () => {
	it('watches only the lock attribute of the intake', async () => {
		await load('desk');
		const lockWatch = observers.filter((o) => o.target === form.lock);
		expect(lockWatch).toHaveLength(1);
		expect(lockWatch[0].opts).toEqual({ attributes: true, attributeFilter: ['data-locked'] });
	});

	it('"Start another deal" (the lock comes off) resets the live check and clears the flag; locking does neither', async () => {
		await load('desk');
		form.lock.dataset.locked = '1';
		changed(form.lock);
		expect(rec.log).toEqual([]);
		delete form.lock.dataset.locked;
		changed(form.lock);
		expect(rec.log).toEqual(['precheck:reset', 'dup-create:clear']);
	});

	it('while the recorded intake is locked, typing starts no check', async () => {
		await load('desk');
		form.lock.dataset.locked = '1';
		form.type();
		await settle(600);
		expect(fakeFetch).not.toHaveBeenCalled();
	});

	it('typing shows the live answer in the create flag, after the delay', async () => {
		await load('desk');
		form.type();
		await settle(599);
		expect(posts).toHaveLength(0);
		await settle(1);
		expect(posts).toHaveLength(1);
		posts[0].answer(MATCH);
		await settle();
		expect(flagLog('dup-create')).toEqual([`dup-create:desk:update:precheck:${JSON.stringify({ duplicateCheck: MATCH.duplicateCheck })}`]);
	});

	it('a create answer with no duplicateCheck (a 400) changes nothing: the live warning stays', async () => {
		await load('desk');
		form.type();
		await settle(600);
		posts[0].answer(MATCH);
		await settle();
		const before = [...rec.log];
		bridge.emitCreateResult({ ok: false, error: 'invalid', message: 'Supplier, buyer and invoice number are required.' });
		bridge.emitCreateResult(null);
		expect(rec.log).toEqual(before);
	});

	it('a create answer with a duplicateCheck suspends the check in flight, and its late answer never replaces the created view', async () => {
		await load('desk');
		form.type();
		await settle(600);
		expect(posts).toHaveLength(1);
		const created = { ok: true, id: 'a'.repeat(64), duplicateCheck: { state: 'no_match' } };
		bridge.emitCreateResult(created);
		expect(rec.log).toEqual(['precheck:suspend', `dup-create:desk:update:created:${JSON.stringify(created)}`]);
		posts[0].answer(MATCH);
		await settle(5000);
		expect(flagLog('dup-create')).toEqual([`dup-create:desk:update:created:${JSON.stringify(created)}`]);
	});

	it('a create answer also cancels a check still waiting out its delay', async () => {
		await load('desk');
		form.type();
		await settle(300);
		bridge.emitCreateResult({ ok: true, duplicateCheck: { state: 'no_match' } });
		await settle(1000);
		expect(fakeFetch).not.toHaveBeenCalled();
	});
});

describe('desk: the opened record and "Your book"', () => {
	it('an opened record feeds the record flag; opening another record closes the claim prompt', async () => {
		await load('desk');
		bridge.emitRecordLoaded({ id: 'a'.repeat(64), duplicateCheck: { state: 'possible_duplicate' } } as never);
		expect(flagLog('dup-record')).toHaveLength(1);
		expect(flagLog('dup-record')[0]).toContain('dup-record:desk:update:record:');
		expect(rec.log).not.toContain('closeAck');
		bridge.emitRecordLoaded({ id: 'b'.repeat(64) } as never);
		expect(rec.log.filter((l) => l === 'closeAck')).toHaveLength(1);
	});

	it('the book is marked on load, and both tags are put back after each redraw', async () => {
		await load('desk');
		const book = roots.book;
		const watch = observers.filter((o) => o.target === book);
		expect(watch).toHaveLength(1);
		expect(watch[0].opts).toEqual({ childList: true });
		bridge.emitBookLoaded([
			{ id: 'w1', withdrawn: true }, { id: 'd1', possibleDuplicate: true }, { id: 'n1', possibleDuplicate: null }, { id: 'x1' },
		] as never);
		expect(rec.log).toEqual(['desk-withdrawn:w1', 'desk-dup:d1']);
		rec.log = [];
		changed(book); // the inline renderBook redrew the table (a search or a filter)
		expect(rec.log).toEqual(['desk-withdrawn:w1', 'desk-dup:d1']);
	});
});

describe('registry and Client Portal: the create form, the record and the list', () => {
	for (const page of ['registry', 'client'] as const) {
		it(`${page}: typing shows the live answer; a create answer without a duplicateCheck changes nothing`, async () => {
			await load(page);
			form.type();
			await settle(600);
			posts[0].answer(MATCH);
			await settle();
			expect(flagLog('dup-create')).toEqual([`dup-create:${page}:update:precheck:${JSON.stringify({ duplicateCheck: MATCH.duplicateCheck })}`]);
			const before = [...rec.log];
			bridge.emitCreateResult({ ok: false, error: 'invalid', message: 'x' });
			bridge.emitCreateResult(null);
			expect(rec.log).toEqual(before);
		});

		it(`${page}: a create answer with a duplicateCheck suspends the check, then shows the created view`, async () => {
			await load(page);
			form.type();
			await settle(600);
			const created = { ok: true, duplicateCheck: { state: 'possible_duplicate' }, ownMatches: [] };
			bridge.emitCreateResult(created);
			expect(rec.log).toEqual(['precheck:suspend', `dup-create:${page}:update:created:${JSON.stringify(created)}`]);
			posts[0].answer(MATCH);
			await settle(5000);
			expect(flagLog('dup-create')).toHaveLength(1);
		});

		it(`${page}: an opened record feeds the record flag`, async () => {
			await load(page);
			bridge.emitRecordLoaded({ id: 'a'.repeat(64), duplicateCheck: { state: 'possible_duplicate' } } as never);
			expect(flagLog('dup-record')).toHaveLength(1);
			expect(flagLog('dup-record')[0]).toContain(`dup-record:${page}:update:record:`);
		});
	}

	it('registry: "Your receivables" tags withdrawn and possible-duplicate rows on each load', async () => {
		await load('registry');
		bridge.emitBookLoaded([{ id: 'w1', withdrawn: true }, { id: 'd1', possibleDuplicate: true }] as never);
		expect(rec.log).toEqual(['registry-withdrawn:w1', 'registry-dup:d1']);
	});

	it('client: "Your receivables" tags possible-duplicate rows on each load', async () => {
		await load('client');
		bridge.emitBookLoaded([{ id: 'd1', possibleDuplicate: true }, { id: 'n1' }] as never);
		expect(rec.log).toEqual(['client-dup:d1']);
	});

	it('neither page watches the DOM (their lists announce every redraw)', async () => {
		await load('registry');
		await load('client');
		expect(observers).toEqual([]);
	});
});
