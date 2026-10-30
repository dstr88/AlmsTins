/**
 * Lot identifications (src/lib/tax/lotIdentification.ts) and how the ledger uses them.
 *
 *   - An identification counts for a sale only if it was recorded strictly before the sale and takes
 *     effect at or before it; with none, the sale uses the earliest-acquired units in its own wallet.
 *   - A new entry may not take effect before the moment it is recorded (no backdating).
 *   - "Latest acquired" orders by original acquisition date; a moved lot keeps its date.
 *   - The report-time FIFO/HIFO toggle does not decide wallet-by-wallet sales once identifications are in play.
 *   - The per-year reconciliation reports what the ledger actually did.
 *
 * Invented amounts and wallet keys only.
 */

import { describe, expect, it } from 'vitest';
import { runLotLedger, type LedgerEvent } from '../../src/lib/tax/lotLedger';
import {
	exchangeStatusOf,
	identificationInForce,
	identificationsKey,
	isExchangeHeld,
	parseNewEntries,
	selectionResolver,
	type LotIdentification,
} from '../../src/lib/tax/lotIdentification';
import { reconcileYear } from '../../src/lib/tax/identificationReconcile';

const A = 'cex:coinbase:acct-a';
const B = 'cex:kraken:acct-b';

let n = 0;
const entry = (over: Partial<LotIdentification> & Pick<LotIdentification, 'walletKey' | 'method' | 'createdAt'>): LotIdentification => ({
	id: `id-${String(++n).padStart(3, '0')}`,
	effectiveAt: over.createdAt,
	note: null,
	batchId: 'batch-1',
	...over,
});

const buy = (id: string, wallet: string, at: string, qty: number, costUsd: number): LedgerEvent => ({
	kind: 'acquire', id, asset: 'ETH', wallet, at, qty, costUsd, origin: 'purchase', sourceRef: id,
});
const sell = (id: string, wallet: string, at: string, qty: number, proceedsUsd = qty * 2500): LedgerEvent => ({
	kind: 'dispose', id, asset: 'ETH', wallet, at, qty, proceedsUsd, taxable: true, category: 'sale', sourceRef: id,
});

describe('which entry is in force for a sale', () => {
	const sale = Date.parse('2025-06-10T12:00:00.000Z');

	it('uses an entry recorded before the sale', () => {
		const e = entry({ walletKey: A, method: 'highest_basis', createdAt: '2025-06-01T00:00:00.000Z' });
		expect(identificationInForce([e], A, sale)).toBe(e);
	});

	it('ignores an entry recorded after the sale, whatever effective date it carries', () => {
		const late = entry({ walletKey: A, method: 'highest_basis', createdAt: '2025-06-11T00:00:00.000Z', effectiveAt: '2025-01-01T00:00:00.000Z' });
		expect(identificationInForce([late], A, sale)).toBeNull();
	});

	it('does not count an entry recorded at the very instant of the sale', () => {
		const same = entry({ walletKey: A, method: 'latest', createdAt: '2025-06-10T12:00:00.000Z' });
		expect(identificationInForce([same], A, sale)).toBeNull();
	});

	it('waits for the effective time', () => {
		const future = entry({ walletKey: A, method: 'latest', createdAt: '2025-06-01T00:00:00.000Z', effectiveAt: '2025-06-20T00:00:00.000Z' });
		expect(identificationInForce([future], A, sale)).toBeNull();
		expect(identificationInForce([future], A, Date.parse('2025-06-20T00:00:00.000Z'))).toBe(future);
	});

	it('takes the latest effective entry, and only for its own wallet', () => {
		const first = entry({ walletKey: A, method: 'highest_basis', createdAt: '2025-03-01T00:00:00.000Z' });
		const second = entry({ walletKey: A, method: 'latest', createdAt: '2025-05-01T00:00:00.000Z' });
		const other = entry({ walletKey: B, method: 'highest_basis', createdAt: '2025-05-15T00:00:00.000Z' });
		expect(identificationInForce([second, first, other], A, sale)).toBe(second);
		expect(identificationInForce([first, second, other], B, sale)).toBe(other);
		expect(identificationInForce([first, second, other], 'cex:other:none', sale)).toBeNull();
	});

	it('skips an entry whose times cannot be read', () => {
		const bad = entry({ walletKey: A, method: 'latest', createdAt: 'not a time' });
		expect(identificationInForce([bad], A, sale)).toBeNull();
	});

	it('the resolver gives the ledger the selector name', () => {
		const e = entry({ walletKey: A, method: 'highest_basis', createdAt: '2025-06-01T00:00:00.000Z' });
		const pick = selectionResolver([e]);
		expect(pick(A, sale)).toEqual({ identificationId: e.id, method: 'hifo' });
		expect(pick(B, sale)).toBeNull();
	});

	it('keys a set of entries by id, whatever the order', () => {
		const x = entry({ walletKey: A, method: 'latest', createdAt: '2025-01-01T00:00:00.000Z' });
		const y = entry({ walletKey: B, method: 'latest', createdAt: '2025-01-02T00:00:00.000Z' });
		expect(identificationsKey([x, y])).toBe(identificationsKey([y, x]));
		expect(identificationsKey([])).toBe('');
	});
});

