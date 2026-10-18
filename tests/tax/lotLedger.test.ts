import { describe, it, expect } from 'vitest';
import {
	ENGINE_VERSION,
	EPSILON,
	FINDING_REASONS,
	TRANSIT_WALLET,
	UNALLOCATED_WALLET,
	runLotLedger,
	type AcquireOrigin,
	type LedgerEvent,
	type LedgerOptions,
	type LedgerResult,
	type ManualBasis,
	type MoveLink,
} from '../../src/lib/tax/lotLedger';
import { resolveTransferLinks, type TransferMatchRow, type TransferRow } from '../../src/lib/tax/transferLinks';
import { cexWalletKey } from '../../src/lib/walletKey';
import { runFifo } from '../../src/lib/yearEnd/pass4';
import type { ClassificationResult, RawImportTx } from '../../src/lib/yearEnd/types';

/**
 * The lot ledger core (src/lib/tax/lotLedger.ts), pure and not wired into any runtime path yet.
 * Every name, amount and address below is invented.
 *
 * Sections 1 to 10 are the scenarios T1 to T10 of the tax-engine plan; the rest pin the rules
 * around them (moves, entered bases, unmatched sends, methods) and the cross-cutting invariants,
 * which run over histories generated from fixed seeds.
 */

// ── Builders ─────────────────────────────────────────────────────────────────

const PW: LedgerOptions = { perWalletFrom: '2025-01-01' };

function acquire(id: string, asset: string, wallet: string, at: string, qty: number, costUsd: number | null, origin: AcquireOrigin = 'purchase'): LedgerEvent {
	return { kind: 'acquire', id, asset, wallet, at, qty, costUsd, origin, sourceRef: `src:${id}` };
}

function dispose(id: string, asset: string, wallet: string, at: string, qty: number, proceedsUsd: number | null, extra: { taxable?: boolean; category?: string; manualBasis?: ManualBasis } = {}): LedgerEvent {
	return { kind: 'dispose', id, asset, wallet, at, qty, proceedsUsd, taxable: extra.taxable ?? true, category: extra.category ?? 'sell', sourceRef: `src:${id}`, ...(extra.manualBasis ? { manualBasis: extra.manualBasis } : {}) };
}

function move(id: string, asset: string, fromWallet: string, toWallet: string, outAt: string, inAt: string, qtyOut: number, qtyIn: number, extra: { link?: MoveLink; ownersDiffer?: boolean; manualBasis?: ManualBasis } = {}): LedgerEvent {
	return {
		kind: 'move', id, asset, fromWallet, toWallet, outAt, inAt, qtyOut, qtyIn, link: extra.link ?? 'hash', ownersDiffer: extra.ownersDiffer ?? false,
		outRef: `${id}:out`, inRef: `${id}:in`, ...(extra.manualBasis ? { manualBasis: extra.manualBasis } : {}),
	};
}

function sendUnmatched(id: string, asset: string, wallet: string, at: string, qty: number, valueUsd: number | null): LedgerEvent {
	return { kind: 'sendUnmatched', id, asset, wallet, at, qty, valueUsd, sourceRef: `src:${id}` };
}

const must = <T>(v: T | undefined | null, what = 'value'): T => {
	if (v === undefined || v === null) throw new Error(`missing ${what}`);
	return v;
};
const sum = (xs: readonly (number | null)[]): number => xs.reduce<number>((a, v) => a + (v ?? 0), 0);
const open = (r: LedgerResult) => r.lots.filter((l) => l.remainingQty > EPSILON);
const taxable = (r: LedgerResult) => r.slices.filter((s) => s.taxable);
const reasons = (r: LedgerResult) => r.findings.map((f) => f.reason);
const findingsOf = (r: LedgerResult, reason: string) => r.findings.filter((f) => f.reason === reason);
const ymd = (s: string) => s.slice(0, 10);

/** The term of one unit bought at `buy` and sold at `sell`, through the whole ledger. */
function termOf(buy: string, sell: string, opts: LedgerOptions = {}): 'short' | 'long' {
	const r = runLotLedger([acquire('b', 'BTC', 'W', buy, 1, 100), dispose('s', 'BTC', 'W', sell, 1, 150)], opts);
	return must(r.slices[0], 'slice').term;
}

// ── 1. Buy on an exchange, move to your own wallet, sell from the wallet ─────

describe('T1: buy on an exchange, move to your own wallet, sell from the wallet', () => {
	const CB = 'cex:coinbase:acct-1';
	const W = 'ethereum:0xaaa';
	const events = [
		acquire('buy', 'ETH', CB, '2024-03-05T00:00:00Z', 1, 3000),
		move('mv', 'ETH', CB, W, '2025-02-10T00:00:00Z', '2025-02-10T00:12:00Z', 1, 1),
		dispose('sale', 'ETH', W, '2025-08-01T00:00:00Z', 1, 4000),
	];

	it('books no disposal for the move and one long-term slice for the sale, with the original date and cost', () => {
		const r = runLotLedger(events, PW);
		expect(r.slices).toHaveLength(1);
		expect(r.slices.some((s) => s.disposedAt.startsWith('2025-02-10'))).toBe(false);
		const s = r.slices[0];
		expect(s).toMatchObject({ wallet: W, acquiredAt: '2024-03-05T00:00:00Z', disposedAt: '2025-08-01T00:00:00Z', qty: 1, cost: 3000, proceeds: 4000, gain: 1000, term: 'long', taxable: true, basisSource: 'recorded' });
		expect(r.unmatched).toEqual([]);
		expect(r.findings).toEqual([]);
	});

	it('the moved lot names the Coinbase lot it was cut from, and nothing is left open', () => {
		const r = runLotLedger(events, PW);
		const coinbase = must(r.lots.find((l) => l.wallet === CB), 'coinbase lot');
		const moved = must(r.lots.find((l) => l.wallet === W), 'moved lot');
		expect(moved.originLotId).toBe(coinbase.id);
		expect(moved.acquiredAt).toBe('2024-03-05T00:00:00Z');
		expect(r.slices[0].lotId).toBe(moved.id);
		expect(open(r)).toEqual([]);
	});

	it('the holding period runs from the original purchase: 2025-08-01 is more than a year after 2024-03-05', () => {
		expect(runLotLedger(events, PW).slices[0].term).toBe('long');
	});

	it('variant, all in 2024: no sale on the move, and the sale is short-term', () => {
		const inYear = [
			acquire('buy', 'ETH', CB, '2024-03-05T00:00:00Z', 1, 3000),
			move('mv', 'ETH', CB, W, '2024-06-01T00:00:00Z', '2024-06-01T00:10:00Z', 1, 1),
			dispose('sale', 'ETH', W, '2024-12-01T00:00:00Z', 1, 4000),
		];
		const r = runLotLedger(inYear, PW);
		expect(r.slices).toHaveLength(1);
		expect(r.slices[0]).toMatchObject({ cost: 3000, gain: 1000, term: 'short', acquiredAt: '2024-03-05T00:00:00Z' });
		// Before the boundary a move changes no lot: the same figures with one pool for every year.
		const universal = runLotLedger(inYear);
		expect(universal.slices).toEqual(r.slices);
	});
});

// ── 2. Two accounts at one exchange ──────────────────────────────────────────

