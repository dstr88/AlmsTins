import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * src/lib/receivables/client/hostBridge.ts: the seam between a host page's inline script and its
 * entry module. Each test imports a fresh copy of the module (its last values are module state),
 * so no test sees another test's emits.
 *
 * A throwing listener is deliberately not tested here: EventTarget reports the error the way the
 * platform does, which in Node is an uncaught exception that would fail the run.
 */

type Bridge = typeof import('../../src/lib/receivables/client/hostBridge');

async function fresh(): Promise<Bridge> {
	vi.resetModules();
	return import('../../src/lib/receivables/client/hostBridge');
}

// Stand-ins for the hosts' live objects: identity is what matters, not shape.
const rec = (id: string) => ({ id }) as never;
const rows = (...ids: string[]) => ids.map((id) => ({ id })) as never;

let bridge: Bridge;
beforeEach(async () => { bridge = await fresh(); });

describe('record channel', () => {
	it('subscribe, then emit: the listener gets the emitted object', () => {
		const seen: unknown[] = [];
		bridge.onRecordLoaded((s) => seen.push(s));
		const a = rec('a');
		bridge.emitRecordLoaded(a);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toBe(a);
	});

	it('emit, then subscribe: the last value is replayed once, then live values follow', () => {
		const a = rec('a');
		const b = rec('b');
		const c = rec('c');
		bridge.emitRecordLoaded(a);
		bridge.emitRecordLoaded(b);
		const seen: unknown[] = [];
		bridge.onRecordLoaded((s) => seen.push(s));
		expect(seen).toEqual([b]);
		expect(seen[0]).toBe(b);
		bridge.emitRecordLoaded(c);
		expect(seen).toHaveLength(2);
		expect(seen[1]).toBe(c);
	});

	it('null replays after the host cleared its record view', () => {
		bridge.emitRecordLoaded(rec('a'));
		bridge.emitRecordLoaded(null);
		const seen: unknown[] = [];
		bridge.onRecordLoaded((s) => seen.push(s));
		expect(seen).toEqual([null]);
	});

	it('nothing emitted yet: subscribing hands back nothing', () => {
		const cb = vi.fn();
		bridge.onRecordLoaded(cb);
		expect(cb).not.toHaveBeenCalled();
	});

	it('unsubscribe stops delivery, and other listeners keep theirs', () => {
		const one = vi.fn();
		const two = vi.fn();
		const off = bridge.onRecordLoaded(one);
		bridge.onRecordLoaded(two);
		bridge.emitRecordLoaded(rec('a'));
		off();
		bridge.emitRecordLoaded(rec('b'));
		expect(one).toHaveBeenCalledTimes(1);
		expect(two).toHaveBeenCalledTimes(2);
	});
});

describe('book channel', () => {
	it('subscribe-then-emit and emit-then-subscribe both deliver the same array', () => {
		const list = rows('a', 'b');
		const early = vi.fn();
		bridge.onBookLoaded(early);
		bridge.emitBookLoaded(list);
		expect(early).toHaveBeenCalledTimes(1);
		expect(early.mock.calls[0][0]).toBe(list);

		const late = vi.fn();
		bridge.onBookLoaded(late);
		expect(late).toHaveBeenCalledTimes(1);
		expect(late.mock.calls[0][0]).toBe(list);
	});

	it('unsubscribe stops delivery', () => {
		const cb = vi.fn();
		const off = bridge.onBookLoaded(cb);
		off();
		bridge.emitBookLoaded(rows('a'));
		expect(cb).not.toHaveBeenCalled();
	});
});

describe('channels and module copies', () => {
	it('the record and book channels are independent', () => {
		const onRec = vi.fn();
		const onBook = vi.fn();
		bridge.emitBookLoaded(rows('a'));
		bridge.onRecordLoaded(onRec);
		expect(onRec).not.toHaveBeenCalled();

		bridge.onBookLoaded(onBook);
		onBook.mockClear();
		bridge.emitRecordLoaded(rec('r'));
		expect(onRec).toHaveBeenCalledTimes(1);
		expect(onBook).not.toHaveBeenCalled();
	});

	it('a fresh import replays nothing', async () => {
		bridge.emitRecordLoaded(rec('a'));
		bridge.emitBookLoaded(rows('a'));
		const next = await fresh();
		const onRec = vi.fn();
		const onBook = vi.fn();
		next.onRecordLoaded(onRec);
		next.onBookLoaded(onBook);
		expect(onRec).not.toHaveBeenCalled();
		expect(onBook).not.toHaveBeenCalled();
	});
});