describe('recording entries', () => {
	const NOW = '2025-06-01T10:00:00.000Z';

	it('records "from now" when no effective time is given', () => {
		const out = parseNewEntries([{ walletKey: A, method: 'earliest' }], NOW);
		expect(out).toEqual({ ok: true, entries: [{ walletKey: A, method: 'earliest', effectiveAt: NOW, note: null }] });
	});

	it('refuses an effective time before the moment of recording', () => {
		expect(parseNewEntries([{ walletKey: A, method: 'latest', effectiveAt: '2025-05-31T23:59:59.000Z' }], NOW)).toEqual({ ok: false, error: 'effective_before_recorded' });
	});

	it('accepts a later effective time and normalizes it', () => {
		const out = parseNewEntries([{ walletKey: A, method: 'latest', effectiveAt: '2025-07-01T00:00:00Z' }], NOW);
		expect(out).toMatchObject({ ok: true, entries: [{ effectiveAt: '2025-07-01T00:00:00.000Z' }] });
	});

	it.each([
		['an unknown method', [{ walletKey: A, method: 'fifo' }], 'method_invalid'],
		['a missing wallet', [{ method: 'latest' }], 'wallet_invalid'],
		['an unassigned wallet', [{ walletKey: 'cex:coinbase:unassigned', method: 'latest' }], 'wallet_invalid'],
		['an unreadable effective time', [{ walletKey: A, method: 'latest', effectiveAt: 'soon' }], 'effective_invalid'],
		['a note that is too long', [{ walletKey: A, method: 'latest', note: 'x'.repeat(501) }], 'note_too_long'],
		['no entries', [], 'no_entries'],
		['not a list', 'latest', 'no_entries'],
	])('refuses %s', (_label, raw, error) => {
		expect(parseNewEntries(raw, NOW)).toEqual({ ok: false, error });
	});

	it('refuses a request with too many entries', () => {
		const many = Array.from({ length: 201 }, () => ({ walletKey: A, method: 'latest' }));
		expect(parseNewEntries(many, NOW)).toEqual({ ok: false, error: 'too_many_entries' });
	});
});

describe('exchange-held entries', () => {
	it('an exchange account needs the exchange told; a wallet you control does not', () => {
		expect(isExchangeHeld(A)).toBe(true);
		expect(isExchangeHeld('ethereum:0x' + 'a'.repeat(40))).toBe(false);
		expect(exchangeStatusOf(A, new Set(), 'x')).toBe('not_confirmed');
		expect(exchangeStatusOf(A, new Set(['x']), 'x')).toBe('confirmed');
		expect(exchangeStatusOf('bitcoin:bc1qinvented', new Set(), 'x')).toBe('not_needed');
	});
});

// ── The ledger ───────────────────────────────────────────────────────────────

const lots: LedgerEvent[] = [
	buy('b1', A, '2025-01-10T00:00:00Z', 1, 1000), // earliest
	buy('b2', A, '2025-02-10T00:00:00Z', 1, 3000), // highest cost
	buy('b3', A, '2025-03-10T00:00:00Z', 1, 2000), // latest
];

const run = (events: LedgerEvent[], entries: LotIdentification[], extra: Parameters<typeof runLotLedger>[1] = {}) =>
	runLotLedger(events, { perWalletFrom: '2025-01-01', selectionFor: selectionResolver(entries), ...extra });

const costOf = (res: ReturnType<typeof runLotLedger>, ref: string) => res.slices.filter((s) => s.sourceRef === ref).reduce((a, s) => a + (s.cost ?? 0), 0);