describe('T2: two accounts at one exchange (owner labels Me and Spouse)', () => {
	const ME = cexWalletKey('coinbase', 'acct-me');
	const SP = cexWalletKey('coinbase', 'acct-sp');
	const base = [
		acquire('me', 'BTC', ME, '2023-01-10T00:00:00Z', 1, 20_000),
		acquire('sp', 'BTC', SP, '2024-05-01T00:00:00Z', 1, 60_000),
		dispose('sale', 'BTC', SP, '2025-04-01T00:00:00Z', 1, 80_000),
	];

	it('the keys differ, and the unassigned bucket is its own wallet per exchange', () => {
		expect(ME).not.toBe(SP);
		expect(cexWalletKey('coinbase', null)).toBe('cex:coinbase:unassigned');
		expect(cexWalletKey('coinbase', null)).not.toBe(cexWalletKey('kraken', null));
		// Lots in one exchange's unassigned bucket are not another's to sell.
		const r = runLotLedger(
			[
				acquire('k', 'BTC', cexWalletKey('kraken', null), '2024-01-01T00:00:00Z', 1, 100),
				dispose('s', 'BTC', cexWalletKey('coinbase', null), '2025-03-01T00:00:00Z', 1, 200),
			],
			PW,
		);
		expect(r.slices).toEqual([]);
		expect(r.unmatched).toHaveLength(1);
	});

	it("the sale takes the selling account's own lot: cost 60,000, gain 20,000, short-term (the anniversary is 2025-05-01)", () => {
		const r = runLotLedger(base, PW);
		expect(r.slices).toHaveLength(1);
		expect(r.slices[0]).toMatchObject({ wallet: SP, cost: 60_000, gain: 20_000, term: 'short', acquiredAt: '2024-05-01T00:00:00Z' });
		// The other account's lot is untouched.
		expect(open(r).map((l) => [l.wallet, l.remainingCostUsd])).toEqual([[ME, 20_000]]);
	});

	it('variant: a heuristic link between the owners moves the 2023 lot with its date, and both review findings are raised', () => {
		const events = [
			...base.slice(0, 2),
			move('mv', 'BTC', ME, SP, '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 1, 1, { link: 'heuristic', ownersDiffer: true }),
			base[2],
		];
		const r = runLotLedger(events, PW);
		expect(reasons(r)).toEqual(expect.arrayContaining(['transfer_between_owners', 'transfer_link_unconfirmed']));
		// The spouse's pool now holds the 2023 lot and the 2024 lot; first in, first out by original date.
		expect(r.slices).toHaveLength(1);
		expect(r.slices[0]).toMatchObject({ wallet: SP, acquiredAt: '2023-01-10T00:00:00Z', cost: 20_000, gain: 60_000, term: 'long' });
		expect(open(r).map((l) => [l.wallet, l.acquiredAt, l.remainingCostUsd])).toEqual([[SP, '2024-05-01T00:00:00Z', 60_000]]);
	});

	it('an owner-to-owner move linked by hash raises the owners finding and not the unconfirmed one', () => {
		const r = runLotLedger([base[0], move('mv', 'BTC', ME, SP, '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 1, 1, { link: 'hash', ownersDiffer: true })], PW);
		expect(reasons(r)).toEqual(['transfer_between_owners']);
	});
});

// ── 3. The same coin bought in two wallets, sold from one ────────────────────

describe('T3: the same coin bought in two wallets, sold from one', () => {
	const events = [
		acquire('w1', 'ETH', 'W1', '2025-01-15T00:00:00Z', 2, 4000),
		acquire('w2', 'ETH', 'W2', '2025-02-01T00:00:00Z', 1, 3000),
		dispose('sale', 'ETH', 'W2', '2025-03-01T00:00:00Z', 1, 3500),
	];

	it("takes W2's lot: cost 3,000, gain 500, and leaves W1's lot untouched", () => {
		const r = runLotLedger(events, PW);
		expect(r.slices).toHaveLength(1);
		expect(r.slices[0]).toMatchObject({ wallet: 'W2', cost: 3000, proceeds: 3500, gain: 500, term: 'short' });
		const w1 = must(r.lots.find((l) => l.wallet === 'W1'), 'W1 lot');
		expect([w1.remainingQty, w1.remainingCostUsd]).toEqual([2, 4000]);
	});

	it('control: with one pool for every year the same sale takes the 2,000 lot from W1', () => {
		const r = runLotLedger(events, { perWalletFrom: null });
		expect(r.slices[0]).toMatchObject({ cost: 2000, gain: 1500, acquiredAt: '2025-01-15T00:00:00Z' });
	});
});

// ── 4. 2024 lots carried into 2025 under the reconstruction ──────────────────

describe('T4: 2024 lots carried into 2025 under the reconstruction', () => {
	const K1 = 'cex:kraken:k1';
	const BC = 'bitcoin:bc1-test';
	const history = [
		acquire('k2022', 'BTC', K1, '2022-02-01T00:00:00Z', 1, 40_000),
		acquire('k2023', 'BTC', K1, '2023-03-01T00:00:00Z', 1, 25_000),
		acquire('b2024', 'BTC', BC, '2024-01-20T00:00:00Z', 1, 42_000),
		dispose('sale24', 'BTC', BC, '2024-07-01T00:00:00Z', 1, 60_000),
	];
	const sale25 = dispose('sale25', 'BTC', K1, '2025-03-01T00:00:00Z', 1, 90_000);

	it('before 2025 the pool is universal: the sale takes the 2022 lot, long-term, gain 20,000, as it does today', () => {
		const r = runLotLedger([...history, sale25], PW);
		expect(r.slices[0]).toMatchObject({ lotId: 'lot:k2022', cost: 40_000, gain: 20_000, term: 'long' });
		expect(r.slices[0]).toEqual(runLotLedger([...history, sale25], { perWalletFrom: null }).slices[0]);
	});

	it('the January 1 balances are k1 = 2 and bc1-test = 0, and the unused basis is the end-of-2024 pool, 67,000', () => {
		const r = runLotLedger([...history, sale25], { ...PW, snapshotsAt: ['2024-12-31T23:59:59.999Z'] });
		const jan1 = must(r.jan1.find((j) => j.asset === 'BTC'), 'jan1 BTC');
		expect(jan1.source).toBe('reconstruction');
		expect(jan1.positions.map((p) => [p.wallet, p.units])).toEqual([[K1, 2]]);
		expect(sum(jan1.unused.map((u) => u.costUsd))).toBe(67_000);
		const endOf2024 = must(r.snapshots[0], 'snapshot');
		expect(sum(endOf2024.lots.map((l) => l.costUsd))).toBe(67_000);
		expect(jan1.positions[0].costUsd).toBe(67_000);
	});

	it('the 2022 lot never reappears; the 2023 lot is placed by the origin pass, the 2024 lot fills into k1', () => {
		const r = runLotLedger([...history, sale25], PW);
		const jan1 = must(r.jan1.find((j) => j.asset === 'BTC'), 'jan1 BTC');
		expect(jan1.positions.flatMap((p) => p.lots).some((l) => l.lotId === 'lot:k2022' || l.fromLotId === 'lot:k2022')).toBe(false);
		expect(jan1.unused.map((u) => u.lotId)).toEqual(['lot:k2023', 'lot:b2024']);
		expect(must(r.lots.find((l) => l.id === 'lot:k2023')).allocation).toEqual({ pass: 'origin', fromWallet: null });
		expect(must(r.lots.find((l) => l.id === 'lot:b2024')).allocation).toEqual({ pass: 'fill', fromWallet: BC });
		expect(must(r.lots.find((l) => l.id === 'lot:k2022')).remainingQty).toBe(0);
	});

	it('a 2025-03-01 sale of 1 BTC from k1 for 90,000 takes the 2023 lot: gain 65,000, long-term', () => {
		const r = runLotLedger([...history, sale25], PW);
		expect(r.slices[1]).toMatchObject({ wallet: K1, lotId: 'lot:k2023', cost: 25_000, proceeds: 90_000, gain: 65_000, term: 'long' });
		expect(r.findings).toEqual([]);
	});

	describe('variants', () => {
		it('balances k1 = 2 and bc1-test = 1 with only 2 unused units: one placeholder unit, a gap finding, and selling it is unmatched, not settled', () => {
			// The 2024 sale was recorded under a wallet key the books never bought in, so the pool is
			// one unit short of what the wallets hold.
			const OTHER = 'cex:other:o1';
			const events = [
				acquire('k2022', 'BTC', K1, '2022-02-01T00:00:00Z', 1, 40_000),
				acquire('k2023', 'BTC', K1, '2023-03-01T00:00:00Z', 1, 25_000),
				acquire('b2024', 'BTC', BC, '2024-01-20T00:00:00Z', 1, 42_000),
				dispose('sale24', 'BTC', OTHER, '2024-07-01T00:00:00Z', 1, 60_000),
				dispose('sale25', 'BTC', K1, '2025-03-01T00:00:00Z', 2, 100_000),
			];
			const r = runLotLedger(events, PW);
			const gap = findingsOf(r, 'jan1_position_gap').filter((f) => f.detail === 'units_without_basis');
			expect(gap.map((f) => [f.wallet, f.qty])).toEqual([[K1, 1]]);
			expect(findingsOf(r, 'jan1_position_gap').some((f) => f.detail === 'negative_balance' && f.wallet === OTHER && f.qty === 1)).toBe(true);
			const placeholder = must(r.lots.find((l) => l.origin === 'jan1_placeholder'), 'placeholder');
			expect(placeholder).toMatchObject({ wallet: K1, basisSource: 'missing', remainingQty: 0, allocation: { pass: 'placeholder' } });

			const sale = r.slices.filter((s) => s.sourceRef === 'src:sale25');
			expect(sale).toHaveLength(1);
			expect(sale[0]).toMatchObject({ lotId: 'lot:k2023', qty: 1, cost: 25_000, proceeds: 50_000 });
			expect(r.unmatched).toEqual([{ asset: 'BTC', wallet: K1, at: '2025-03-01T00:00:00Z', qty: 1, placeholderQty: 1, proceeds: 50_000, taxable: true, category: 'sell', sourceRef: 'src:sale25' }]);
		});

		describe('when the lots left cover fewer units than the wallets hold', () => {
			// k1 holds 2 and bc1-test holds 1, but only 2 units of basis are left: the 2024 sale was recorded under a key nothing was bought in.
			const gap = [
				acquire('k2022', 'BTC', K1, '2022-02-01T00:00:00Z', 1, 40_000),
				acquire('k2023', 'BTC', K1, '2023-03-01T00:00:00Z', 1, 25_000),
				acquire('b2024', 'BTC', BC, '2024-01-20T00:00:00Z', 1, 42_000),
				dispose('sale24', 'BTC', 'cex:other:o1', '2024-07-01T00:00:00Z', 1, 60_000),
			];
			const L2023 = '2023-03-01T00:00:00Z';
			const L2024 = '2024-01-20T00:00:00Z';
			const withRows = (rows: { wallet: string; acquiredAt: string; qty: number }[]) => runLotLedger(gap, { ...PW, allocationOverrides: [{ asset: 'BTC', rows }] });

			it('an allocation that places every lot is accepted, and the unit left over is a placeholder with a gap finding', () => {
				const r = withRows([{ wallet: K1, acquiredAt: L2023, qty: 1 }, { wallet: BC, acquiredAt: L2024, qty: 1 }]);
				expect(findingsOf(r, 'allocation_override_rejected')).toEqual([]);
				const jan1 = must(r.jan1[0]);
				expect(jan1).toMatchObject({ source: 'override', overrideRejected: false });
				expect(jan1.positions.map((p) => [p.wallet, p.units, p.lots.map((l) => l.pass)])).toEqual([[BC, 1, ['override']], [K1, 2, ['override', 'placeholder']]]);
				expect(findingsOf(r, 'jan1_position_gap').filter((f) => f.detail === 'units_without_basis').map((f) => [f.wallet, f.qty])).toEqual([[K1, 1]]);
			});

			it('one that leaves a lot unplaced while a wallet lacks basis is refused', () => {
				const r = withRows([{ wallet: K1, acquiredAt: L2023, qty: 1 }]);
				expect(findingsOf(r, 'allocation_override_rejected')[0]).toMatchObject({ detail: 'units_mismatch' });
				expect(must(r.jan1[0])).toMatchObject({ source: 'reconstruction', overrideRejected: true });
			});

			it('one that gives a wallet more than it holds is refused', () => {
				const r = withRows([{ wallet: BC, acquiredAt: L2023, qty: 1 }, { wallet: BC, acquiredAt: L2024, qty: 1 }]);
				expect(findingsOf(r, 'allocation_override_rejected')[0]).toMatchObject({ detail: 'units_mismatch' });
			});

			it('one that puts both lots in one wallet is accepted when that wallet holds the units', () => {
				const r = withRows([{ wallet: K1, acquiredAt: L2023, qty: 1 }, { wallet: K1, acquiredAt: L2024, qty: 1 }]);
				expect(findingsOf(r, 'allocation_override_rejected')).toEqual([]);
				expect(must(r.jan1[0]).positions.map((p) => [p.wallet, p.units, p.lots.map((l) => l.pass)])).toEqual([[BC, 1, ['placeholder']], [K1, 2, ['override', 'override']]]);
			});
		});

		// k1 bought both lots and sent one unit on to w2 in 2024, so the reconstruction puts the older
		// lot back in k1 and the newer one in w2. The owner recorded the opposite.
		const W2 = 'ethereum:0xw2';
		const L1 = '2023-03-01T00:00:00Z';
		const L2 = '2024-01-20T00:00:00Z';
		const overrideHistory = [
			acquire('l1', 'BTC', K1, L1, 1, 25_000),
			acquire('l2', 'BTC', K1, L2, 1, 42_000),
			move('mv', 'BTC', K1, W2, '2024-06-01T00:00:00Z', '2024-06-01T01:00:00Z', 1, 1),
			dispose('sale25', 'BTC', K1, '2025-03-01T00:00:00Z', 1, 90_000),
		];

		it('the reconstruction follows the move: the older lot stays in k1, the newer one went to w2', () => {
			const r = runLotLedger(overrideHistory, PW);
			const jan1 = must(r.jan1[0], 'jan1');
			expect(jan1.positions.map((p) => [p.wallet, p.lots.map((l) => l.pass)])).toEqual([[K1, ['origin']], [W2, ['fill']]]);
			expect(r.slices[0]).toMatchObject({ lotId: 'lot:l1', cost: 25_000, gain: 65_000 });
		});

		it('a valid override replaces the reconstruction for its asset', () => {
			const r = runLotLedger(overrideHistory, {
				...PW,
				allocationOverrides: [
					{
						asset: 'BTC',
						rows: [
							{ wallet: K1, acquiredAt: L2, qty: 1, costUsd: 42_000 },
							{ wallet: W2, acquiredAt: L1, qty: 1 },
						],
					},
				],
			});
			const jan1 = must(r.jan1[0], 'jan1');
			expect(jan1).toMatchObject({ source: 'override', overrideRejected: false });
			expect(jan1.positions.map((p) => [p.wallet, p.lots.map((l) => [l.acquiredAt, l.pass])])).toEqual([[K1, [[L2, 'override']]], [W2, [[L1, 'override']]]]);
			expect(r.slices[0]).toMatchObject({ lotId: 'lot:l2', cost: 42_000, gain: 48_000, term: 'long' });
			expect(r.slices[0].originNote).toBe('Acquired 2024-01-20 (recorded cost basis). Placed in this wallet by the January 1, 2025 allocation you entered.');
			expect(r.findings).toEqual([]);
		});

		it('a sale from a lot the reconstruction placed in another wallet says so, and one from a lot left where it was bought does not', () => {
			const r = runLotLedger([...overrideHistory.slice(0, 3), dispose('fromW2', 'BTC', W2, '2025-03-01T00:00:00Z', 1, 90_000), dispose('fromK1', 'BTC', K1, '2025-03-02T00:00:00Z', 1, 90_000)], PW);
			expect(r.slices.map((x) => [x.sourceRef, x.lotId, x.originNote])).toEqual([
				['src:fromW2', 'lot:l2', 'Acquired 2024-01-20 (recorded cost basis). Placed in this wallet by the reconstructed January 1, 2025 positions.'],
				['src:fromK1', 'lot:l1', 'Acquired 2023-03-01 (recorded cost basis).'],
			]);
		});

		it.each([
			['units that do not match the balances', [{ wallet: K1, acquiredAt: L1, qty: 1 }, { wallet: K1, acquiredAt: L2, qty: 1 }], 'units_mismatch'],
			['a lot that is not left', [{ wallet: K1, acquiredAt: '2021-01-01T00:00:00Z', qty: 1 }, { wallet: W2, acquiredAt: L2, qty: 1 }], 'lot_not_unused'],
			['more of a lot than is left', [{ wallet: K1, acquiredAt: L1, qty: 1 }, { wallet: W2, acquiredAt: L1, qty: 1 }], 'lot_not_unused'],
			['a basis that is not the lot\'s own', [{ wallet: K1, acquiredAt: L1, qty: 1, costUsd: 99 }, { wallet: W2, acquiredAt: L2, qty: 1 }], 'basis_mismatch'],
			['an unreadable row', [{ wallet: K1, acquiredAt: 'not a date', qty: 1 }, { wallet: W2, acquiredAt: L2, qty: 1 }], 'invalid_rows'],
			['no rows', [], 'no_rows'],
		])('an override with %s is refused, with a finding, and the reconstruction stands', (_name, rows, detail) => {
			const r = runLotLedger(overrideHistory, { ...PW, allocationOverrides: [{ asset: 'BTC', rows }] });
			const f = must(findingsOf(r, 'allocation_override_rejected')[0], 'finding');
			expect(f).toMatchObject({ asset: 'BTC', detail });
			expect(must(r.jan1[0])).toMatchObject({ source: 'reconstruction', overrideRejected: true });
			expect(r.slices[0]).toMatchObject({ lotId: 'lot:l1' });
		});

		it('an override that reuses basis consumed before 2025 is refused', () => {
			const events = [
				acquire('l0', 'BTC', K1, '2022-02-01T00:00:00Z', 1, 40_000),
				acquire('l1', 'BTC', K1, L1, 1, 25_000),
				acquire('l2', 'BTC', K1, L2, 1, 42_000),
				dispose('sale24', 'BTC', K1, '2024-05-01T00:00:00Z', 1, 50_000),
			];
			const r = runLotLedger(events, { ...PW, allocationOverrides: [{ asset: 'BTC', rows: [{ wallet: K1, acquiredAt: '2022-02-01T00:00:00Z', qty: 2 }] }] });
			expect(findingsOf(r, 'allocation_override_rejected')[0]).toMatchObject({ detail: 'lot_not_unused' });
		});

		it('two allocations for one coin are both refused, whatever order they came in', () => {
			const good = { asset: 'BTC', rows: [{ wallet: K1, acquiredAt: L2, qty: 1 }, { wallet: W2, acquiredAt: L1, qty: 1 }] };
			const other = { asset: 'btc', rows: [{ wallet: K1, acquiredAt: L1, qty: 1 }, { wallet: W2, acquiredAt: L2, qty: 1 }] };
			for (const allocationOverrides of [[good, other], [other, good]]) {
				const r = runLotLedger(overrideHistory, { ...PW, allocationOverrides });
				expect(findingsOf(r, 'allocation_override_rejected')).toHaveLength(1);
				expect(findingsOf(r, 'allocation_override_rejected')[0]).toMatchObject({ asset: 'BTC', detail: 'duplicate_asset' });
				expect(must(r.jan1[0])).toMatchObject({ source: 'reconstruction', overrideRejected: true });
			}
		});

		it('an override for an asset the ledger has nothing of is refused', () => {
			const r = runLotLedger(overrideHistory, { ...PW, allocationOverrides: [{ asset: 'DOGE', rows: [{ wallet: K1, acquiredAt: L1, qty: 1 }] }] });
			expect(findingsOf(r, 'allocation_override_rejected')[0]).toMatchObject({ asset: 'DOGE', detail: 'unknown_asset' });
		});

		it('an override is read for the asset it names, however its symbol is spelled', () => {
			const r = runLotLedger(overrideHistory.map((e) => (e.kind === 'acquire' ? { ...e, asset: 'btc' } : e)), {
				...PW,
				allocationOverrides: [{ asset: ' btc ', rows: [{ wallet: K1, acquiredAt: L2, qty: 1 }, { wallet: W2, acquiredAt: L1, qty: 1 }] }],
			});
			expect(must(r.jan1[0]).source).toBe('override');
		});

		it('the gap-test example: A1 and A2 go to A, B1 goes to B, and the 2025 sale takes A1 (moved, long-term) then B1 (short-term)', () => {
			const A = 'cex:coinbase:acct-a';
			const B = 'bitcoin:bc1-b';
			const r = runLotLedger(
				[
					acquire('a1', 'BTC', A, '2023-01-10T00:00:00Z', 1, 20_000),
					acquire('a2', 'BTC', A, '2023-06-01T00:00:00Z', 1, 30_000),
					acquire('b1', 'BTC', B, '2024-09-01T00:00:00Z', 1, 60_000),
					move('send', 'BTC', A, B, '2025-02-01T00:00:00Z', '2025-02-01T00:30:00Z', 1, 1),
					dispose('sale', 'BTC', B, '2025-06-01T00:00:00Z', 2, 180_000),
				],
				PW,
			);
			expect(r.slices.map((s) => ({ buyDate: ymd(s.acquiredAt), costUsd: s.cost, gainLossUsd: s.gain, shortTerm: s.term === 'short' }))).toEqual([
				{ buyDate: '2023-01-10', costUsd: 20_000, gainLossUsd: 70_000, shortTerm: false },
				{ buyDate: '2024-09-01', costUsd: 60_000, gainLossUsd: 30_000, shortTerm: true },
			]);
			expect(must(r.lots.find((l) => l.id === r.slices[0].lotId)).originLotId).toBe('lot:a1');
			expect(open(r).map((l) => [l.wallet, ymd(l.acquiredAt), l.remainingCostUsd])).toEqual([[A, '2023-06-01', 30_000]]);
		});
	});
});

// ── 5. Sale on the anniversary day (UTC) ─────────────────────────────────────

describe('T5: sale on the anniversary day, by UTC calendar date', () => {
	it.each([
		['2023-01-10T15:00:00Z', '2024-01-10T20:00:00Z', 'short'],
		['2023-01-10T15:00:00Z', '2024-01-11T00:30:00Z', 'long'],
		['2023-01-10T23:30:00Z', '2024-01-11T00:10:00Z', 'long'],
		// America/Chicago would call this short-term (the sale is the evening of Jan 10 there). The decision
		// is UTC dates everywhere, so it is long-term.
		['2023-01-10T12:00:00Z', '2024-01-11T03:00:00Z', 'long'],
	] as const)('bought %s, sold %s: %s', (buy, sell, term) => {
		expect(termOf(buy, sell)).toBe(term);
		expect(termOf(buy, sell, PW)).toBe(term);
	});

	it('times stored without a zone are UTC, and a space or a T makes no difference', () => {
		expect(termOf('2023-01-10 15:00:00', '2024-01-10 20:00:00')).toBe('short');
		expect(termOf('2023-01-10 15:00:00', '2024-01-11 00:30:00')).toBe('long');
		expect(termOf('2023-01-10T15:00:00', '2024-01-11T00:30:00')).toBe('long');
	});
});

// ── 6. Leap-year spans ───────────────────────────────────────────────────────

describe('T6: leap-year spans', () => {
	it.each([
		['2024-01-01', '2025-01-01', 'short'], // 366 days, but only one year
		['2024-01-01', '2025-01-02', 'long'],
		['2024-02-29', '2025-02-28', 'short'],
		['2024-02-29', '2025-03-01', 'long'],
		['2023-03-01', '2024-02-29', 'short'],
		['2023-03-01', '2024-03-01', 'short'],
		['2023-03-01', '2024-03-02', 'long'],
	] as const)('bought %s, sold %s: %s', (buy, sell, term) => {
		expect(termOf(`${buy}T00:00:00Z`, `${sell}T00:00:00Z`)).toBe(term);
	});
});

// ── 7. Partial disposals ─────────────────────────────────────────────────────

describe('T7: partial disposals', () => {
	const W = 'W';
	const lots = [acquire('a', 'ETH', W, '2023-01-01T00:00:00Z', 1, 10_000), acquire('b', 'ETH', W, '2024-01-01T00:00:00Z', 1, 20_000)];

	it('selling 1.5 takes the first lot whole and half of the second; the rest keeps its share of the cost', () => {
		const r = runLotLedger([...lots, dispose('s1', 'ETH', W, '2025-06-01T00:00:00Z', 1.5, 45_000)], PW);
		expect(r.slices).toHaveLength(2);
		expect(r.slices[0]).toMatchObject({ qty: 1, cost: 10_000 });
		expect(r.slices[0].proceeds).toBeCloseTo(30_000, 8);
		expect(r.slices[1]).toMatchObject({ qty: 0.5, cost: 10_000 });
		expect(r.slices[1].proceeds).toBeCloseTo(15_000, 8);
		expect(open(r).map((l) => [l.remainingQty, l.remainingCostUsd])).toEqual([[0.5, 10_000]]);
	});

	it('then selling 1.0 leaves one slice of 0.5 and an unmatched 0.5, and the quantities and proceeds add up', () => {
		const events = [...lots, dispose('s1', 'ETH', W, '2025-06-01T00:00:00Z', 1.5, 45_000), dispose('s2', 'ETH', W, '2025-07-01T00:00:00Z', 1, 20_000)];
		const r = runLotLedger(events, PW);
		const s2 = r.slices.filter((s) => s.sourceRef === 'src:s2');
		expect(s2).toHaveLength(1);
		expect(s2[0]).toMatchObject({ qty: 0.5, cost: 10_000 });
		expect(s2[0].proceeds).toBeCloseTo(10_000, 8);
		const um = r.unmatched.filter((u) => u.sourceRef === 'src:s2');
		expect(um).toHaveLength(1);
		expect(um[0]).toMatchObject({ qty: 0.5, wallet: W, taxable: true, placeholderQty: 0 });
		expect(um[0].proceeds).toBeCloseTo(10_000, 8);
		// Conservation: slice quantity plus unmatched quantity is the disposal quantity, and the proceeds are all accounted for.
		for (const [ref, qty, proceeds] of [['src:s1', 1.5, 45_000], ['src:s2', 1, 20_000]] as const) {
			expect(sum(r.slices.filter((s) => s.sourceRef === ref).map((s) => s.qty)) + sum(r.unmatched.filter((u) => u.sourceRef === ref).map((u) => u.qty))).toBeCloseTo(qty, 10);
			expect(sum(r.slices.filter((s) => s.sourceRef === ref).map((s) => s.proceeds)) + sum(r.unmatched.filter((u) => u.sourceRef === ref).map((u) => u.proceeds))).toBeCloseTo(proceeds, 8);
		}
		expect(open(r)).toEqual([]);
	});

	it('lots of 0.1 and 0.2 sold as 0.3 leave no dust lot and no dust slice', () => {
		const r = runLotLedger(
			[acquire('a', 'ETH', W, '2025-01-10T00:00:00Z', 0.1, 10), acquire('b', 'ETH', W, '2025-01-11T00:00:00Z', 0.2, 20), dispose('s', 'ETH', W, '2025-02-01T00:00:00Z', 0.3, 33)],
			PW,
		);
		expect(r.slices.map((s) => s.qty)).toEqual([0.1, 0.2]);
		expect(r.unmatched).toEqual([]);
		expect(r.lots.map((l) => l.remainingQty)).toEqual([0, 0]);
		expect(sum(r.slices.map((s) => s.cost))).toBeCloseTo(30, 10);
		expect(sum(r.slices.map((s) => s.proceeds))).toBeCloseTo(33, 10);
	});

	it('a sale that leaves less than 1e-10 of a lot takes the lot whole', () => {
		const r = runLotLedger([acquire('a', 'ETH', W, '2025-01-10T00:00:00Z', 1, 100), dispose('s', 'ETH', W, '2025-02-01T00:00:00Z', 1 - 5e-11, 100)], PW);
		expect(r.slices).toHaveLength(1);
		expect(r.slices[0].qty).toBe(1);
		expect(r.slices[0].cost).toBe(100);
		expect(r.lots[0].remainingQty).toBe(0);
	});

	it('dust events are ignored: no lot, no slice, no unmatched row, no finding', () => {
		const r = runLotLedger([acquire('a', 'ETH', W, '2025-01-10T00:00:00Z', 1e-11, 1), dispose('s', 'ETH', W, '2025-02-01T00:00:00Z', 5e-11, 1)], PW);
		expect(r).toMatchObject({ lots: [], slices: [], unmatched: [], findings: [] });
	});
});

// ── 8. Transfer loss that is only a fee ──────────────────────────────────────

describe('T8: transfer loss that is only a fee', () => {
	const A = 'A';
	const B = 'B';
	const buy = acquire('e', 'ETH', A, '2024-05-01T00:00:00Z', 1, 2000);

	it('B gets 0.998 dated 2024-05-01 at 1,996; the 0.002 and its 4 are a finding, not a sale', () => {
		const r = runLotLedger([buy, move('mv', 'ETH', A, B, '2025-03-01T00:00:00Z', '2025-03-01T00:05:00Z', 1, 0.998)], PW);
		const landed = must(open(r)[0], 'open lot');
		expect(open(r)).toHaveLength(1);
		expect(landed).toMatchObject({ wallet: B, acquiredAt: '2024-05-01T00:00:00Z', remainingQty: 0.998, remainingCostUsd: 1996, originLotId: 'lot:e' });
		expect(r.slices).toEqual([]);
		expect(r.unmatched).toEqual([]);
		const f = must(findingsOf(r, 'transfer_fee_units')[0], 'fee finding');
		expect(f).toMatchObject({ asset: 'ETH', wallet: A, toWallet: B, qty: 0.002, costUsd: 4, acquiredAt: '2024-05-01T00:00:00Z', detail: 'carved_from_lots' });
		// Totals unchanged: what is held plus what the fee took is what was bought.
		expect(sum(open(r).map((l) => l.remainingQty)) + 0.002).toBeCloseTo(1, 12);
		expect(sum(open(r).map((l) => l.remainingCostUsd)) + 4).toBeCloseTo(2000, 10);
	});

	it('a 2024 variant raises the same finding before the boundary, as an estimate, and moves no lot', () => {
		const r = runLotLedger([buy, move('mv', 'ETH', A, B, '2024-08-01T00:00:00Z', '2024-08-01T00:05:00Z', 1, 0.998)], { ...PW, snapshotsAt: ['2024-12-31T23:59:59.999Z'] });
		expect(r.slices).toEqual([]);
		expect(findingsOf(r, 'transfer_fee_units')[0]).toMatchObject({ qty: 0.002, costUsd: 4, wallet: A, detail: 'universal_estimate', acquiredAt: '2024-05-01T00:00:00Z' });
		// The pooled lot is untouched at the end of 2024 (still the whole 1.0 at 2,000)...
		expect(sum(must(r.snapshots[0]).lots.map((l) => l.qty))).toBe(1);
		// ...and January 1 reports the 0.002 of basis the wallets no longer hold units for.
		const gap = findingsOf(r, 'jan1_position_gap').filter((g) => g.detail === 'basis_without_units');
		expect(gap).toHaveLength(1);
		expect(gap[0]).toMatchObject({ wallet: UNALLOCATED_WALLET, qty: 0.002 });
		expect(gap[0].costUsd).toBeCloseTo(4, 10);
	});

	it('an arrival of 1.001 raises a mismatch, with 0.001 at missing basis', () => {
		const r = runLotLedger([buy, move('mv', 'ETH', A, B, '2025-03-01T00:00:00Z', '2025-03-01T00:05:00Z', 1, 1.001)], PW);
		expect(findingsOf(r, 'transfer_amount_mismatch')[0]).toMatchObject({ qty: 0.001, asset: 'ETH', wallet: A, toWallet: B });
		const extra = must(r.lots.find((l) => l.origin === 'transfer_surplus'), 'surplus lot');
		expect(extra).toMatchObject({ wallet: B, remainingQty: 0.001, remainingCostUsd: null, basisSource: 'missing', acquiredAt: '2025-03-01T00:05:00Z' });
		expect(open(r).map((l) => [l.wallet, l.remainingQty])).toEqual([[B, 1], [B, 0.001]]);
	});

	it('before the boundary a surplus is reported and adds no lot; January 1 then holds the units as a placeholder', () => {
		const r = runLotLedger([buy, move('mv', 'ETH', A, B, '2024-08-01T00:00:00Z', '2024-08-01T00:05:00Z', 1, 1.001)], PW);
		expect(findingsOf(r, 'transfer_amount_mismatch')).toHaveLength(1);
		expect(r.lots.some((l) => l.origin === 'transfer_surplus')).toBe(false);
		const placeholder = must(r.lots.find((l) => l.origin === 'jan1_placeholder'), 'placeholder');
		expect(placeholder).toMatchObject({ wallet: B, remainingQty: 0.001, basisSource: 'missing' });
	});

	it('a shortfall smaller than dust is not a fee', () => {
		const r = runLotLedger([buy, move('mv', 'ETH', A, B, '2025-03-01T00:00:00Z', '2025-03-01T00:05:00Z', 1, 1 - 5e-11)], PW);
		expect(findingsOf(r, 'transfer_fee_units')).toEqual([]);
		expect(open(r).map((l) => l.remainingQty)).toEqual([1]);
	});

	it('the fee is carved from the last slices, so the oldest units still arrive', () => {
		const r = runLotLedger(
			[
				acquire('old', 'ETH', A, '2024-01-01T00:00:00Z', 0.5, 1000),
				acquire('new', 'ETH', A, '2024-06-01T00:00:00Z', 0.5, 1500),
				move('mv', 'ETH', A, B, '2025-03-01T00:00:00Z', '2025-03-01T00:05:00Z', 1, 0.7),
			],
			PW,
		);
		expect(open(r).map((l) => [l.acquiredAt, l.remainingQty, l.remainingCostUsd])).toEqual([
			['2024-01-01T00:00:00Z', 0.5, 1000],
			['2024-06-01T00:00:00Z', 0.2, 600],
		]);
		const f = findingsOf(r, 'transfer_fee_units')[0];
		expect(f).toMatchObject({ qty: 0.3, costUsd: 900, acquiredAt: '2024-06-01T00:00:00Z' });
	});

	it('a fee larger than the newest slice carves into the one before it', () => {
		const r = runLotLedger(
			[
				acquire('old', 'ETH', A, '2024-01-01T00:00:00Z', 0.5, 1000),
				acquire('new', 'ETH', A, '2024-06-01T00:00:00Z', 0.5, 1500),
				move('mv', 'ETH', A, B, '2025-03-01T00:00:00Z', '2025-03-01T00:05:00Z', 1, 0.3),
			],
			PW,
		);
		expect(open(r).map((l) => [l.acquiredAt, l.remainingQty, l.remainingCostUsd])).toEqual([['2024-01-01T00:00:00Z', 0.3, 600]]);
		expect(findingsOf(r, 'transfer_fee_units')[0]).toMatchObject({ qty: 0.7, costUsd: 1900 });
	});
});

// ── 9. Priced transfer-in from an untracked source, labeled estimated ────────

describe('T9: a priced transfer-in from an untracked source is labeled estimated', () => {
	const K1 = 'cex:kraken:k1';
	const deposit = (cost: number | null) => acquire('dep', 'BTC', K1, '2025-02-01T00:00:00Z', 1, cost, 'transfer_in_untracked');
	const sale = dispose('sale', 'BTC', K1, '2025-06-01T00:00:00Z', 1, 120_000);

	it('opens an estimated lot dated the arrival, with a finding, and the later sale carries the label', () => {
		const r = runLotLedger([deposit(100_000), sale], PW);
		const lot = must(r.lots[0], 'lot');
		expect(lot).toMatchObject({ acquiredAt: '2025-02-01T00:00:00Z', costUsd: 100_000, basisSource: 'estimated', origin: 'transfer_in_untracked' });
		expect(findingsOf(r, 'estimated_transfer_basis')).toEqual([
			{ reason: 'estimated_transfer_basis', asset: 'BTC', wallet: K1, toWallet: null, at: '2025-02-01T00:00:00Z', qty: 1, costUsd: 100_000, valueUsd: 100_000, acquiredAt: null, refs: ['src:dep'], detail: null },
		]);
		expect(r.slices[0]).toMatchObject({ basisSource: 'estimated', cost: 100_000, gain: 20_000, term: 'short' });
		expect(r.slices[0].originNote).toMatch(/does not track/);
		expect(r.slices[0].originNote).toMatch(/estimated/);
	});

	it('unpriced: missing basis, and no estimated finding', () => {
		const r = runLotLedger([deposit(null), sale], PW);
		expect(r.lots[0]).toMatchObject({ basisSource: 'missing', costUsd: null, origin: 'transfer_in_untracked' });
		expect(findingsOf(r, 'estimated_transfer_basis')).toEqual([]);
		expect(r.slices[0]).toMatchObject({ basisSource: 'missing', cost: null, gain: null, proceeds: 120_000 });
	});

	it('an ordinary purchase with a cost is recorded, not estimated', () => {
		expect(runLotLedger([acquire('buy', 'BTC', K1, '2025-02-01T00:00:00Z', 1, 100_000)], PW).lots[0].basisSource).toBe('recorded');
	});
});

// ── 10. Transfer-in from a tracked source is not duplicated ──────────────────

describe('T10: a transfer-in from a tracked source is not duplicated', () => {
	const CB = 'cex:coinbase:acct-1';
	const KR = 'cex:kraken:k1';

	const buy = acquire('buy', 'BTC', CB, '2023-01-10T00:00:00Z', 1, 20_000);
	const sendRow = (extra: Partial<TransferRow> = {}): TransferRow => ({ id: 'cb-send', direction: 'out', asset: 'BTC', qty: 1, at: '2025-02-01T00:00:00Z', wallet: CB, source: 'import', category: 'transfer', ...extra });
	const depositRow = (extra: Partial<TransferRow> = {}): TransferRow => ({ id: 'kr-dep', direction: 'in', asset: 'BTC', qty: 1, at: '2025-02-01T00:45:00Z', wallet: KR, source: 'import', category: 'transfer', ...extra });

	/** What an adapter does with the resolver's answer: a link becomes a move, a lone out an unmatched send, a lone priced in an untracked arrival. */
	function ledgerFor(rows: TransferRow[], matches: TransferMatchRow[] = []): LedgerResult {
		const { links, unlinkedOut, unlinkedIn } = resolveTransferLinks(rows, new Set(), matches, { byKey: new Map(), byAddress: new Map() });
		const row = (id: string) => must(rows.find((r) => r.id === id), id);
		const events: LedgerEvent[] = [buy];
		for (const l of links) events.push(move(`${l.outId}>${l.inId}`, l.asset, l.outWallet, l.inWallet, l.outAt, l.inAt, l.qtyOut, l.qtyIn, { link: l.link, ownersDiffer: l.ownersDiffer }));
		for (const id of unlinkedOut) events.push(sendUnmatched(id, 'BTC', row(id).wallet, row(id).at, row(id).qty, 100_000));
		for (const id of unlinkedIn) events.push(acquire(id, 'BTC', row(id).wallet, row(id).at, row(id).qty, 100_000, 'transfer_in_untracked'));
		return runLotLedger(events, PW);
	}

	it('a heuristic link leaves exactly one open lot, in Kraken, dated 2023-01-10 at 20,000, and asks for review', () => {
		const r = ledgerFor([sendRow(), depositRow()]);
		expect(open(r)).toHaveLength(1);
		expect(open(r)[0]).toMatchObject({ wallet: KR, acquiredAt: '2023-01-10T00:00:00Z', remainingCostUsd: 20_000, basisSource: 'recorded' });
		expect(findingsOf(r, 'estimated_transfer_basis')).toEqual([]);
		expect(reasons(r)).toEqual(['transfer_link_unconfirmed']);
		expect(r.slices).toEqual([]);
	});

	it('a hash-linked pair raises no unconfirmed finding', () => {
		const hash = '0x' + 'ab'.repeat(32);
		const r = ledgerFor([sendRow({ hash }), depositRow({ hash: hash.toUpperCase().replace('0X', '0x') })]);
		expect(open(r)).toHaveLength(1);
		expect(r.findings).toEqual([]);
	});

	it('a rejected transfer_matches row: the send becomes an unmatched transfer and the deposit an estimated lot', () => {
		const r = ledgerFor([sendRow(), depositRow()], [{ outId: 'cb-send', inId: 'kr-dep', status: 'rejected' }]);
		expect(reasons(r).sort()).toEqual(['estimated_transfer_basis', 'unmatched_transfer']);
		expect(findingsOf(r, 'unmatched_transfer')[0]).toMatchObject({ qty: 1, costUsd: 20_000, valueUsd: 100_000, wallet: CB, acquiredAt: '2023-01-10T00:00:00Z' });
		// The Coinbase coins are consumed, not sold.
		expect(r.slices).toHaveLength(1);
		expect(r.slices[0]).toMatchObject({ taxable: false, category: 'unmatched_transfer', cost: 20_000 });
		expect(taxable(r)).toEqual([]);
		expect(open(r).map((l) => [l.wallet, l.basisSource, l.remainingCostUsd])).toEqual([[KR, 'estimated', 100_000]]);
	});
});

// ── Order of events ──────────────────────────────────────────────────────────

describe('order of events', () => {
	it('equal times sort acquire, then move, then dispose, whatever the sourceRefs say', () => {
		const T = '2025-03-01T00:00:00Z';
		// All at one instant: bought in W1, moved to W2, sold from W2. The sourceRefs sort the other way.
		const events: LedgerEvent[] = [
			{ ...(dispose('z', 'BTC', 'W2', T, 1, 150) as Extract<LedgerEvent, { kind: 'dispose' }>), sourceRef: 'a-sale' },
			{ ...(move('y', 'BTC', 'W1', 'W2', T, T, 1, 1) as Extract<LedgerEvent, { kind: 'move' }>), outRef: 'm-out', inRef: 'm-in' },
			{ ...(acquire('x', 'BTC', 'W1', T, 1, 100) as Extract<LedgerEvent, { kind: 'acquire' }>), sourceRef: 'z-buy' },
		];
		const r = runLotLedger(events, PW);
		expect(r.unmatched).toEqual([]);
		expect(r.slices).toHaveLength(1);
		expect(r.slices[0]).toMatchObject({ wallet: 'W2', cost: 100, gain: 50, lotId: 'lot:x>y' });
	});

	it('equal times and kinds sort by sourceRef: the first sourceRef takes the older lot', () => {
		const lots = [acquire('a', 'BTC', 'W', '2024-01-01T00:00:00Z', 1, 100), acquire('b', 'BTC', 'W', '2024-02-01T00:00:00Z', 1, 200)];
		const T = '2025-03-01T00:00:00Z';
		const sales = [dispose('d1', 'BTC', 'W', T, 1, 500), dispose('d2', 'BTC', 'W', T, 1, 500)].map((e, i) => ({ ...e, sourceRef: i === 0 ? 'ref-b' : 'ref-a' }) as LedgerEvent);
		const r = runLotLedger([...sales, ...lots], PW);
		expect(r.slices.map((s) => [s.sourceRef, s.cost])).toEqual([['ref-a', 100], ['ref-b', 200]]);
	});

	it('times are compared as instants, not as text: a T-form and a space-form of the same day sort correctly', () => {
		// As text "2024-03-05 12:00:00" sorts before "2024-03-05T10:00:00Z" ('space' is below 'T'); as instants it is two hours later.
		const r = runLotLedger(
			[
				acquire('late', 'BTC', 'W', '2024-03-05 12:00:00', 1, 200),
				acquire('early', 'BTC', 'W', '2024-03-05T10:00:00Z', 1, 100),
				dispose('s', 'BTC', 'W', '2025-06-01T00:00:00Z', 1, 500),
			],
			PW,
		);
		expect(r.slices[0]).toMatchObject({ lotId: 'lot:early', cost: 100 });
	});

	it('a sale never takes a lot acquired after it', () => {
		const r = runLotLedger([dispose('s', 'BTC', 'W', '2025-03-01T00:00:00Z', 1, 500), acquire('late', 'BTC', 'W', '2025-04-01T00:00:00Z', 1, 100)], PW);
		expect(r.slices).toEqual([]);
		expect(r.unmatched).toHaveLength(1);
		expect(open(r)).toHaveLength(1);
	});

	it('the order the events are passed in never changes the result', () => {
		const events = [
			acquire('a', 'BTC', 'W1', '2024-01-01T00:00:00Z', 2, 200),
			acquire('b', 'BTC', 'W2', '2024-02-01T00:00:00Z', 1, 150),
			move('m', 'BTC', 'W1', 'W2', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 1, 0.999),
			dispose('d', 'BTC', 'W2', '2025-03-01T00:00:00Z', 1.5, 400),
		];
		const forward = JSON.stringify(runLotLedger(events, PW));
		expect(JSON.stringify(runLotLedger([...events].reverse(), PW))).toBe(forward);
		expect(JSON.stringify(runLotLedger([events[2], events[0], events[3], events[1]], PW))).toBe(forward);
	});
});

// ── Pools: universal before the boundary, per wallet after, 'unresolved' ─────

describe('pools', () => {
	it("with no perWalletFrom (a tenant outside the US) every year is one pool: a sale takes the oldest lot in any wallet", () => {
		const events = [
			acquire('w1', 'ETH', 'W1', '2025-01-15T00:00:00Z', 1, 2000),
			acquire('w2', 'ETH', 'W2', '2025-02-01T00:00:00Z', 1, 3000),
			dispose('sale', 'ETH', 'W2', '2026-03-01T00:00:00Z', 1, 4000),
		];
		expect(runLotLedger(events, { perWalletFrom: null }).slices[0]).toMatchObject({ lotId: 'lot:w1', cost: 2000, wallet: 'W2' });
		expect(runLotLedger(events).slices[0]).toMatchObject({ lotId: 'lot:w1' });
		expect(runLotLedger(events, PW).slices[0]).toMatchObject({ lotId: 'lot:w2', cost: 3000 });
	});

	it('a move changes no lot with one pool, and so never changes a gain', () => {
		const lots = [acquire('a', 'ETH', 'W1', '2024-01-15T00:00:00Z', 1, 2000), acquire('b', 'ETH', 'W2', '2024-02-01T00:00:00Z', 1, 3000)];
		const sale = dispose('s', 'ETH', 'W2', '2026-03-01T00:00:00Z', 1, 4000);
		const withMove = runLotLedger([...lots, move('m', 'ETH', 'W1', 'W2', '2025-01-10T00:00:00Z', '2025-01-10T01:00:00Z', 1, 1), sale], { perWalletFrom: null });
		const without = runLotLedger([...lots, sale], { perWalletFrom: null });
		expect(withMove.slices).toEqual(without.slices);
		expect(withMove.lots.map((l) => [l.id, l.wallet, l.remainingQty])).toEqual(without.lots.map((l) => [l.id, l.wallet, l.remainingQty]));
	});

	it("events with no wallet form one pool per asset, however the blank is spelled", () => {
		const r = runLotLedger(
			[
				{ ...(acquire('a', 'ETH', '', '2024-01-01T00:00:00Z', 1, 100) as Extract<LedgerEvent, { kind: 'acquire' }>), wallet: undefined as unknown as string },
				acquire('b', 'ETH', '   ', '2024-02-01T00:00:00Z', 1, 200),
				acquire('c', 'ETH', 'unresolved', '2024-03-01T00:00:00Z', 1, 300),
				{ ...(dispose('s', 'ETH', 'x', '2025-06-01T00:00:00Z', 3, 900) as Extract<LedgerEvent, { kind: 'dispose' }>), wallet: null as unknown as string },
			],
			PW,
		);
		expect(r.unmatched).toEqual([]);
		expect(r.slices.map((s) => [s.wallet, s.cost])).toEqual([['unresolved', 100], ['unresolved', 200], ['unresolved', 300]]);
		expect(new Set(r.lots.map((l) => l.wallet))).toEqual(new Set(['unresolved']));
	});

	it('symbols are compared as normalized assets: MATIC and POL are one asset', () => {
		const r = runLotLedger([acquire('a', 'matic', 'W', '2024-01-01T00:00:00Z', 5, 50), dispose('s', 'POL', 'W', '2025-06-01T00:00:00Z', 5, 60)], PW);
		expect(r.slices[0]).toMatchObject({ asset: 'POL', qty: 5, cost: 50 });
		expect(r.unmatched).toEqual([]);
	});

	it('lots of different assets never mix', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'W', '2024-01-01T00:00:00Z', 1, 100), dispose('s', 'ETH', 'W', '2025-06-01T00:00:00Z', 1, 60)], PW);
		expect(r.slices).toEqual([]);
		expect(r.unmatched[0]).toMatchObject({ asset: 'ETH', qty: 1 });
	});

	it('the boundary happens even when no event reaches it, and snapshots on either side see the right pools', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'W', '2024-01-01T00:00:00Z', 1, 100)], { ...PW, snapshotsAt: ['2024-12-31T23:59:59.999Z', '2025-01-01T00:00:00.000Z'] });
		expect(r.jan1).toHaveLength(1);
		expect(r.jan1[0].positions).toMatchObject([{ wallet: 'W', units: 1 }]);
		expect(r.snapshots.map((s) => s.lots.map((l) => [l.wallet, l.qty]))).toEqual([[['W', 1]], [['W', 1]]]);
	});

	it('a reconstruction never needs a clock: the same events give the same result on every run', () => {
		const events = [acquire('a', 'BTC', 'W1', '2024-01-01T00:00:00Z', 1, 100), dispose('s', 'BTC', 'W1', '2025-06-01T00:00:00Z', 1, 200)];
		expect(JSON.stringify(runLotLedger(events, PW))).toBe(JSON.stringify(runLotLedger(events, PW)));
	});
});

