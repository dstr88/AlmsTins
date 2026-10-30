import { beforeEach, describe, expect, it } from 'vitest';
import { XPR_PAGE_SIZE, parseQuantity, readXprHistory, transferOfAction, type XprTransfer } from '@/lib/xpr/history';
import { XprUnavailableError, resetXprServerProofs } from '@/lib/xpr/client';
import { ALICE, BOB, CAROL, HYPER, action, actionsPage, fakeFetch, hyperionServer, now } from './fixtures';

beforeEach(() => resetXprServerProofs());

describe('parseQuantity', () => {
	it('reads the amount, its precision and the symbol', () => {
		expect(parseQuantity('0.2901 XPR')).toEqual({ amount: 0.2901, precision: 4, symbol: 'XPR' });
		expect(parseQuantity('367200.0000 SLOAN')).toEqual({ amount: 367200, precision: 4, symbol: 'SLOAN' });
		expect(parseQuantity('5 TOK')).toEqual({ amount: 5, precision: 0, symbol: 'TOK' });
	});
	it('refuses what is not a token quantity', () => {
		for (const bad of ['', 'XPR', '1.0 xpr', '-1.0000 XPR', '1.0000', null, undefined, 12]) expect(parseQuantity(bad), String(bad)).toBeNull();
	});
});

describe('transferOfAction', () => {
	const t = (o: Parameters<typeof action>[0], who = ALICE) => transferOfAction(action(o), who);

	it('a receive: from the other account, amount positive', () => {
		const r = t({ seq: 1, at: '2026-10-30T16:25:54.000', from: BOB, to: ALICE, quantity: '0.2901 XPR', memo: 'thanks' }) as XprTransfer;
		expect(r).toMatchObject({ direction: 'in', counterparty: BOB, amount: 0.2901, precision: 4, asset: 'XPR', symbol: 'XPR', contract: 'eosio.token', memo: 'thanks', globalSequence: '1' });
		expect(r.timestamp).toBe('2026-10-30T16:25:54.000Z');
	});

	it('a send: to the other account', () => {
		expect(t({ seq: 2, at: '2026-10-30T16:25:54.000', from: ALICE, to: CAROL, quantity: '5.0000 XPR' })).toMatchObject({ direction: 'out', counterparty: CAROL });
	});

	it('a token of another contract is SYMBOL@contract, never the chain\'s coin', () => {
		const r = t({ seq: 3, at: '2026-10-30T16:25:54.000', from: BOB, to: ALICE, quantity: '12.500000 XUSDC', contract: 'xtokens' }) as XprTransfer;
		expect(r.asset).toBe('XUSDC@xtokens');
		expect(r.precision).toBe(6);
		const fake = t({ seq: 4, at: '2026-10-30T16:25:54.000', from: BOB, to: ALICE, quantity: '1.0000 XPR', contract: 'fakecontract' }) as XprTransfer;
		expect(fake.asset).toBe('XPR@fakecontract');
	});

	it('is not a row when the account is neither side, or sends to itself, or there is no quantity', () => {
		expect(t({ seq: 5, at: '2026-10-30T16:25:54.000', from: BOB, to: CAROL, quantity: '1.0000 XPR' })).toBeNull();
		expect(t({ seq: 6, at: '2026-10-30T16:25:54.000', from: ALICE, to: ALICE, quantity: '1.0000 XPR' })).toBeNull();
		expect(t({ seq: 7, at: '2026-10-30T16:25:54.000', from: BOB, to: ALICE, quantity: '', data: { from: BOB, to: ALICE, asset_ids: ['1099'], memo: '' }, contract: 'atomicassets' })).toBeNull();
		expect(t({ seq: 8, at: '2026-10-30T16:25:54.000', from: BOB, to: ALICE, quantity: '1.0000 XPR', name: 'issue' })).toBeNull();
		expect(transferOfAction(null, ALICE)).toBeNull();
	});
});

/**
 * A fake Hyperion that serves a fixed list of actions the way the real one pages: sort=asc,
 * `after` inclusive, limit and skip. It records the queries.
 */
function pagedHyperion(all: ReturnType<typeof action>[], opts: { failFrom?: number } = {}) {
	const queries: Array<{ after: string | null; skip: number }> = [];
	const handler = hyperionServer({
		'/v2/history/get_actions': (q) => {
			const after = q.get('after');
			const skip = Number(q.get('skip') ?? 0);
			queries.push({ after, skip });
			if (opts.failFrom !== undefined && queries.length > opts.failFrom) return new Error('connect ECONNREFUSED');
			expect(q.get('account')).toBe(ALICE);
			expect(q.get('filter')).toBe('*:transfer');
			expect(q.get('sort')).toBe('asc');
			expect(Number(q.get('limit'))).toBe(XPR_PAGE_SIZE);
			const from = after ? all.filter((a) => Date.parse(`${a.timestamp}Z`) >= Date.parse(after.endsWith('Z') ? after : `${after}Z`)) : all;
			return { json: actionsPage(from.slice(skip, skip + XPR_PAGE_SIZE)) };
		},
	});
	return { handler, queries };
}

const at = (i: number) => new Date(Date.parse('2026-01-01T00:00:00.000Z') + i * 1000).toISOString().slice(0, 23);
const inbound = (seq: number, when: string) => action({ seq, at: when, from: BOB, to: ALICE, quantity: '1.0000 XPR' });