describe('the ledger follows the identification in force at each sale', () => {
	const highest = entry({ walletKey: A, method: 'highest_basis', createdAt: '2025-04-01T00:00:00.000Z' });
	const latest = entry({ walletKey: A, method: 'latest', createdAt: '2025-05-01T00:00:00.000Z' });
	const events = [...lots, sell('s1', A, '2025-03-20T00:00:00Z', 1), sell('s2', A, '2025-04-10T00:00:00Z', 1), sell('s3', A, '2025-05-10T00:00:00Z', 1)];

	it('sells earliest-acquired before any entry, then what each later entry names', () => {
		const res = run(events, [highest, latest]);
		expect(costOf(res, 's1')).toBe(1000); // no entry yet: the default
		expect(costOf(res, 's2')).toBe(3000); // highest cost, recorded before the sale
		expect(costOf(res, 's3')).toBe(2000); // latest acquired of what is left
	});

	it('records, for each sale, the entry it used or none', () => {
		const res = run(events, [highest, latest]);
		expect(res.selections.map((s) => [s.sourceRef, s.identificationId, s.method])).toEqual([
			['s1', null, 'fifo'],
			['s2', highest.id, 'hifo'],
			['s3', latest.id, 'lifo'],
		]);
	});

	it('does not use an entry recorded after the sale even if it says it took effect earlier', () => {
		const backdated = entry({ walletKey: A, method: 'highest_basis', createdAt: '2025-04-15T00:00:00.000Z', effectiveAt: '2025-01-01T00:00:00.000Z' });
		const res = run([...lots, sell('s2', A, '2025-04-10T00:00:00Z', 1)], [backdated]);
		expect(costOf(res, 's2')).toBe(1000);
		expect(res.selections[0].identificationId).toBeNull();
	});

	it('keeps each wallet to its own entries', () => {
		const events2 = [...lots, buy('c1', B, '2025-01-05T00:00:00Z', 1, 500), buy('c2', B, '2025-02-05T00:00:00Z', 1, 4000), sell('t1', B, '2025-04-10T00:00:00Z', 1)];
		const res = run(events2, [highest]); // names wallet A only
		expect(costOf(res, 't1')).toBe(500); // wallet B has no entry: earliest acquired in B
	});

	it('orders "latest acquired" by original acquisition date, not by when units arrived', () => {
		// 10 units bought in A in January; later 1 unit bought in B in March and moved into A in April.
		const e: LedgerEvent[] = [
			buy('a-old', A, '2025-01-10T00:00:00Z', 10, 10_000),
			buy('b-new', B, '2025-03-10T00:00:00Z', 1, 7_000),
			{ kind: 'move', id: 'm1', asset: 'ETH', fromWallet: B, toWallet: A, outAt: '2025-04-01T00:00:00Z', inAt: '2025-04-01T00:05:00Z', qtyOut: 1, qtyIn: 1, link: 'hash', ownersDiffer: false, outRef: 'm1-out', inRef: 'm1-in' },
			sell('s', A, '2025-04-10T00:00:00Z', 1),
		];
		const lifo = entry({ walletKey: A, method: 'latest', createdAt: '2025-03-01T00:00:00.000Z' });
		const res = run(e, [lifo]);
		const slice = res.slices.find((s) => s.sourceRef === 's')!;
		expect(slice.cost).toBe(7_000);
		expect(slice.acquiredAt.startsWith('2025-03-10')).toBe(true);
	});

	it('ignores the report-time toggle for wallet-by-wallet sales when identifications are in play', () => {
		const res = run([...lots, sell('s1', A, '2025-03-20T00:00:00Z', 1)], [], { method: 'hifo' });
		expect(costOf(res, 's1')).toBe(1000);
	});

	it('leaves the toggle in force for sales before the wallet-by-wallet rule', () => {
		const old = [buy('o1', A, '2023-01-10T00:00:00Z', 1, 100), buy('o2', A, '2023-02-10T00:00:00Z', 1, 900), sell('os', A, '2024-01-10T00:00:00Z', 1)];
		const res = run(old, [highest], { method: 'hifo' });
		expect(costOf(res, 'os')).toBe(900);
		expect(res.selections).toEqual([]);
	});

	it('without a selector the ledger behaves as before', () => {
		const res = runLotLedger([...lots, sell('s1', A, '2025-03-20T00:00:00Z', 1)], { perWalletFrom: '2025-01-01', method: 'hifo' });
		expect(costOf(res, 's1')).toBe(3000);
		expect(res.selections).toEqual([]);
	});
});

describe('the year reconciliation', () => {
	const highest = entry({ walletKey: A, method: 'highest_basis', createdAt: '2025-04-01T00:00:00.000Z' });
	const events = [...lots, sell('s1', A, '2025-03-20T00:00:00Z', 1), sell('s2', A, '2025-04-10T00:00:00Z', 1)];

	it('counts sales covered by an entry recorded before them and lists the rest as the default', () => {
		const res = run(events, [highest]);
		const recon = reconcileYear(res.selections, [highest], 2025);
		expect(recon).toMatchObject({ year: 2025, applicable: true, covered: 1, total: 2 });
		expect(recon.rows.map((r) => [r.sourceRef, r.identification?.id ?? null, r.method])).toEqual([
			['s1', null, 'earliest'],
			['s2', highest.id, 'highest_basis'],
		]);
	});

	it('leaves out other years and non-taxable disposals', () => {
		const res = run([...events, sell('s-next', A, '2026-01-10T00:00:00Z', 0.5)], [highest]);
		expect(reconcileYear(res.selections, [highest], 2025).total).toBe(2);
		expect(reconcileYear(res.selections, [highest], 2026).total).toBe(1);
	});

	it('says years before 2025 do not apply', () => {
		expect(reconcileYear([], [], 2024)).toEqual({ year: 2024, applicable: false, rows: [], covered: 0, total: 0 });
	});
});