// ── Moves ────────────────────────────────────────────────────────────────────

describe('moves', () => {
	it('a move takes the source wallet oldest lots first, whatever the cost-basis method', () => {
		const events = [
			acquire('old', 'BTC', 'A', '2024-01-01T00:00:00Z', 1, 100),
			acquire('new', 'BTC', 'A', '2024-06-01T00:00:00Z', 1, 900),
			move('mv', 'BTC', 'A', 'B', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 1, 1),
		];
		const r = runLotLedger(events, { ...PW, method: 'hifo' });
		expect(open(r).map((l) => [l.wallet, l.acquiredAt, l.remainingCostUsd])).toEqual([
			['B', '2024-01-01T00:00:00Z', 100],
			['A', '2024-06-01T00:00:00Z', 900],
		]);
	});

	it('between the two phases the units are in transit, and the totals hold at every snapshot', () => {
		const r = runLotLedger(
			[acquire('a', 'BTC', 'A', '2025-01-10T00:00:00Z', 2, 200), move('mv', 'BTC', 'A', 'B', '2025-03-01T12:00:00Z', '2025-03-01T14:00:00Z', 1, 1)],
			{ ...PW, snapshotsAt: ['2025-03-01T11:00:00Z', '2025-03-01T13:00:00Z', '2025-03-01T15:00:00Z'] },
		);
		const shape = (i: number) => must(r.snapshots[i]).lots.map((l) => [l.wallet, l.qty, l.costUsd]);
		expect(shape(0)).toEqual([['A', 2, 200]]);
		expect(shape(1)).toEqual([['A', 1, 100], [TRANSIT_WALLET, 1, 100]]);
		expect(shape(2)).toEqual([['A', 1, 100], ['B', 1, 100]]);
		for (const s of r.snapshots) expect(sum(s.lots.map((l) => l.qty))).toBe(2);
		// The lot in transit is the lot that lands.
		expect(must(r.snapshots[1]).lots.find((l) => l.wallet === TRANSIT_WALLET)?.lotId).toBe(must(r.snapshots[2]).lots.find((l) => l.wallet === 'B')?.lotId);
	});

	it('an arrival stamped before the departure lands at the departure', () => {
		const r = runLotLedger(
			[acquire('a', 'BTC', 'A', '2025-01-10T00:00:00Z', 1, 100), move('mv', 'BTC', 'A', 'B', '2025-03-01T12:00:00Z', '2025-03-01T11:00:00Z', 1, 1), dispose('s', 'BTC', 'B', '2025-03-01T12:00:00Z', 1, 150)],
			PW,
		);
		expect(r.unmatched).toEqual([]);
		expect(r.slices[0]).toMatchObject({ wallet: 'B', cost: 100 });
	});

	it('a move across the boundary: units in flight at the end of 2024 count for the destination on January 1', () => {
		const events = [
			acquire('a', 'BTC', 'A', '2024-06-01T00:00:00Z', 1, 10_000),
			move('mv', 'BTC', 'A', 'B', '2024-12-31T23:30:00Z', '2025-01-01T00:20:00Z', 1, 1),
			dispose('s', 'BTC', 'B', '2025-02-01T00:00:00Z', 1, 15_000),
		];
		const r = runLotLedger(events, { ...PW, snapshotsAt: ['2025-01-01T00:10:00Z'] });
		expect(r.findings).toEqual([]);
		expect(r.unmatched).toEqual([]);
		expect(r.slices[0]).toMatchObject({ wallet: 'B', cost: 10_000, gain: 5000, term: 'short', lotId: 'lot:a' });
		expect(must(r.jan1[0]).positions.map((p) => [p.wallet, p.units])).toEqual([['B', 1]]);
		expect(must(r.snapshots[0]).lots.map((l) => [l.wallet, l.qty])).toEqual([['B', 1]]);
		expect(open(r)).toEqual([]);
	});

	it('a fee on a move across the boundary is reported once, and its basis stays unallocated', () => {
		const r = runLotLedger(
			[acquire('a', 'BTC', 'A', '2024-06-01T00:00:00Z', 1, 10_000), move('mv', 'BTC', 'A', 'B', '2024-12-31T23:30:00Z', '2025-01-01T00:20:00Z', 1, 0.998)],
			PW,
		);
		expect(findingsOf(r, 'transfer_fee_units')).toHaveLength(1);
		expect(findingsOf(r, 'jan1_position_gap').map((f) => [f.wallet, f.qty, f.detail])).toEqual([[UNALLOCATED_WALLET, 0.002, 'basis_without_units']]);
		expect(open(r).map((l) => [l.wallet, l.remainingQty])).toEqual([['B', 0.998], [UNALLOCATED_WALLET, 0.002]]);
		expect(sum(open(r).map((l) => l.remainingCostUsd))).toBeCloseTo(10_000, 8);
	});

	it('units the source had no lots for arrive with missing basis, dated the arrival, and the shortfall is a finding', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'A', '2025-01-10T00:00:00Z', 0.6, 600), move('mv', 'BTC', 'A', 'B', '2025-03-01T00:00:00Z', '2025-03-01T00:30:00Z', 1, 0.998)], PW);
		expect(findingsOf(r, 'transfer_source_shortfall')[0]).toMatchObject({ qty: 0.4, wallet: 'A', toWallet: 'B' });
		// The fee came out of the units nothing backed, so it costs no basis.
		expect(findingsOf(r, 'transfer_fee_units')).toEqual([]);
		expect(open(r).map((l) => [l.wallet, l.remainingQty, l.remainingCostUsd, l.basisSource, l.origin])).toEqual([
			['B', 0.6, 600, 'recorded', 'purchase'],
			['B', 0.398, null, 'missing', 'transfer_in_untracked'],
		]);
		expect(open(r)[1].acquiredAt).toBe('2025-03-01T00:30:00Z');
	});

	it('a fee larger than the unbacked part takes the rest from the slices', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'A', '2025-01-10T00:00:00Z', 0.999, 999), move('mv', 'BTC', 'A', 'B', '2025-03-01T00:00:00Z', '2025-03-01T00:30:00Z', 1, 0.997)], PW);
		expect(findingsOf(r, 'transfer_source_shortfall')[0]).toMatchObject({ qty: 0.001 });
		expect(findingsOf(r, 'transfer_fee_units')[0]).toMatchObject({ qty: 0.002, costUsd: 2 });
		expect(open(r).map((l) => [l.remainingQty, l.basisSource])).toEqual([[0.997, 'recorded']]);
	});

	it('two hops at one instant: the second leaves before the first lands, so its units arrive without a lot and a shortfall is raised', () => {
		const T = '2025-03-01T00:00:00Z';
		const r = runLotLedger([acquire('a', 'BTC', 'A', '2025-01-10T00:00:00Z', 1, 100), move('m1', 'BTC', 'A', 'B', T, T, 1, 1), move('m2', 'BTC', 'B', 'C', T, T, 1, 1)], PW);
		expect(findingsOf(r, 'transfer_source_shortfall').map((f) => [f.wallet, f.qty])).toEqual([['B', 1]]);
		expect(open(r).map((l) => [l.wallet, l.basisSource])).toEqual([['B', 'recorded'], ['C', 'missing']]);
		// An hour apart, the same two hops chain cleanly.
		const spaced = runLotLedger([acquire('a', 'BTC', 'A', '2025-01-10T00:00:00Z', 1, 100), move('m1', 'BTC', 'A', 'B', T, T, 1, 1), move('m2', 'BTC', 'B', 'C', '2025-03-01T01:00:00Z', '2025-03-01T01:00:00Z', 1, 1)], PW);
		expect(spaced.findings).toEqual([]);
		expect(open(spaced).map((l) => [l.wallet, l.basisSource, l.remainingCostUsd])).toEqual([['C', 'recorded', 100]]);
	});

	it('a move out of a wallet that holds nothing lands everything with missing basis', () => {
		const r = runLotLedger([move('mv', 'BTC', 'A', 'B', '2025-03-01T00:00:00Z', '2025-03-01T00:30:00Z', 1, 1)], PW);
		expect(findingsOf(r, 'transfer_source_shortfall')[0]).toMatchObject({ qty: 1 });
		expect(open(r).map((l) => [l.wallet, l.remainingQty, l.basisSource])).toEqual([['B', 1, 'missing']]);
	});

	it('a move into the same wallet keeps the lots (as new records) and still reports a fee', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'W', '2024-06-01T00:00:00Z', 1, 100), move('mv', 'BTC', 'W', 'W', '2025-03-01T00:00:00Z', '2025-03-01T00:30:00Z', 1, 0.999)], PW);
		expect(open(r).map((l) => [l.wallet, l.acquiredAt, l.remainingQty, l.remainingCostUsd])).toEqual([['W', '2024-06-01T00:00:00Z', 0.999, 99.9]]);
		expect(findingsOf(r, 'transfer_fee_units')).toHaveLength(1);
	});

	it('lots keep their lineage through several moves', () => {
		const r = runLotLedger(
			[
				acquire('a', 'BTC', 'A', '2024-06-01T00:00:00Z', 1, 100),
				move('m1', 'BTC', 'A', 'B', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 1, 1),
				move('m2', 'BTC', 'B', 'C', '2025-03-01T00:00:00Z', '2025-03-01T01:00:00Z', 1, 1),
			],
			PW,
		);
		const last = must(open(r)[0]);
		expect([last.id, last.wallet, last.acquiredAt, last.remainingCostUsd]).toEqual(['lot:a>m1>m2', 'C', '2024-06-01T00:00:00Z', 100]);
		expect(last.originLotId).toBe('lot:a>m1');
		expect(must(r.lots.find((l) => l.id === 'lot:a>m1')).originLotId).toBe('lot:a');
	});

	it('a move cuts only the units it carries: the rest of the lot stays', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'A', '2024-06-01T00:00:00Z', 2, 200), move('mv', 'BTC', 'A', 'B', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 0.5, 0.5)], PW);
		expect(open(r).map((l) => [l.id, l.wallet, l.remainingQty, l.remainingCostUsd])).toEqual([
			['lot:a', 'A', 1.5, 150],
			['lot:a>mv', 'B', 0.5, 50],
		]);
	});

	it('an entered basis on a move is ignored and flagged: a move has nothing to book', () => {
		const r = runLotLedger(
			[acquire('a', 'USDC', 'A', '2024-06-01T00:00:00Z', 100, 100), move('mv', 'USDC', 'A', 'B', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 100, 100, { manualBasis: { pricePerToken: 1, buyDateIso: '2024-06-01T00:00:00Z' } })],
			PW,
		);
		expect(reasons(r)).toEqual(['manual_basis_on_transfer']);
		expect(r.slices).toEqual([]);
		expect(open(r).map((l) => [l.wallet, l.remainingQty])).toEqual([['B', 100]]);
	});

	it('a link kind of hash or confirmed asks for no review; only a guess does', () => {
		const run = (link: MoveLink) =>
			reasons(runLotLedger([acquire('a', 'BTC', 'A', '2024-06-01T00:00:00Z', 1, 100), move('mv', 'BTC', 'A', 'B', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 1, 1, { link })], PW));
		expect(run('hash')).toEqual([]);
		expect(run('confirmed')).toEqual([]);
		expect(run('heuristic')).toEqual(['transfer_link_unconfirmed']);
	});

	it('the findings of a move name the coin, both wallets, both rows and the time it left', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'A', '2024-06-01T00:00:00Z', 1, 100), move('mv', 'BTC', 'A', 'B', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 1, 1, { link: 'heuristic', ownersDiffer: true })], PW);
		expect(r.findings).toEqual([
			{ reason: 'transfer_between_owners', asset: 'BTC', wallet: 'A', toWallet: 'B', at: '2025-02-01T00:00:00Z', qty: 1, costUsd: null, valueUsd: null, acquiredAt: null, refs: ['mv:out', 'mv:in'], detail: null },
			{ reason: 'transfer_link_unconfirmed', asset: 'BTC', wallet: 'A', toWallet: 'B', at: '2025-02-01T00:00:00Z', qty: 1, costUsd: null, valueUsd: null, acquiredAt: null, refs: ['mv:out', 'mv:in'], detail: 'heuristic' },
		]);
	});
});