async function read(all: ReturnType<typeof action>[], extra: Parameters<typeof readXprHistory>[1] = {}, hyp: ReturnType<typeof pagedHyperion> = pagedHyperion(all)) {
	const { fetchImpl } = fakeFetch({ [HYPER]: hyp.handler });
	const pages: XprTransfer[][] = [];
	const result = await readXprHistory(ALICE, { fetchImpl, hyperionServers: [HYPER], now, onPage: ({ transfers }) => void pages.push(transfers), ...extra });
	return { result, pages, rows: pages.flat(), hyp };
}

describe('readXprHistory', () => {
	it('reads a short history in one page, oldest first, and says it is complete', async () => {
		const all = [inbound(1, at(1)), action({ seq: 2, at: at(2), from: ALICE, to: CAROL, quantity: '0.5000 XPR' })];
		const { result, rows } = await read(all);
		expect(rows.map((r) => r.globalSequence)).toEqual(['1', '2']);
		expect(result).toMatchObject({ complete: true, counts: { actions: 2, kept: 2, ignored: 0 } });
	});

	it('counts what it does not keep', async () => {
		const all = [inbound(1, at(1)), action({ seq: 2, at: at(2), from: BOB, to: CAROL, quantity: '1.0000 XPR' }), action({ seq: 3, at: at(3), from: ALICE, to: ALICE, quantity: '1.0000 XPR' })];
		const { result, rows } = await read(all);
		expect(rows).toHaveLength(1);
		expect(result.counts).toEqual({ actions: 3, kept: 1, ignored: 2 });
	});

	it('moves the time window forward instead of paging deep, and takes each action once', async () => {
		const total = XPR_PAGE_SIZE * 2 + 345;
		const all = Array.from({ length: total }, (_, i) => inbound(i + 1, at(i)));
		const { result, rows, hyp } = await read(all);
		expect(rows).toHaveLength(total);
		expect(new Set(rows.map((r) => r.globalSequence)).size).toBe(total);
		expect(rows.map((r) => Number(r.globalSequence))).toEqual(Array.from({ length: total }, (_, i) => i + 1));
		expect(result.complete).toBe(true);
		// Windows, not depth: no query skipped anything.
		expect(hyp.queries.every((q) => q.skip === 0)).toBe(true);
		expect(hyp.queries.length).toBeGreaterThanOrEqual(3);
	});

	it('actions sharing the instant the window moved to are not taken twice', async () => {
		// The page boundary falls inside one instant: the next page starts at that instant again.
		const all = Array.from({ length: XPR_PAGE_SIZE + 5 }, (_, i) => inbound(i + 1, i < XPR_PAGE_SIZE - 3 ? at(i) : at(5000)));
		const { rows } = await read(all);
		expect(rows).toHaveLength(all.length);
		expect(new Set(rows.map((r) => r.globalSequence)).size).toBe(all.length);
	});

	it('an instant with more actions than a page is read by skipping within it', async () => {
		const total = XPR_PAGE_SIZE * 2 + 10;
		const all = Array.from({ length: total }, (_, i) => inbound(i + 1, at(7)));
		const { rows, hyp, result } = await read(all);
		expect(rows).toHaveLength(total);
		expect(new Set(rows.map((r) => r.globalSequence)).size).toBe(total);
		expect(hyp.queries.some((q) => q.skip > 0)).toBe(true);
		expect(result.complete).toBe(true);
	});

	it('resumes from a given instant (inclusive) when asked', async () => {
		const all = Array.from({ length: 10 }, (_, i) => inbound(i + 1, at(i)));
		const { rows, hyp } = await read(all, { after: `${at(6)}Z` });
		expect(rows.map((r) => r.globalSequence)).toEqual(['7', '8', '9', '10']);
		expect(hyp.queries[0].after).toBe(at(6));
	});

	it('stops when its time budget runs out, keeps what it read, and says it is not complete', async () => {
		const all = Array.from({ length: XPR_PAGE_SIZE * 3 }, (_, i) => inbound(i + 1, at(i)));
		let clock = 0;
		const { result, rows } = await read(all, { budgetMs: 1000, now: () => (clock += 600) });
		expect(result.complete).toBe(false);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.length).toBeLessThan(all.length);
		expect(result.reachedAt).not.toBeNull();
	});

	it('when the server fails mid-history it throws, and the pages already handed over stand', async () => {
		const all = Array.from({ length: XPR_PAGE_SIZE * 2 }, (_, i) => inbound(i + 1, at(i)));
		const pages: XprTransfer[][] = [];
		const { fetchImpl } = fakeFetch({ [HYPER]: pagedHyperion(all, { failFrom: 1 }).handler });
		await expect(readXprHistory(ALICE, { fetchImpl, hyperionServers: [HYPER], now, onPage: ({ transfers }) => void pages.push(transfers) })).rejects.toBeInstanceOf(XprUnavailableError);
		expect(pages.flat()).toHaveLength(XPR_PAGE_SIZE);
	});

	it('a Hyperion whose index stopped is not trusted: its answer is not a history', async () => {
		const { fetchImpl } = fakeFetch({ [HYPER]: hyperionServer({ '/v2/history/get_actions': () => ({ json: actionsPage([inbound(1, at(1))], '2026-10-30T10:00:00.000') }) }) });
		await expect(readXprHistory(ALICE, { fetchImpl, hyperionServers: [HYPER], now })).rejects.toBeInstanceOf(XprUnavailableError);
	});

	it('refuses a name that is not shaped like one', async () => {
		await expect(readXprHistory('Nope!')).rejects.toThrow('not an XPR account name');
	});
});