// ── An entered basis ─────────────────────────────────────────────────────────

describe('a basis the owner entered for a sale', () => {
	const W = 'W';
	const lot = acquire('a', 'BTC', W, '2023-01-01T00:00:00Z', 1, 10_000);
	const entered: ManualBasis = { pricePerToken: 5000, buyDateIso: '2024-01-15T00:00:00Z', notes: 'a gift, valued at receipt' };

	it('is booked instead of the lot basis, with the term from the entered date, and the lots are still consumed', () => {
		const r = runLotLedger([lot, dispose('s', 'BTC', W, '2025-06-01T00:00:00Z', 1, 30_000, { manualBasis: entered })], PW);
		expect(r.slices).toHaveLength(1);
		expect(r.slices[0]).toMatchObject({ lotId: 'lot:a', cost: 5000, gain: 25_000, term: 'long', basisSource: 'manual', acquiredAt: '2024-01-15T00:00:00Z' });
		expect(r.slices[0].originNote).toBe('Basis you entered: a gift, valued at receipt');
		expect(open(r)).toEqual([]);
	});

	it('covers the units the lots could not, so nothing is left unmatched', () => {
		const r = runLotLedger([lot, dispose('s', 'BTC', W, '2025-06-01T00:00:00Z', 2, 60_000, { manualBasis: { ...entered, notes: null } })], PW);
		expect(r.unmatched).toEqual([]);
		expect(r.slices.map((s) => [s.lotId, s.qty, s.cost, s.basisSource])).toEqual([['lot:a', 1, 5000, 'manual'], [null, 1, 5000, 'manual']]);
		expect(sum(r.slices.map((s) => s.proceeds))).toBeCloseTo(60_000, 8);
		expect(r.slices[0].originNote).toBe('Basis you entered: $5000.00 per BTC, acquired 2024-01-15.');
	});

	it('counts from the sale date when no buy date was entered: short-term', () => {
		const r = runLotLedger([lot, dispose('s', 'BTC', W, '2025-06-01T00:00:00Z', 1, 30_000, { manualBasis: { pricePerToken: 5000, buyDateIso: '' } })], PW);
		expect(r.slices[0]).toMatchObject({ term: 'short', acquiredAt: '2025-06-01T00:00:00Z', basisSource: 'manual' });
	});

	it('is ignored for a deposit that is not a sale', () => {
		const r = runLotLedger([lot, dispose('s', 'BTC', W, '2025-06-01T00:00:00Z', 1, 30_000, { taxable: false, category: 'collateral_deposit', manualBasis: entered })], PW);
		expect(r.slices[0]).toMatchObject({ cost: 10_000, basisSource: 'recorded', taxable: false });
	});

	it('is refused, with a finding, when the price cannot be read, and the lots decide', () => {
		const r = runLotLedger([lot, dispose('s', 'BTC', W, '2025-06-01T00:00:00Z', 1, 30_000, { manualBasis: { pricePerToken: Number.NaN, buyDateIso: '2024-01-15' } })], PW);
		expect(findingsOf(r, 'invalid_event')[0]).toMatchObject({ detail: 'manual_basis', refs: ['src:s'] });
		expect(r.slices[0]).toMatchObject({ cost: 10_000, basisSource: 'recorded' });
	});
});

// ── Non-taxable consumption and unmatched sends ──────────────────────────────

describe('consumption that is not a sale', () => {
	const W = 'W';

	it('a collateral deposit consumes lots and books them as non-taxable slices', () => {
		const r = runLotLedger([acquire('a', 'USDC', W, '2024-06-01T00:00:00Z', 100, 100), dispose('d', 'USDC', W, '2025-03-01T00:00:00Z', 60, 60, { taxable: false, category: 'collateral_deposit' })], PW);
		expect(r.slices).toHaveLength(1);
		expect(r.slices[0]).toMatchObject({ taxable: false, category: 'collateral_deposit', qty: 60, cost: 60, gain: 0 });
		expect(taxable(r)).toEqual([]);
		expect(open(r).map((l) => l.remainingQty)).toEqual([40]);
	});

	it('an unmatched send consumes the oldest coins, books nothing, and reports their basis and value', () => {
		const r = runLotLedger([acquire('a', 'BTC', W, '2023-01-01T00:00:00Z', 1, 20_000), sendUnmatched('snd', 'BTC', W, '2025-02-01T00:00:00Z', 1, 100_000)], PW);
		expect(taxable(r)).toEqual([]);
		expect(r.slices[0]).toMatchObject({ taxable: false, category: 'unmatched_transfer', cost: 20_000, proceeds: 100_000 });
		expect(r.findings).toEqual([
			{ reason: 'unmatched_transfer', asset: 'BTC', wallet: W, toWallet: null, at: '2025-02-01T00:00:00Z', qty: 1, costUsd: 20_000, valueUsd: 100_000, acquiredAt: '2023-01-01T00:00:00Z', refs: ['src:snd'], detail: null },
		]);
		expect(open(r)).toEqual([]);
	});

	it('an unmatched send of more than the wallet holds says so, and records the rest', () => {
		const r = runLotLedger([acquire('a', 'BTC', W, '2023-01-01T00:00:00Z', 1, 20_000), sendUnmatched('snd', 'BTC', W, '2025-02-01T00:00:00Z', 2, 200_000)], PW);
		expect(findingsOf(r, 'unmatched_transfer')[0]).toMatchObject({ qty: 2, costUsd: 20_000, detail: 'partly_untracked' });
		expect(r.unmatched).toEqual([{ asset: 'BTC', wallet: W, at: '2025-02-01T00:00:00Z', qty: 1, placeholderQty: 0, proceeds: 100_000, taxable: false, category: 'unmatched_transfer', sourceRef: 'src:snd' }]);
	});

	it('before the boundary an unmatched send consumes from the single pool, whichever wallet it was sent from', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'X', '2023-01-01T00:00:00Z', 1, 20_000), sendUnmatched('snd', 'BTC', 'Y', '2024-02-01T00:00:00Z', 1, 100_000)], PW);
		expect(r.slices[0]).toMatchObject({ lotId: 'lot:a', taxable: false });
		expect(must(r.lots.find((l) => l.id === 'lot:a')).remainingQty).toBe(0);
		// The wallets' own books disagree with the pool (X still shows its coin, Y sent one it never held),
		// and January 1 says so rather than guessing.
		expect(findingsOf(r, 'jan1_position_gap').map((f) => [f.wallet, f.detail])).toEqual([['Y', 'negative_balance'], ['X', 'units_without_basis']]);
	});

	it('sent from the wallet that holds the coins, nothing is left over', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'X', '2023-01-01T00:00:00Z', 1, 20_000), sendUnmatched('snd', 'BTC', 'X', '2024-02-01T00:00:00Z', 1, 100_000)], PW);
		expect(findingsOf(r, 'jan1_position_gap')).toEqual([]);
		expect(open(r)).toEqual([]);
	});
});

// ── Methods ──────────────────────────────────────────────────────────────────

describe('cost-basis methods', () => {
	const W = 'W';
	const lots = [
		acquire('a', 'BTC', W, '2024-01-01T00:00:00Z', 1, 100),
		acquire('b', 'BTC', W, '2024-02-01T00:00:00Z', 1, 900),
		acquire('c', 'BTC', W, '2024-03-01T00:00:00Z', 1, 500),
	];
	const sale = (at = '2025-06-01T00:00:00Z') => dispose('s', 'BTC', W, at, 1, 1000);

	it.each([
		['fifo', 'lot:a'],
		['lifo', 'lot:c'],
		['hifo', 'lot:b'],
		['spec_id', 'lot:a'], // no pin: first in, first out
	] as const)('%s sells inside the wallet pool: %s', (method, lotId) => {
		expect(runLotLedger([...lots, sale()], { ...PW, method }).slices[0].lotId).toBe(lotId);
	});

	it('Spec ID takes the pinned lot, matched on its acquisition time and quantity', () => {
		const lotPins = new Map([['src:s', { acquiredAt: '2024-03-01T00:00:00Z', amountHint: 1 }]]);
		expect(runLotLedger([...lots, sale()], { ...PW, method: 'spec_id', lotPins }).slices[0].lotId).toBe('lot:c');
	});

	it('the method also applies inside the single pool before the boundary, across wallets', () => {
		const events = [acquire('a', 'BTC', 'W1', '2023-01-01T00:00:00Z', 1, 100), acquire('b', 'BTC', 'W2', '2023-02-01T00:00:00Z', 1, 300), dispose('s', 'BTC', 'W1', '2024-06-01T00:00:00Z', 1, 500)];
		expect(runLotLedger(events, { ...PW, method: 'hifo' }).slices[0]).toMatchObject({ lotId: 'lot:b', cost: 300, wallet: 'W1' });
		expect(runLotLedger(events, PW).slices[0]).toMatchObject({ lotId: 'lot:a' });
	});
});

// ── Unreadable and invalid input ─────────────────────────────────────────────

describe('unreadable and invalid input', () => {
	it('an event whose time cannot be read becomes a finding that says what it was, and is left out', () => {
		const r = runLotLedger(
			[
				acquire('a', 'BTC', 'W', 'last Tuesday', 1, 100),
				dispose('s', 'BTC', 'W', '', 1.5, 250),
				move('m', 'BTC', 'A', 'B', '2025-01-01', 'soon', 2, 1.999),
				move('m2', 'BTC', 'A', 'B', 'nope', '2025-01-01', 3, 3),
				sendUnmatched('snd', 'BTC', 'W', '31/12/2025', 4, 500),
				acquire('feb30', 'BTC', 'W', '2025-02-30', 5, 50),
			],
			PW,
		);
		// These findings come out in an order of their own (see the next test), not the order the events came in.
		const shape = r.findings.map((f) => [f.detail, f.refs.join(), f.wallet, f.toWallet, f.at, f.qty, f.costUsd, f.valueUsd]).sort();
		expect(shape).toEqual([
			['acquire', 'src:a', 'W', null, 'last Tuesday', 1, 100, null],
			['acquire', 'src:feb30', 'W', null, '2025-02-30', 5, 50, null],
			['dispose', 'src:s', 'W', null, null, 1.5, null, 250],
			['move_in_date', 'm:out', 'A', 'B', 'soon', 2, null, null],
			['move_out_date', 'm2:out', 'A', 'B', 'nope', 3, null, null],
			['send', 'src:snd', 'W', null, '31/12/2025', 4, null, 500],
		]);
		expect(new Set(r.findings.map((f) => f.reason))).toEqual(new Set(['unreadable_event_date']));
		expect(r.lots).toEqual([]);
		expect(r.slices).toEqual([]);
	});

	it('a quantity that is not a number, or is negative, becomes a finding that keeps the amount', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'W', '2025-01-01T00:00:00Z', Number.NaN, 100), acquire('b', 'BTC', 'W', '2025-01-01T00:00:00Z', -1, 100), dispose('s', 'BTC', 'W', '2025-02-01T00:00:00Z', Number.POSITIVE_INFINITY, 75)], PW);
		expect(r.findings.map((f) => [f.reason, f.detail, f.refs.join(), f.qty, f.costUsd, f.valueUsd]).sort()).toEqual([
			['invalid_event', 'acquire_qty', 'src:a', null, 100, null],
			['invalid_event', 'acquire_qty', 'src:b', -1, 100, null],
			['invalid_event', 'dispose_qty', 'src:s', null, null, 75],
		]);
		expect(r.lots).toEqual([]);
	});

	it("a wallet named like one of the ledger's own pseudo-wallets is read as no wallet", () => {
		const r = runLotLedger(
			[
				acquire('a', 'BTC', 'unallocated', '2024-01-01T00:00:00Z', 1, 100),
				acquire('b', 'BTC', 'transit', '2024-02-01T00:00:00Z', 1, 200),
				dispose('s', 'BTC', 'unresolved', '2025-06-01T00:00:00Z', 2, 500),
			],
			PW,
		);
		expect(r.findings).toEqual([]);
		expect(r.unmatched).toEqual([]);
		expect(r.slices.map((x) => [x.wallet, x.cost])).toEqual([['unresolved', 100], ['unresolved', 200]]);
		expect(new Set(r.lots.map((l) => l.wallet))).toEqual(new Set(['unresolved']));
	});

	it('findings about events that could not be read come out in the same order whatever order the events came in', () => {
		const bad: LedgerEvent[] = [
			acquire('a', 'BTC', 'W', 'nope', 1, 1),
			dispose('b', 'BTC', 'W', '', 1, 1),
			acquire('c', '', 'W', '2025-01-01T00:00:00Z', 1, 1),
			{ kind: 'gift' } as unknown as LedgerEvent,
			acquire('d', 'BTC', 'W', '2025-01-01T00:00:00Z', Number.NaN, 1),
		];
		const forward = runLotLedger(bad, PW);
		expect(forward.findings).toHaveLength(5);
		expect(JSON.stringify(runLotLedger([...bad].reverse(), PW))).toBe(JSON.stringify(forward));
		expect(JSON.stringify(runLotLedger([bad[2], bad[4], bad[0], bad[3], bad[1]], PW))).toBe(JSON.stringify(forward));
	});

	it('an event with no asset becomes a finding', () => {
		const r = runLotLedger([acquire('a', '  ', 'W', '2025-01-01T00:00:00Z', 1, 100)], PW);
		expect(r.findings.map((f) => [f.reason, f.detail])).toEqual([['invalid_event', 'acquire_asset']]);
	});

	it('a cost or proceeds that is not a usable amount is unknown, not zero', () => {
		const r = runLotLedger([acquire('a', 'BTC', 'W', '2025-01-01T00:00:00Z', 1, Number.NaN), dispose('s', 'BTC', 'W', '2025-02-01T00:00:00Z', 1, -5)], PW);
		expect(r.slices[0]).toMatchObject({ cost: null, proceeds: null, gain: null, basisSource: 'missing' });
	});

	it('an unknown origin counts as other, and an unknown link as a guess', () => {
		const r = runLotLedger(
			[
				{ ...(acquire('a', 'BTC', 'A', '2024-01-01T00:00:00Z', 1, 100) as Extract<LedgerEvent, { kind: 'acquire' }>), origin: 'gift' as unknown as AcquireOrigin },
				{ ...(move('m', 'BTC', 'A', 'B', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 1, 1) as Extract<LedgerEvent, { kind: 'move' }>), link: 'maybe' as unknown as MoveLink },
			],
			PW,
		);
		expect(r.lots[0].origin).toBe('other');
		expect(reasons(r)).toEqual(['transfer_link_unconfirmed']);
	});

	it('an event of an unknown kind becomes a finding', () => {
		const r = runLotLedger([{ kind: 'gift' } as unknown as LedgerEvent], PW);
		expect(r.findings.map((f) => [f.reason, f.detail])).toEqual([['invalid_event', 'kind']]);
	});

	it.each(['2025-1-1', '2025-02-30', '2025', '2025-01-01T00:00:00Z', ''])('perWalletFrom %j cannot be read: RangeError', (bad) => {
		expect(() => runLotLedger([], { perWalletFrom: bad })).toThrow(RangeError);
	});

	it('a snapshot time that cannot be read is a RangeError', () => {
		expect(() => runLotLedger([], { snapshotsAt: ['yesterday'] })).toThrow(RangeError);
	});

	it('does not touch the events it is given', () => {
		const events = Object.freeze([
			Object.freeze(acquire('a', 'BTC', 'A', '2024-06-01T00:00:00Z', 1, 100)),
			Object.freeze(move('mv', 'BTC', 'A', 'B', '2025-02-01T00:00:00Z', '2025-02-01T01:00:00Z', 1, 0.99)),
		]);
		expect(() => runLotLedger(events, PW)).not.toThrow();
	});

	it('names every finding reason it can raise', () => {
		expect(new Set(FINDING_REASONS).size).toBe(FINDING_REASONS.length);
		// The reasons the plan lists for the review surfaces are all there.
		for (const reason of ['unmatched_transfer', 'transfer_fee_units', 'transfer_link_unconfirmed', 'transfer_between_owners', 'transfer_amount_mismatch', 'manual_basis_on_transfer', 'jan1_position_gap', 'estimated_transfer_basis']) {
			expect(FINDING_REASONS).toContain(reason);
		}
	});

	it('reports the engine version', () => {
		expect(ENGINE_VERSION).toMatch(/^lot-ledger-\d+$/);
		expect(runLotLedger([]).engineVersion).toBe(ENGINE_VERSION);
	});
});

// ── Cross-cutting invariants, over histories generated from fixed seeds ──────

/** A small seeded generator (mulberry32): the same seed is the same history on every machine. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface GenOptions {
	wallets: readonly string[];
	assets?: readonly string[];
	count?: number;
	moves?: boolean;
	fees?: boolean;
	/** The first event is after this instant. Default 2023-01-01. */
	start?: number;
	/** With fees, also let a move land more than it carried. Default true. */
	surplus?: boolean;
	/** Make positions this many units big, with eight decimals (a token with millions of units). Default: small, three decimals. */
	scale?: number;
	/** Close with a sale of everything every wallet still holds. */
	sellAll?: boolean;
}

const WALLETS = ['cex:coinbase:acct-1', 'cex:kraken:k1', 'ethereum:0xaaa', 'bitcoin:bc1-test'] as const;
const DAY = 86_400_000;

/**
 * A history that spans 2023 to mid 2026, in time order, in which no sale is for more than the
 * wallet it is made from holds and no move carries more than its source holds. Quantities have at
 * most three decimals; moves land up to six hours after they leave and sometimes lose a small fee.
 */
function generate(seed: number, o: GenOptions): LedgerEvent[] {
	const rand = rng(seed);
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
	const assets = o.assets ?? ['BTC', 'ETH'];
	const sizes = [0.1, 0.2, 0.25, 0.5, 1, 1.5, 2, 3];
	const held = new Map<string, number>();
	const key = (asset: string, wallet: string) => `${asset}|${wallet}`;
	const heldOf = (asset: string, wallet: string) => held.get(key(asset, wallet)) ?? 0;
	const places = o.scale ? 1e8 : 1e6;
	const add = (asset: string, wallet: string, qty: number) => held.set(key(asset, wallet), Math.round((heldOf(asset, wallet) + qty) * places) / places);
	const sized = (n: number) => (o.scale ? Math.round(n * o.scale * (0.5 + rand()) * 1e8) / 1e8 : n);
	const iso = (ms: number) => new Date(ms).toISOString();
	const cents = (n: number) => Math.round(n * 100) / 100;

	const events: LedgerEvent[] = [];
	let t = o.start ?? Date.UTC(2023, 0, 1);
	for (let i = 0; i < (o.count ?? 28); i++) {
		t += (1 + Math.floor(rand() * 75)) * DAY + Math.floor(rand() * 24) * 3_600_000;
		const asset = pick(assets);
		const price = 100 + Math.floor(rand() * 4900);
		const roll = rand();
		const sources = o.wallets.filter((w) => heldOf(asset, w) >= 0.1 * (o.scale ?? 1));
		if (roll < 0.4 || sources.length === 0) {
			const wallet = pick(o.wallets);
			const qty = sized(pick(sizes));
			events.push(acquire(`e${i}`, asset, wallet, iso(t), qty, cents(qty * price)));
			add(asset, wallet, qty);
		} else if (roll < 0.72 || !o.moves) {
			const wallet = pick(sources);
			const qty = Math.min(sized(pick(sizes)), heldOf(asset, wallet));
			events.push(dispose(`e${i}`, asset, wallet, iso(t), qty, cents(qty * price * (0.6 + rand()))));
			add(asset, wallet, -qty);
		} else {
			const from = pick(sources);
			const to = pick(o.wallets.filter((w) => w !== from));
			const qtyOut = Math.min(sized(pick(sizes)), heldOf(asset, from));
			const feeRoll = rand();
			const qtyIn = !o.fees ? qtyOut : feeRoll < 0.3 && qtyOut > 0.01 ? Math.round((qtyOut - pick([0.001, 0.002])) * 1e6) / 1e6 : feeRoll < 0.36 && o.surplus !== false ? Math.round((qtyOut + 0.001) * 1e6) / 1e6 : qtyOut;
			const landAt = t + Math.floor(rand() * 7) * 3_600_000;
			events.push(move(`e${i}`, asset, from, to, iso(t), iso(landAt), qtyOut, qtyIn, { link: pick(['hash', 'confirmed', 'heuristic'] as const), ownersDiffer: rand() < 0.2 }));
			add(asset, from, -qtyOut);
			add(asset, to, qtyIn);
		}
	}
	if (o.sellAll) {
		t += DAY;
		let n = events.length;
		for (const asset of assets) {
			for (const wallet of o.wallets) {
				const left = heldOf(asset, wallet);
				if (left > 0) events.push(dispose(`z${n++}`, asset, wallet, iso(t), left, cents(left * 100)));
			}
		}
	}
	return events;
}

function shuffled<T>(xs: readonly T[], seed: number): T[] {
	const rand = rng(seed);
	const out = [...xs];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const BOUNDARY = Date.parse('2025-01-01T00:00:00Z');
const ms = (s: string) => Date.parse(s);

describe('invariants over generated histories (fixed seeds)', () => {
	const gen = { wallets: WALLETS, moves: true, fees: true } as const;

	it('the generator is deterministic and produces histories that reach both sides of the boundary', () => {
		expect(JSON.stringify(generate(7, gen))).toBe(JSON.stringify(generate(7, gen)));
		const kinds = new Set(SEEDS.flatMap((s) => generate(s, gen).map((e) => e.kind)));
		expect(kinds).toEqual(new Set(['acquire', 'dispose', 'move']));
		const spans = SEEDS.filter((s) => {
			const times = generate(s, gen).map((e) => ms(e.kind === 'move' ? e.outAt : e.at));
			return Math.min(...times) < BOUNDARY && Math.max(...times) > BOUNDARY;
		});
		expect(spans.length).toBeGreaterThan(SEEDS.length * 0.8);
	});

	it.each([['per wallet from 2025', PW], ['one pool', { perWalletFrom: null } as LedgerOptions]] as const)('input permutation gives identical output (%s)', (_name, opts) => {
		for (const seed of SEEDS) {
			const events = generate(seed, gen);
			const expected = JSON.stringify(runLotLedger(events, opts));
			expect(JSON.stringify(runLotLedger(shuffled(events, seed * 31 + 7), opts)), `seed ${seed}`).toBe(expected);
			expect(JSON.stringify(runLotLedger([...events].reverse(), opts)), `seed ${seed} reversed`).toBe(expected);
		}
	});

	it('no slice has an acquisition after its disposal, and nothing is dust', () => {
		for (const seed of SEEDS) {
			const r = runLotLedger(generate(seed, gen), PW);
			for (const s of r.slices) {
				expect(ms(s.acquiredAt), `seed ${seed} ${s.id}`).toBeLessThanOrEqual(ms(s.disposedAt));
				expect(s.qty, `seed ${seed} ${s.id}`).toBeGreaterThan(EPSILON);
			}
			for (const u of r.unmatched) expect(u.qty).toBeGreaterThan(EPSILON);
			for (const l of r.lots) expect(l.remainingQty === 0 || l.remainingQty > EPSILON, `seed ${seed} ${l.id}`).toBe(true);
			for (const l of r.lots) expect(l.remainingQty).toBeGreaterThanOrEqual(0);
		}
	});

	it.each([1e4, 1e6, 1e9, 1e12])('positions of %s units with eight decimals: books that balance leave no phantom lots, gaps, shortfalls or unmatched rows', (scale) => {
		// Float noise grows with the size of a number (a million units carries about 1e-10 of it), so dust is judged
		// against the size of the quantities, not against a fixed 1e-10.
		const allowed = new Set(['transfer_link_unconfirmed', 'transfer_between_owners']);
		for (const seed of SEEDS.slice(0, 40)) {
			const events = generate(seed, { wallets: WALLETS, assets: ['MEME'], moves: true, fees: false, scale, sellAll: true });
			const r = runLotLedger(events, PW);
			expect(r.findings.filter((f) => !allowed.has(f.reason)).map((f) => `${f.reason}:${f.detail}`), `seed ${seed}`).toEqual([]);
			expect(r.unmatched, `seed ${seed}`).toEqual([]);
			expect(open(r).map((l) => [l.id, l.remainingQty]), `seed ${seed}`).toEqual([]);
			for (const x of r.slices) expect(x.qty, `seed ${seed} ${x.id}`).toBeGreaterThan(scale * 1e-12);
			for (const x of r.slices) if (x.proceeds !== null) expect(x.proceeds).toBeGreaterThanOrEqual(0);
		}
	});

	it('a million-unit position sold in two parts leaves no dust lot, and a later sale books no dust slice', () => {
		const r = runLotLedger(
			[
				acquire('a', 'MEME', 'W', '2024-02-01T00:00:00Z', 2000000.1, 100),
				acquire('b', 'MEME', 'W', '2024-03-01T00:00:00Z', 3000000.2, 200),
				dispose('s', 'MEME', 'W', '2025-06-01T00:00:00Z', 5000000.3, 400),
			],
			PW,
		);
		expect(open(r)).toEqual([]);
		expect(r.slices.map((x) => x.lotId)).toEqual(['lot:a', 'lot:b']);
		expect(r.unmatched).toEqual([]);
	});

	it('books that balance at a million units raise no gap on January 1', () => {
		const r = runLotLedger(
			[
				acquire('a', 'MEME', 'W', '2024-02-01T00:00:00Z', 1234250.9443406, 100),
				acquire('b', 'MEME', 'W', '2024-03-01T00:00:00Z', 824998.43230471, 200),
				dispose('s', 'MEME', 'W', '2024-06-01T00:00:00Z', 422913.65167597, 400),
			],
			PW,
		);
		expect(r.findings).toEqual([]);
		expect(r.lots.map((l) => l.id)).toEqual(['lot:a', 'lot:b']);
	});

	it('per asset: acquired = open + sold slices + units a placeholder stood for + fee units + transit, in units and in cost', () => {
		for (const seed of SEEDS) {
			const events = generate(seed, gen);
			const landing = new Map(events.filter((e): e is Extract<LedgerEvent, { kind: 'move' }> => e.kind === 'move').map((e) => [e.outRef, Math.max(ms(e.inAt), ms(e.outAt))]));
			const instants = ['2023-12-31T23:59:59.999Z', '2024-12-31T23:59:59.999Z', '2025-06-30T23:59:59.999Z', '2026-12-31T23:59:59.999Z'];
			const r = runLotLedger(events, { ...PW, snapshotsAt: instants });
			const assets = [...new Set(r.lots.map((l) => l.asset))];
			for (const asset of assets) {
				const lots = r.lots.filter((l) => l.asset === asset);
				const pricedRoots = lots.filter((l) => l.originLotId === null);
				const fee = r.findings.filter((f) => f.reason === 'transfer_fee_units' && f.detail === 'carved_from_lots' && f.asset === asset);

				// The end of the history.
				const sold = r.slices.filter((s) => s.asset === asset && s.lotId !== null);
				const placeholder = sum(r.unmatched.filter((u) => u.asset === asset).map((u) => u.placeholderQty));
				expect(sum(pricedRoots.map((l) => l.qty)), `seed ${seed} ${asset} units`).toBeCloseTo(sum(lots.map((l) => l.remainingQty)) + sum(sold.map((s) => s.qty)) + placeholder + sum(fee.map((f) => f.qty)), 8);
				expect(sum(pricedRoots.map((l) => l.costUsd)), `seed ${seed} ${asset} cost`).toBeCloseTo(sum(lots.map((l) => l.remainingCostUsd)) + sum(sold.map((s) => s.cost)) + sum(fee.map((f) => f.costUsd)), 6);

				// Every snapshot, with units in transit counted.
				r.snapshots.forEach((snap, i) => {
					const t = ms(instants[i]);
					const heldAtT = sum(snap.lots.filter((l) => l.asset === asset).map((l) => l.qty));
					const acquiredByT = sum(pricedRoots.filter((l) => ms(l.acquiredAt) <= t).map((l) => l.qty));
					const soldByT = sum(sold.filter((s) => ms(s.disposedAt) <= t).map((s) => s.qty));
					const placeholderByT = sum(r.unmatched.filter((u) => u.asset === asset && ms(u.at) <= t).map((u) => u.placeholderQty));
					const feeByT = sum(fee.filter((f) => (landing.get(f.refs[0]) ?? Infinity) <= t).map((f) => f.qty));
					expect(heldAtT, `seed ${seed} ${asset} snapshot ${instants[i]}`).toBeCloseTo(acquiredByT - soldByT - placeholderByT - feeByT, 8);
				});
			}
		}
	});

	it('every sale is accounted for: its slices and unmatched units add up to its quantity, and its proceeds to its proceeds', () => {
		for (const seed of SEEDS) {
			const events = generate(seed, gen);
			const r = runLotLedger(events, PW);
			for (const e of events) {
				if (e.kind !== 'dispose') continue;
				const slices = r.slices.filter((s) => s.sourceRef === e.sourceRef);
				const um = r.unmatched.filter((u) => u.sourceRef === e.sourceRef);
				expect(sum(slices.map((s) => s.qty)) + sum(um.map((u) => u.qty)), `seed ${seed} ${e.id} qty`).toBeCloseTo(e.qty, 8);
				expect(sum(slices.map((s) => s.proceeds)) + sum(um.map((u) => u.proceeds)), `seed ${seed} ${e.id} proceeds`).toBeCloseTo(e.proceedsUsd ?? 0, 6);
			}
		}
	});

	it('a tenant with one wallet per asset gets the same result per wallet and with one pool', () => {
		for (const seed of SEEDS) {
			const events = generate(seed, { wallets: ['cex:coinbase:acct-1'], assets: ['BTC'], moves: false });
			const perWallet = runLotLedger(events, PW);
			const pooled = runLotLedger(events, { perWalletFrom: null });
			expect(perWallet.slices, `seed ${seed}`).toEqual(pooled.slices);
			expect(perWallet.unmatched).toEqual(pooled.unmatched);
			expect(open(perWallet).map((l) => [l.remainingQty, l.remainingCostUsd, l.acquiredAt])).toEqual(open(pooled).map((l) => [l.remainingQty, l.remainingCostUsd, l.acquiredAt]));
			expect(perWallet.findings).toEqual([]);
		}
	});

	it('moves before the boundary never change a sale before it, and with one pool never change a sale at all', () => {
		for (const seed of SEEDS) {
			const events = generate(seed, gen);
			const noMoves = events.filter((e) => e.kind !== 'move');
			const early = (r: LedgerResult) => r.slices.filter((s) => ms(s.disposedAt) < BOUNDARY);
			expect(early(runLotLedger(events, PW)), `seed ${seed}`).toEqual(early(runLotLedger(noMoves, PW)));
			// Without a boundary the pool is one for every year: a move changes no sale, in any year.
			expect(runLotLedger(events, { perWalletFrom: null }).slices, `seed ${seed} pooled`).toEqual(runLotLedger(noMoves, { perWalletFrom: null }).slices);
			expect(runLotLedger(events, { perWalletFrom: null }).unmatched).toEqual(runLotLedger(noMoves, { perWalletFrom: null }).unmatched);
		}
	});

	it('the January 1 allocation never creates or loses basis: unused basis = allocated + unallocated', () => {
		for (const seed of SEEDS) {
			const r = runLotLedger(generate(seed, gen), PW);
			for (const j of r.jan1) {
				const unusedUnits = sum(j.unused.map((u) => u.qty));
				const unusedCost = sum(j.unused.map((u) => u.costUsd));
				const placed = j.positions.flatMap((p) => p.lots).filter((l) => l.pass !== 'placeholder');
				expect(sum(placed.map((l) => l.qty)), `seed ${seed} ${j.asset}`).toBeCloseTo(unusedUnits, 8);
				expect(sum(placed.map((l) => l.costUsd)), `seed ${seed} ${j.asset} cost`).toBeCloseTo(unusedCost, 6);
				// Every position holds what its lots add up to.
				for (const p of j.positions) expect(p.units).toBeCloseTo(sum(p.lots.map((l) => l.qty)), 8);
			}
		}
	});

	it('January 1 puts in each wallet exactly the units it held: every acquisition, sale and move that started before the boundary, in flight or not', () => {
		for (const seed of SEEDS) {
			const events = generate(seed, gen);
			const held = new Map<string, number>();
			const add = (asset: string, wallet: string, qty: number) => held.set(`${asset}|${wallet}`, (held.get(`${asset}|${wallet}`) ?? 0) + qty);
			for (const e of events) {
				if (e.kind === 'acquire' && ms(e.at) < BOUNDARY) add(e.asset, e.wallet, e.qty);
				else if (e.kind === 'dispose' && ms(e.at) < BOUNDARY) add(e.asset, e.wallet, -e.qty);
				else if (e.kind === 'move' && ms(e.outAt) < BOUNDARY) {
					add(e.asset, e.fromWallet, -e.qtyOut);
					add(e.asset, e.toWallet, e.qtyIn);
				}
			}
			const r = runLotLedger(events, PW);
			const got = new Map<string, number>();
			for (const j of r.jan1) for (const p of j.positions) if (p.wallet !== UNALLOCATED_WALLET) got.set(`${j.asset}|${p.wallet}`, p.units);
			const want = new Map([...held].filter(([, v]) => v > EPSILON));
			expect([...got.keys()].sort(), `seed ${seed}`).toEqual([...want.keys()].sort());
			for (const [k, v] of want) expect(got.get(k), `seed ${seed} ${k}`).toBeCloseTo(v, 8);
		}
	});

	it("an owner's allocation copied from the reconstruction is accepted and changes nothing; one that swaps two wallets' lots is accepted and moves the basis", () => {
		let accepted = 0;
		let swapped = 0;
		for (const seed of SEEDS) {
			const events = generate(seed, gen);
			const plain = runLotLedger(events, PW);
			const noGaps = plain.findings.every((f) => f.reason !== 'jan1_position_gap');
			if (!noGaps) continue;
			const rowsFor = (swap: boolean) =>
				plain.jan1.map((j) => ({
					asset: j.asset,
					rows: j.positions.flatMap((p) => p.lots.map((l) => ({ wallet: p.wallet, acquiredAt: l.acquiredAt, qty: l.qty, costUsd: l.costUsd }))),
					swap,
				}));
			// Copied as it is: the reconstruction's own answer, entered as an allocation.
			const copied = runLotLedger(events, { ...PW, allocationOverrides: rowsFor(false).map(({ asset, rows }) => ({ asset, rows })) });
			expect(copied.findings, `seed ${seed}`).toEqual(plain.findings);
			expect(copied.jan1.every((j) => j.source === 'override' && !j.overrideRejected), `seed ${seed}`).toBe(true);
			// Same sales, same lots, same figures; only the note on where a lot was placed says which allocation it was.
			const placed = / Placed in this wallet by the [^.]*\./;
			expect(copied.slices.map((x) => ({ ...x, originNote: x.originNote.replace(placed, '') })), `seed ${seed}`).toEqual(plain.slices.map((x) => ({ ...x, originNote: x.originNote.replace(placed, '') })));
			expect(copied.slices.some((x) => /you entered/.test(x.originNote)) || !plain.slices.some((x) => /reconstructed/.test(x.originNote)), `seed ${seed}`).toBe(true);
			expect(copied.unmatched, `seed ${seed}`).toEqual(plain.unmatched);
			accepted++;

			// Two wallets trade their lots for the same number of units of other dates: only possible when
			// two wallets each hold exactly one lot of the same size. Then the allocation is still valid.
			for (const j of plain.jan1) {
				const single = j.positions.filter((p) => p.lots.length === 1);
				const a = single.find((p, i) => single.some((q, k) => k !== i && Math.abs(q.lots[0].qty - p.lots[0].qty) < 1e-9));
				const b = single.find((q) => q !== a && a !== undefined && Math.abs(q.lots[0].qty - a.lots[0].qty) < 1e-9);
				if (!a || !b) continue;
				const rows = j.positions.flatMap((p) =>
					p.lots.map((l) => {
						const lot = p === a ? b.lots[0] : p === b ? a.lots[0] : l;
						return { wallet: p.wallet, acquiredAt: lot.acquiredAt, qty: l.qty, costUsd: lot.costUsd };
					}),
				);
				const r = runLotLedger(events, { ...PW, allocationOverrides: [{ asset: j.asset, rows }] });
				expect(r.jan1.find((x) => x.asset === j.asset), `seed ${seed} swap`).toMatchObject({ source: 'override', overrideRejected: false });
				const after = r.jan1.find((x) => x.asset === j.asset);
				expect(after?.positions.find((p) => p.wallet === a.wallet)?.lots[0].acquiredAt).toBe(b.lots[0].acquiredAt);
				swapped++;
			}
		}
		expect(accepted).toBeGreaterThan(10);
		expect(swapped).toBeGreaterThan(0);
	});

	it('events with no wallet form one pool per asset', () => {
		for (const seed of SEEDS.slice(0, 20)) {
			const events = generate(seed, { wallets: ['x'], assets: ['BTC'], moves: false });
			const blank = events.map((e) => ('wallet' in e ? { ...e, wallet: seed % 2 ? '' : 'unresolved' } : e));
			const named = events.map((e) => ('wallet' in e ? { ...e, wallet: 'unresolved' } : e));
			expect(runLotLedger(blank, PW), `seed ${seed}`).toEqual(runLotLedger(named, PW));
		}
	});

	it('histories with every event at one instant still give one result, whatever the order', () => {
		for (const seed of SEEDS.slice(0, 20)) {
			const T = '2025-04-01T00:00:00Z';
			const events = generate(seed, { wallets: WALLETS, assets: ['BTC'], moves: true, fees: false, count: 12 });
			const flat = events.map((e) => (e.kind === 'move' ? { ...e, outAt: T, inAt: T } : { ...e, at: T }) as LedgerEvent);
			const a = runLotLedger(flat, PW);
			const b = runLotLedger(shuffled(flat, seed), PW);
			expect(JSON.stringify(b), `seed ${seed}`).toBe(JSON.stringify(a));
		}
	});
});

// ── Against a plain reference model ──────────────────────────────────────────

/** Long-term iff the sale is after the anniversary, by UTC calendar date (Feb 29 has its anniversary on Feb 28). */
function longTermReference(acquiredAt: string, disposedAt: string): boolean {
	const a = new Date(acquiredAt);
	const d = new Date(disposedAt);
	const feb29 = a.getUTCMonth() === 1 && a.getUTCDate() === 29;
	const anniversary = Date.UTC(a.getUTCFullYear() + 1, feb29 ? 1 : a.getUTCMonth(), feb29 ? 28 : a.getUTCDate());
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) > anniversary;
}

interface RefLot {
	wallet: string;
	acquiredAt: string;
	ms: number;
	qty: number;
	cost: number | null;
}
interface RefSlice {
	/** The sourceRef of the sale. */
	ref: string;
	asset: string;
	wallet: string;
	acquiredAt: string;
	qty: number;
	cost: number | null;
	proceeds: number | null;
	term: 'short' | 'long';
}

/**
 * The ledger's rules, written out plainly for histories in which every event is at least six hours
 * after the last (so a move has landed before anything else happens): per-asset pools (or per
 * asset and wallet), first in first out by original date, a lot left with dust is taken whole,
 * proceeds shared by quantity with the last piece taking the rest, a move taking the source
 * wallet's oldest units and losing its fee off the last of them.
 */
function reference(events: LedgerEvent[], perWallet: boolean): { slices: RefSlice[]; open: RefLot[] } {
	const pools = new Map<string, RefLot[]>();
	const poolOf = (asset: string, wallet: string) => {
		const key = perWallet ? `${asset}|${wallet}` : asset;
		let p = pools.get(key);
		if (!p) pools.set(key, (p = []));
		return p;
	};
	const insert = (pool: RefLot[], lot: RefLot) => {
		const at = pool.findIndex((l) => l.ms > lot.ms);
		pool.splice(at === -1 ? pool.length : at, 0, lot);
	};
	const take = (pool: RefLot[], qty: number): { lot: RefLot; qty: number; cost: number | null }[] => {
		const out: { lot: RefLot; qty: number; cost: number | null }[] = [];
		let left = qty;
		while (left > 1e-10 && pool.length) {
			const lot = pool[0];
			let n = Math.min(left, lot.qty);
			if (lot.qty - n <= 1e-10) n = lot.qty;
			const whole = n >= lot.qty;
			const cost = lot.cost === null ? null : whole ? lot.cost : lot.cost * (n / lot.qty);
			out.push({ lot: { ...lot }, qty: n, cost });
			if (whole) pool.shift();
			else {
				lot.qty -= n;
				lot.cost = lot.cost === null ? null : lot.cost - (cost as number);
			}
			left -= n;
		}
		return out;
	};

	const slices: RefSlice[] = [];
	const timed = [...events].sort((a, b) => ms(a.kind === 'move' ? a.outAt : a.at) - ms(b.kind === 'move' ? b.outAt : b.at));
	for (const e of timed) {
		if (e.kind === 'acquire') insert(poolOf(e.asset, e.wallet), { wallet: e.wallet, acquiredAt: e.at, ms: ms(e.at), qty: e.qty, cost: e.costUsd });
		else if (e.kind === 'dispose') {
			const pieces = take(poolOf(e.asset, e.wallet), e.qty);
			let given = 0;
			pieces.forEach((p, i) => {
				const last = i === pieces.length - 1;
				const share = e.proceedsUsd === null ? null : last ? e.proceedsUsd - given : e.proceedsUsd * (p.qty / e.qty);
				given += share ?? 0;
				slices.push({ ref: e.sourceRef, asset: e.asset, wallet: e.wallet, acquiredAt: p.lot.acquiredAt, qty: p.qty, cost: p.cost, proceeds: share, term: longTermReference(p.lot.acquiredAt, e.at) ? 'long' : 'short' });
			});
		} else if (e.kind === 'move' && perWallet) {
			const pieces = take(poolOf(e.asset, e.fromWallet), e.qtyOut);
			let fee = Math.round((e.qtyOut - e.qtyIn) * 1e12) / 1e12;
			for (let i = pieces.length - 1; i >= 0 && fee > 1e-10; i--) {
				const p = pieces[i];
				const cut = Math.min(fee, p.qty);
				const whole = p.qty - cut <= 1e-10;
				const cutCost = p.cost === null ? null : whole ? p.cost : p.cost * (cut / p.qty);
				fee -= whole ? p.qty : cut;
				p.cost = p.cost === null ? null : whole ? 0 : p.cost - (cutCost as number);
				p.qty = whole ? 0 : p.qty - cut;
			}
			for (const p of pieces) if (p.qty > 1e-10) insert(poolOf(e.asset, e.toWallet), { wallet: e.toWallet, acquiredAt: p.lot.acquiredAt, ms: p.lot.ms, qty: p.qty, cost: p.cost });
			const surplus = Math.round((e.qtyIn - e.qtyOut) * 1e12) / 1e12;
			if (surplus > 1e-10) insert(poolOf(e.asset, e.toWallet), { wallet: e.toWallet, acquiredAt: e.inAt > e.outAt ? e.inAt : e.outAt, ms: Math.max(ms(e.inAt), ms(e.outAt)), qty: surplus, cost: null });
		}
	}
	return { slices, open: [...pools.values()].flat().filter((l) => l.qty > 1e-10) };
}

describe('against a plain reference model', () => {
	const closeTo = (a: number | null, b: number | null, why: string) => {
		if (a === null || b === null) expect(a, why).toBe(b);
		else expect(a, why).toBeCloseTo(b, 6);
	};
	// Pieces of one lot that were moved at different times share a date, and their order within it is
	// not a rule (the ledger breaks the tie by lot id): compare per sale, wallet and original date.
	type Agg = { qty: number; cost: number | null; proceeds: number | null; term: string; n: number };
	const aggregate = (xs: { ref: string; asset: string; wallet: string; acquiredAt: string; qty: number; cost: number | null; proceeds: number | null; term: string }[]) => {
		const out = new Map<string, Agg>();
		for (const x of xs) {
			const key = `${x.ref}|${x.asset}|${x.wallet}|${x.acquiredAt}`;
			const a = out.get(key) ?? { qty: 0, cost: 0, proceeds: 0, term: x.term, n: 0 };
			a.qty += x.qty;
			a.cost = a.cost === null || x.cost === null ? null : a.cost + x.cost;
			a.proceeds = a.proceeds === null || x.proceeds === null ? null : a.proceeds + x.proceeds;
			a.n++;
			out.set(key, a);
		}
		return out;
	};
	const sameSlices = (got: LedgerResult['slices'], want: RefSlice[], why: string) => {
		const g = aggregate(got.map((x) => ({ ...x, ref: x.sourceRef })));
		const w = aggregate(want);
		expect([...g.keys()].sort(), `${why}: sales and original dates`).toEqual([...w.keys()].sort());
		for (const [key, a] of g) {
			const b = must(w.get(key));
			expect(a.term, `${why} ${key} term`).toBe(b.term);
			expect(a.qty, `${why} ${key} qty`).toBeCloseTo(b.qty, 9);
			closeTo(a.cost, b.cost, `${why} ${key} cost`);
			closeTo(a.proceeds, b.proceeds, `${why} ${key} proceeds`);
		}
	};
	/** What is left, per wallet and original date: pieces of one lot share a date, and their split is not a rule. */
	const leftOver = (xs: { wallet: string; acquiredAt: string; qty: number; cost: number | null }[]) => {
		const out = new Map<string, { qty: number; cost: number | null }>();
		for (const x of xs) {
			const key = `${x.wallet}|${x.acquiredAt}`;
			const a = out.get(key) ?? { qty: 0, cost: 0 };
			a.qty += x.qty;
			a.cost = a.cost === null || x.cost === null ? null : a.cost + x.cost;
			out.set(key, a);
		}
		return out;
	};
	const sameLeft = (got: Map<string, { qty: number; cost: number | null }>, want: Map<string, { qty: number; cost: number | null }>, why: string) => {
		expect([...got.keys()].sort(), why).toEqual([...want.keys()].sort());
		for (const [key, a] of got) {
			const b = must(want.get(key));
			expect(a.qty, `${why} ${key} qty`).toBeCloseTo(b.qty, 9);
			closeTo(a.cost, b.cost, `${why} ${key} cost`);
		}
	};

	it('one pool, before and after any boundary: the same slices as plain FIFO per asset, with or without moves and fees', () => {
		for (const seed of SEEDS) {
			// A move that lands more than it carried adds no lot to one pool, and selling those units would be
			// unmatched (the model has no unmatched), so these histories have fees but no surplus.
			const events = generate(seed, { wallets: WALLETS, moves: true, fees: true, surplus: false });
			const r = runLotLedger(events, { perWalletFrom: null });
			const ref = reference(events, false);
			sameSlices(r.slices, ref.slices, `seed ${seed}`);
			expect(r.unmatched, `seed ${seed}`).toEqual([]);
			// What is left is the same units and basis, date by date (one pool keeps the wallet of purchase, so wallets are set aside).
			const noWallet = (xs: { acquiredAt: string; qty: number; cost: number | null }[]) => leftOver(xs.map((x) => ({ ...x, wallet: '*' })));
			sameLeft(noWallet(open(r).map((l) => ({ acquiredAt: l.acquiredAt, qty: l.remainingQty, cost: l.remainingCostUsd }))), noWallet(ref.open), `seed ${seed} left`);
		}
	});

	it("one pool: the same slices as the pipeline's own runFifo (pass 4) on buy and sell histories, apart from the dust slices it leaves behind", () => {
		let dust = 0;
		for (const seed of SEEDS) {
			const events = generate(seed, { wallets: WALLETS, moves: false });
			const rows: RawImportTx[] = [];
			const classifications = new Map<string, ClassificationResult>();
			for (const e of events) {
				if (e.kind === 'move' || e.kind === 'sendUnmatched') continue;
				const buy = e.kind === 'acquire';
				rows.push({
					id: e.id, asset_symbol: e.asset, direction: buy ? 'in' : 'out', kind: buy ? 'Buy' : 'Sell', amount: e.qty, to_amount: null,
					native_usd: buy ? e.costUsd : e.proceedsUsd, tx_hash: null, source: 'coinbase', notes: null, category: null, description: null, timestamp_utc: e.at,
				});
				classifications.set(`import:${e.id}`, { sourceType: 'import', sourceId: e.id, category: buy ? 'buy' : 'sell', confidence: 1 });
			}
			const pipeline = runFifo('tenant-1', rows, [], classifications);
			const lotDate = new Map(pipeline.lots.map((l) => [l.id, l.acquiredAt]));
			const want = pipeline.disposals.filter((d) => d.quantity > EPSILON).map((d) => ({ ref: d.sourceId, acquiredAt: ms(lotDate.get(d.lotId) as string), qty: d.quantity, cost: d.costBasisUsd, proceeds: d.proceedsUsd, term: d.isShortTerm ? 'short' : 'long' }));
			dust += pipeline.disposals.filter((d) => d.quantity <= EPSILON).length;
			const got = runLotLedger(events, { perWalletFrom: null }).slices.map((x) => ({ ref: x.sourceRef.replace(/^src:/, ''), acquiredAt: ms(x.acquiredAt), qty: x.qty, cost: x.cost, proceeds: x.proceeds, term: x.term }));
			const order = (a: { ref: string; acquiredAt: number }, b: { ref: string; acquiredAt: number }) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : a.acquiredAt - b.acquiredAt);
			got.sort(order);
			want.sort(order);
			expect(got.length, `seed ${seed}: slice count`).toBe(want.length);
			got.forEach((g, i) => {
				const w = want[i];
				expect([g.ref, g.acquiredAt, g.term], `seed ${seed} slice ${i}`).toEqual([w.ref, w.acquiredAt, w.term]);
				expect(g.qty, `seed ${seed} slice ${i} qty`).toBeCloseTo(w.qty, 9);
				closeTo(g.cost, w.cost, `seed ${seed} slice ${i} cost`);
				closeTo(g.proceeds, w.proceeds, `seed ${seed} slice ${i} proceeds`);
			});
		}
		// Today's engine leaves float dust behind (a lot of 2.8e-17 that a later sale then "consumes" as a slice of its own);
		// the ledger takes a lot with dust left whole. The histories do produce such slices, so the filter above is not vacuous.
		// When runFifo is rebuilt on this core it emits no dust slices: drop this line then.
		expect(dust).toBeGreaterThan(0);
	});

	it('per wallet, for histories after the boundary: sales, moves with their fees, and what is left all match the plain model', () => {
		const start = Date.UTC(2025, 0, 2);
		for (const seed of SEEDS) {
			// Moves land within six hours; events are a day or more apart, so each has landed before the next.
			const events = generate(seed, { wallets: WALLETS, moves: true, fees: true, start, count: 24 });
			const r = runLotLedger(events, PW);
			const ref = reference(events, true);
			sameSlices(r.slices, ref.slices, `seed ${seed}`);
			expect(r.unmatched, `seed ${seed}`).toEqual([]);
			sameLeft(leftOver(open(r).map((l) => ({ wallet: l.wallet, acquiredAt: l.acquiredAt, qty: l.remainingQty, cost: l.remainingCostUsd }))), leftOver(ref.open), `seed ${seed} left`);
		}
	});

	it('a snapshot after the last event is the open lots', () => {
		for (const seed of SEEDS.slice(0, 30)) {
			const events = generate(seed, { wallets: WALLETS, moves: true, fees: true });
			const r = runLotLedger(events, { ...PW, snapshotsAt: ['2030-01-01T00:00:00Z'] });
			expect(must(r.snapshots[0]).lots.map((l) => [l.lotId, l.wallet, l.qty, l.costUsd]), `seed ${seed}`).toEqual(
				open(r)
					.sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0) || (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0) || ms(a.acquiredAt) - ms(b.acquiredAt) || (a.id < b.id ? -1 : 1))
					.map((l) => [l.id, l.wallet, l.remainingQty, l.remainingCostUsd]),
			);
		}
	});
});
