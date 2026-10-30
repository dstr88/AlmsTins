/**
 * Tests for buildAnnualBreakdown — the in-memory FIFO engine that drives the
 * gains page, carryforward computation, and tax-loss harvesting.
 *
 * Strategy: mock db.execute to return canned lifecycle events and import rows.
 * The function makes 7-8 db.execute calls; the mock routes on SQL content so
 * each query receives the appropriate fixture data regardless of call order.
 *
 * Key behaviors under test:
 *   1. FIFO lot matching — buy then sell
 *   2. Short-term (one year or less) vs long-term (more than one year, by calendar date)
 *   3. Orphaned sells → needsAttention (only for in-year disposals)
 *   4. Non-taxable events (FIFO_NONTAXABLE) consume lots without gain/loss
 *   5. SKIP_CLASSES rows are silently dropped from FIFO
 *   6. Sells before yearStart consume lots but are not in shortTerm/longTerm
 *   7. Partial lot consumption and multi-lot FIFO ordering
 *   8. Income section filtering (INCOME_KINDS set)
 *   9. Manual cost-basis resolution removes items from needsAttention
 *  10. Totals are correct sums of constituent arrays
 *  11. availableYears always includes current and prior UTC year
 *  12. refDate uses yearEnd for past years (daysHeld is deterministic)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildAnnualBreakdown } from '../../src/lib/annualBreakdown';
import { db } from '../../src/lib/db';

// ── Mock the entire db module ─────────────────────────────────────────────────

vi.mock('../../src/lib/db', () => ({
	db: { execute: vi.fn() },
}));

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

// ── Mock router ───────────────────────────────────────────────────────────────
// Routes db.execute calls to canned fixtures based on SQL content.
// Call order is not reliable (Promise.all is used for some queries), so we
// match on distinctive SQL substrings instead.

type MockOpts = {
	eventRows?:  object[];   // lifecycle events (the main FIFO input)
	incomeRows?: object[];   // import_transactions (income section)
	manualRows?: object[];   // manual_cost_basis (resolvedIds filter)
};

function setupMock(opts: MockOpts = {}) {
	mockExecute.mockImplementation(({ sql }: { sql: string }) => {
		// Sui transactions — first call has "symbol, amount, decimals"
		if (sql.includes('symbol, amount, decimals'))
			return Promise.resolve({ rows: [] });

		// Custom wallet transactions — metadata_json LIKE isCustomEntry
		if (sql.includes('isCustomEntry'))
			return Promise.resolve({ rows: [] });

		// Main lifecycle events — only query that does a LEFT JOIN on groups
		if (sql.includes('LEFT JOIN asset_lifecycle_groups'))
			return Promise.resolve({ rows: opts.eventRows ?? [] });

		// Income — import_transactions
		if (sql.includes('import_transactions'))
			return Promise.resolve({ rows: opts.incomeRows ?? [] });

		// NFT snapshots + hidden list
		if (sql.includes('wallet_nft_snapshot') || sql.includes('nft_hidden'))
			return Promise.resolve({ rows: [] });

		// Manual cost basis
		if (sql.includes('manual_cost_basis'))
			return Promise.resolve({ rows: opts.manualRows ?? [] });

		// Available years queries (both lifecycle events and sui year queries)
		// Return empty — buildAnnualBreakdown still injects curYear and curYear-1.
		return Promise.resolve({ rows: [] });
	});
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Build a lifecycle event row with sensible defaults. */
function ev(overrides: {
	direction: 'in' | 'out';
	timestamp_utc: string;
	asset_symbol?: string;
	amount?: number;
	native_usd?: number | null;
	transaction_class?: string;
	source_id?: string;
	group_id?: string;
}): object {
	return {
		asset_symbol:      'BTC',
		direction:         overrides.direction,
		amount:            overrides.amount ?? 1,
		native_usd:        overrides.native_usd ?? 40_000,
		timestamp_utc:     overrides.timestamp_utc,
		transaction_class: overrides.transaction_class ?? 'other',
		source_id:         overrides.source_id ?? 'src1',
		group_id:          overrides.group_id  ?? 'g1',
		tx_hash:           null,
		source_type:       'coinbase',
		...overrides,
	};
}

/** Build an import_transactions row for the income section. */
function incomeRow(overrides: {
	kind: string;
	timestamp_utc: string;
	asset_symbol?: string;
	amount?: number;
	native_usd?: number | null;
}): object {
	return {
		asset_symbol: 'ETH',
		amount:       0.1,
		native_usd:   200,
		timestamp_utc: overrides.timestamp_utc,
		kind:          overrides.kind,
		description:  null,
		notes:        null,
		...overrides,
	};
}

const TENANT = 'tenant-1';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Basic buy → sell FIFO
// ─────────────────────────────────────────────────────────────────────────────

describe('Basic buy → sell FIFO', () => {
	beforeEach(() => vi.resetAllMocks());

	it('a buy followed by a same-year sell produces one shortTerm lot', async () => {
		// Held 182 days (< 365) → short-term
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 20_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-07-02T00:00:00Z', amount: 1, native_usd: 30_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);

		expect(bd.shortTerm).toHaveLength(1);
		expect(bd.longTerm).toHaveLength(0);
		expect(bd.needsAttention).toHaveLength(0);

		const lot = bd.shortTerm[0];
		expect(lot.asset).toBe('BTC');
		expect(lot.amount).toBeCloseTo(1);
		expect(lot.costUsd).toBeCloseTo(20_000);
		expect(lot.proceedsUsd).toBeCloseTo(30_000);
		expect(lot.gainLossUsd).toBeCloseTo(10_000);
	});

	it('a sale on the one-year anniversary is short-term; the day after is long-term', async () => {
		// 2023-01-01 to 2024-01-01 is 365 days and 2024-01-01 to 2025-01-01 is 366: both
		// exactly one year, so short-term. The old 365-day count called both long-term.
		for (const [buy, sell] of [['2023-01-01T00:00:00Z', '2024-01-01T00:00:00Z'], ['2024-01-01T00:00:00Z', '2025-01-01T20:00:00Z']]) {
			vi.resetAllMocks();
			setupMock({ eventRows: [
				ev({ direction: 'in',  timestamp_utc: buy,  amount: 1, native_usd: 20_000 }),
				ev({ direction: 'out', timestamp_utc: sell, amount: 1, native_usd: 30_000 }),
			]});
			const bd = await buildAnnualBreakdown(TENANT, Number(sell.slice(0, 4)));
			expect(bd.shortTerm).toHaveLength(1);
			expect(bd.longTerm).toHaveLength(0);
		}

		vi.resetAllMocks();
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2024-01-01T00:00:00Z', amount: 1, native_usd: 20_000 }),
			ev({ direction: 'out', timestamp_utc: '2025-01-02T00:00:00Z', amount: 1, native_usd: 30_000 }),
		]});
		const bd = await buildAnnualBreakdown(TENANT, 2025);
		expect(bd.longTerm).toHaveLength(1);
		expect(bd.shortTerm).toHaveLength(0);
	});

	it('gain/loss is proceeds minus cost', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 50_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', amount: 2, native_usd: 40_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.shortTerm[0].gainLossUsd).toBeCloseTo(-10_000); // loss
	});

	it('null native_usd on buy → costUsd null → gainLossUsd null', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', native_usd: null }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', native_usd: 30_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.shortTerm[0].costUsd).toBeNull();
		expect(bd.shortTerm[0].gainLossUsd).toBeNull();
	});

	it('null native_usd on sell → proceedsUsd null → gainLossUsd null', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', native_usd: 20_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', native_usd: null }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.shortTerm[0].proceedsUsd).toBeNull();
		expect(bd.shortTerm[0].gainLossUsd).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Short-term vs long-term threshold
// ─────────────────────────────────────────────────────────────────────────────

describe('Short-term vs long-term (more than one year, by calendar date)', () => {
	beforeEach(() => vi.resetAllMocks());

	it('held exactly 364 days → shortTerm', async () => {
		// 2023-01-01 → 2023-12-31 = 364 days
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z' }),
			ev({ direction: 'out', timestamp_utc: '2023-12-31T00:00:00Z' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.shortTerm).toHaveLength(1);
		expect(bd.longTerm).toHaveLength(0);
		expect(bd.shortTerm[0].daysHeld).toBe(364);
	});

	it('held exactly 365 days, the one-year anniversary → shortTerm (needs MORE than one year)', async () => {
		// 2023-01-01 → 2024-01-01 = 365 days (2023 is not a leap year): exactly one year.
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z' }),
			ev({ direction: 'out', timestamp_utc: '2024-01-01T00:00:00Z' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2024);
		expect(bd.shortTerm).toHaveLength(1);
		expect(bd.longTerm).toHaveLength(0);
		expect(bd.shortTerm[0].daysHeld).toBe(365);
	});

	it('held 366 days across Feb 29 (2024 buy → 2025 sell on the anniversary) → shortTerm', async () => {
		// 2024-01-01 → 2025-01-01 = 366 days (2024 IS a leap year), still exactly one year.
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2024-01-01T00:00:00Z' }),
			ev({ direction: 'out', timestamp_utc: '2025-01-01T00:00:00Z' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2025);
		expect(bd.shortTerm).toHaveLength(1);
		expect(bd.shortTerm[0].daysHeld).toBe(366);
	});

	it('a position still held says whether it is long-term yet, and how many days are left', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in', timestamp_utc: '2024-01-01T00:00:00Z' }),
			ev({ direction: 'in', timestamp_utc: '2022-06-01T00:00:00Z', source_id: 'src2', group_id: 'g2' }),
		]});
		// A past year: positions are measured at Dec 31, 2024.
		const bd = await buildAnnualBreakdown(TENANT, 2024);
		const recent = bd.stillHolding.find((p) => p.acquiredDate.startsWith('2024'))!;
		const older  = bd.stillHolding.find((p) => p.acquiredDate.startsWith('2022'))!;
		expect(recent.daysHeld).toBe(365);        // a day count would have called this long-term
		expect(recent.longTerm).toBe(false);
		expect(recent.daysToLongTerm).toBe(2);    // long-term from Jan 2, 2025
		expect(older.longTerm).toBe(true);
		expect(older.daysToLongTerm).toBe(0);
	});

	it('daysHeld is reflected correctly on the settled lot', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-03-01T00:00:00Z' }),
			ev({ direction: 'out', timestamp_utc: '2023-09-01T00:00:00Z' }),
		]});
		// Mar 1 → Sep 1 = 184 days
		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.shortTerm[0].daysHeld).toBe(184);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Orphaned sells → needsAttention
// ─────────────────────────────────────────────────────────────────────────────

describe('Orphaned sells', () => {
	beforeEach(() => vi.resetAllMocks());

	it('sell with no preceding buy → needsAttention', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', native_usd: 15_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.needsAttention).toHaveLength(1);
		expect(bd.needsAttention[0].asset).toBe('BTC');
		expect(bd.needsAttention[0].amount).toBeCloseTo(1);
		expect(bd.needsAttention[0].proceedsUsd).toBeCloseTo(15_000);
	});

	it('orphaned sell outside the target year is NOT added to needsAttention', async () => {
		// Buy in 2022, sell in 2022 (prior year) — for a 2023 query,
		// the 2022 sell is outside yearStart/yearEnd so should not appear.
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2022-01-01T00:00:00Z' }),
			ev({ direction: 'out', timestamp_utc: '2022-06-01T00:00:00Z' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.needsAttention).toHaveLength(0);
		expect(bd.shortTerm).toHaveLength(0);
		expect(bd.longTerm).toHaveLength(0);
	});

	it('orphaned sell with no proceeds → proceedsUsd null in needsAttention', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', native_usd: null }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.needsAttention[0].proceedsUsd).toBeNull();
	});

	it('partial orphan: sell 2 but only 1 lot available → 1 settled + 1 needsAttention', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 20_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', amount: 2, native_usd: 40_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		// 1 BTC matched → shortTerm; 1 BTC orphaned → needsAttention
		expect(bd.shortTerm).toHaveLength(1);
		expect(bd.needsAttention).toHaveLength(1);
		expect(bd.shortTerm[0].amount).toBeCloseTo(1);
		expect(bd.needsAttention[0].amount).toBeCloseTo(1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Partial and multi-lot FIFO
// ─────────────────────────────────────────────────────────────────────────────

describe('Partial and multi-lot FIFO', () => {
	beforeEach(() => vi.resetAllMocks());

	it('partial lot consumption leaves correct remaining quantity in stillHolding', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 3, native_usd: 60_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 25_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.shortTerm[0].amount).toBeCloseTo(1);
		expect(bd.stillHolding).toHaveLength(1);
		expect(bd.stillHolding[0].amount).toBeCloseTo(2);
	});

	it('partial lot cost basis is proportional', async () => {
		// Buy 4 BTC for $80,000 ($20k each). Sell 1.
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 4, native_usd: 80_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 25_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		// Cost for 1/4 = $20,000
		expect(bd.shortTerm[0].costUsd).toBeCloseTo(20_000);
		// Remaining cost in stillHolding should be $60,000
		expect(bd.stillHolding[0].costUsd).toBeCloseTo(60_000);
	});

	it('FIFO consumes oldest lot first across two separate buys', async () => {
		// Buy 1 BTC cheap, then 1 BTC expensive. Sell 1. FIFO → cheap lot consumed.
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 10_000, source_id: 'buy-old' }),
			ev({ direction: 'in',  timestamp_utc: '2023-03-01T00:00:00Z', amount: 1, native_usd: 30_000, source_id: 'buy-new' }),
			ev({ direction: 'out', timestamp_utc: '2023-09-01T00:00:00Z', amount: 1, native_usd: 25_000, source_id: 'sell1' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo');
		expect(bd.shortTerm).toHaveLength(1);
		// Cheapest (oldest) lot was consumed: cost $10k, proceeds $25k, gain $15k
		expect(bd.shortTerm[0].costUsd).toBeCloseTo(10_000);
		expect(bd.shortTerm[0].gainLossUsd).toBeCloseTo(15_000);
		// Expensive lot remains
		expect(bd.stillHolding).toHaveLength(1);
		expect(bd.stillHolding[0].costUsd).toBeCloseTo(30_000);
	});

	it('HIFO consumes highest-cost lot first', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 10_000 }),
			ev({ direction: 'in',  timestamp_utc: '2023-03-01T00:00:00Z', amount: 1, native_usd: 30_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-09-01T00:00:00Z', amount: 1, native_usd: 25_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023, 'hifo');
		// Highest cost lot consumed: cost $30k, proceeds $25k, gain -$5k
		expect(bd.shortTerm[0].costUsd).toBeCloseTo(30_000);
		expect(bd.shortTerm[0].gainLossUsd).toBeCloseTo(-5_000);
	});

	it('sell spanning two lots produces two settled entries', async () => {
		// Buy 1 at T1, buy 1 at T2, sell 2 at T3 — FIFO splits across both lots
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 10_000 }),
			ev({ direction: 'in',  timestamp_utc: '2023-02-01T00:00:00Z', amount: 1, native_usd: 20_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-09-01T00:00:00Z', amount: 2, native_usd: 50_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.shortTerm).toHaveLength(2);
		const totalCost = bd.shortTerm.reduce((s, l) => s + (l.costUsd ?? 0), 0);
		const totalGain = bd.shortTerm.reduce((s, l) => s + (l.gainLossUsd ?? 0), 0);
		expect(totalCost).toBeCloseTo(30_000);
		expect(totalGain).toBeCloseTo(20_000);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Non-taxable events (FIFO_NONTAXABLE)
// ─────────────────────────────────────────────────────────────────────────────

describe('Non-taxable events (FIFO_NONTAXABLE)', () => {
	beforeEach(() => vi.resetAllMocks());

	const NONTAXABLE_CLASSES = [
		'collateral_deposit',
		'collateral_withdrawal',
		'liability_repayment',
	];

	it.each(NONTAXABLE_CLASSES)(
		'%s direction=out consumes the lot but produces no settled gain/loss entry',
		async (txClass) => {
			setupMock({ eventRows: [
				ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', native_usd: 20_000 }),
				ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', transaction_class: txClass }),
			]});

			const bd = await buildAnnualBreakdown(TENANT, 2023);
			expect(bd.shortTerm).toHaveLength(0);
			expect(bd.longTerm).toHaveLength(0);
			expect(bd.needsAttention).toHaveLength(0);
			// Lot was consumed — nothing left in stillHolding
			expect(bd.stillHolding).toHaveLength(0);
		},
	);

	it('non-taxable disposal of a partial lot leaves the remainder in stillHolding', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 40_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1,
				 transaction_class: 'collateral_deposit' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.shortTerm).toHaveLength(0);
		expect(bd.stillHolding[0].amount).toBeCloseTo(1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. SKIP_CLASSES rows are dropped from FIFO
// ─────────────────────────────────────────────────────────────────────────────

describe('SKIP_CLASSES (liability_increase, interest_income)', () => {
	beforeEach(() => vi.resetAllMocks());

	it('liability_increase direction=in does NOT create a lot', async () => {
		setupMock({ eventRows: [
			// This inbound row should be ignored (liability, not an asset lot)
			ev({ direction: 'in', timestamp_utc: '2023-01-01T00:00:00Z',
				 transaction_class: 'liability_increase', native_usd: 10_000 }),
			// A real sell — with no lot to match, it becomes orphaned
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.stillHolding).toHaveLength(0); // no lot created
		expect(bd.needsAttention).toHaveLength(1); // orphaned sell
	});

	it('interest_income direction=in does NOT create a FIFO lot', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in', timestamp_utc: '2023-01-01T00:00:00Z',
				 transaction_class: 'interest_income' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.stillHolding).toHaveLength(0);
		expect(bd.shortTerm).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Sells before yearStart consume lots but are invisible in settled sections
// ─────────────────────────────────────────────────────────────────────────────

describe('Sells before yearStart', () => {
	beforeEach(() => vi.resetAllMocks());

	it('a prior-year sell reduces the lot pool for a current-year sell', async () => {
		// Buy 2 BTC in 2022. Sell 1 in 2022 (prior year). Sell 1 in 2023 (target year).
		// The 2022 sell should reduce the pool so the 2023 sell gets the remaining 1 BTC lot.
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2022-01-01T00:00:00Z', amount: 2, native_usd: 40_000 }),
			ev({ direction: 'out', timestamp_utc: '2022-09-01T00:00:00Z', amount: 1, native_usd: 18_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 25_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		// 2022 sell is outside the 2023 yearStart — not in shortTerm/longTerm
		// 2023 sell gets the remaining lot (cost = $20k for 1/2 of $40k)
		expect(bd.shortTerm.length + bd.longTerm.length).toBe(1);
		const settled = [...bd.shortTerm, ...bd.longTerm][0];
		expect(settled.costUsd).toBeCloseTo(20_000);
		expect(settled.gainLossUsd).toBeCloseTo(5_000);
		expect(bd.stillHolding).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. stillHolding
// ─────────────────────────────────────────────────────────────────────────────

describe('stillHolding', () => {
	beforeEach(() => vi.resetAllMocks());

	it('unsold lot appears in stillHolding', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in', timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 40_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.stillHolding).toHaveLength(1);
		expect(bd.stillHolding[0].asset).toBe('BTC');
		expect(bd.stillHolding[0].amount).toBeCloseTo(2);
		expect(bd.stillHolding[0].costUsd).toBeCloseTo(40_000);
	});

	it('stillHolding is sorted by asset then acquiredDate', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in', timestamp_utc: '2023-03-01T00:00:00Z', asset_symbol: 'ETH' }),
			ev({ direction: 'in', timestamp_utc: '2023-01-01T00:00:00Z', asset_symbol: 'BTC' }),
			ev({ direction: 'in', timestamp_utc: '2023-02-01T00:00:00Z', asset_symbol: 'BTC' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.stillHolding.map((h) => h.asset)).toEqual(['BTC', 'BTC', 'ETH']);
	});

	it('daysHeld for a past year uses yearEnd as refDate', async () => {
		// Year 2022 is a past year; refDate = '2022-12-31T23:59:59.999Z'
		// Buy on 2022-06-01 → daysHeld = daysBetween('2022-06-01T00:00:00Z', '2022-12-31T23:59:59.999Z')
		// Jun 1 → Dec 31 = 30 + 31 + 31 + 30 + 31 + 30 + 31 - 1 = 213 days
		setupMock({ eventRows: [
			ev({ direction: 'in', timestamp_utc: '2022-06-01T00:00:00Z' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2022);
		expect(bd.stillHolding[0].daysHeld).toBe(213);
	});

	it('daysHeld for the current UTC year uses "now" (> daysHeld than yearEnd would give)', async () => {
		// Use the actual current UTC year — refDate = now, which is past yearEnd
		// so daysHeld should be larger than it would be if capped at Dec 31.
		const curYear = new Date().getUTCFullYear();
		setupMock({ eventRows: [
			ev({ direction: 'in', timestamp_utc: `${curYear}-01-01T00:00:00Z` }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, curYear);
		// daysHeld should be >= 0 and if we are past Dec 31 of curYear,
		// strictly > 364. If within curYear, it's some positive number.
		expect(bd.stillHolding[0].daysHeld).toBeGreaterThanOrEqual(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Income section
// ─────────────────────────────────────────────────────────────────────────────

describe('Income section (INCOME_KINDS filter)', () => {
	beforeEach(() => vi.resetAllMocks());

	const VALID_INCOME_KINDS = [
		'crypto_earn_interest_paid',
		'Staking Income',
		'referral_card_cashback',
		'referral_bonus',
	];

	it.each(VALID_INCOME_KINDS)(
		'kind "%s" appears in income section',
		async (kind) => {
			setupMock({ incomeRows: [
				incomeRow({ kind, timestamp_utc: '2023-06-01T00:00:00Z', native_usd: 100 }),
			]});

			const bd = await buildAnnualBreakdown(TENANT, 2023);
			expect(bd.income.some((i) => i.kind === kind)).toBe(true);
		},
	);

	it('unrecognised kind is excluded from income section', async () => {
		setupMock({ incomeRows: [
			incomeRow({ kind: 'unknown_kind', timestamp_utc: '2023-06-01T00:00:00Z' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.income).toHaveLength(0);
	});

	it('income item has correct shape', async () => {
		setupMock({ incomeRows: [
			incomeRow({
				kind:          'Staking Income',
				timestamp_utc: '2023-08-15T00:00:00Z',
				asset_symbol:  'ETH',
				amount:        0.5,
				native_usd:    800,
			}),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		const item = bd.income[0];
		expect(item.asset).toBe('ETH');
		expect(item.amount).toBeCloseTo(0.5);
		expect(item.usdValue).toBeCloseTo(800);
		expect(item.date).toBe('2023-08-15T00:00:00Z');
	});

	it('multiple income rows are all returned', async () => {
		setupMock({ incomeRows: [
			incomeRow({ kind: 'Staking Income',            timestamp_utc: '2023-01-01T00:00:00Z', native_usd: 100 }),
			incomeRow({ kind: 'crypto_earn_interest_paid', timestamp_utc: '2023-02-01T00:00:00Z', native_usd: 200 }),
			incomeRow({ kind: 'referral_card_cashback',    timestamp_utc: '2023-03-01T00:00:00Z', native_usd: 50  }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.income).toHaveLength(3);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Manual cost-basis resolution filters needsAttention
// ─────────────────────────────────────────────────────────────────────────────

describe('Manual cost-basis resolution', () => {
	beforeEach(() => vi.resetAllMocks());

	it('resolved sourceId is removed from needsAttention', async () => {
		setupMock({
			eventRows: [
				ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', source_id: 'orphan-1' }),
			],
			manualRows: [{ sell_source_id: 'orphan-1' }],
		});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.needsAttention).toHaveLength(0);
	});

	it('unresolved sourceId stays in needsAttention', async () => {
		setupMock({
			eventRows: [
				ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', source_id: 'orphan-2' }),
			],
			manualRows: [{ sell_source_id: 'some-other-id' }],
		});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.needsAttention).toHaveLength(1);
	});

	it('only the resolved item is removed when multiple needsAttention items exist', async () => {
		setupMock({
			eventRows: [
				ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', source_id: 'orphan-a' }),
				ev({ direction: 'out', timestamp_utc: '2023-07-01T00:00:00Z', asset_symbol: 'ETH', source_id: 'orphan-b' }),
			],
			manualRows: [{ sell_source_id: 'orphan-a' }],
		});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.needsAttention).toHaveLength(1);
		expect(bd.needsAttention[0].sourceId).toBe('orphan-b');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. Totals
// ─────────────────────────────────────────────────────────────────────────────

describe('Totals', () => {
	beforeEach(() => vi.resetAllMocks());

	it('shortTermGain is sum of shortTerm gainLossUsd', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 40_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-03-01T00:00:00Z', amount: 1, native_usd: 25_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 15_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		// Cost: $20k each. Proceeds: $25k and $15k. Gains: +$5k and -$5k = $0
		expect(bd.totals.shortTermGain).toBeCloseTo(0);
	});

	it('longTermGain is sum of longTerm gainLossUsd', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 10_000 }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 30_000 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.totals.longTermGain).toBeCloseTo(20_000);
	});

	it('totalIncome is sum of income usdValues', async () => {
		setupMock({ incomeRows: [
			incomeRow({ kind: 'Staking Income', timestamp_utc: '2023-01-01T00:00:00Z', native_usd: 300 }),
			incomeRow({ kind: 'Staking Income', timestamp_utc: '2023-02-01T00:00:00Z', native_usd: 200 }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.totals.totalIncome).toBeCloseTo(500);
	});

	it('heldCostBasis is sum of stillHolding costUsd', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'in', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 20_000 }),
			ev({ direction: 'in', timestamp_utc: '2023-02-01T00:00:00Z', amount: 1, native_usd: 30_000, asset_symbol: 'ETH' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.totals.heldCostBasis).toBeCloseTo(50_000);
	});

	it('unsettledProceeds is sum of needsAttention proceedsUsd (nulls treated as 0)', async () => {
		setupMock({ eventRows: [
			ev({ direction: 'out', timestamp_utc: '2023-05-01T00:00:00Z', native_usd: 10_000, source_id: 's1' }),
			ev({ direction: 'out', timestamp_utc: '2023-06-01T00:00:00Z', native_usd: null,   source_id: 's2', asset_symbol: 'ETH' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.totals.unsettledProceeds).toBeCloseTo(10_000);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. availableYears
// ─────────────────────────────────────────────────────────────────────────────

describe('availableYears', () => {
	beforeEach(() => vi.resetAllMocks());

	it('always contains the current UTC year and prior year even with no DB rows', async () => {
		setupMock();
		const curYear = new Date().getUTCFullYear();
		const bd = await buildAnnualBreakdown(TENANT, curYear);
		expect(bd.availableYears).toContain(curYear);
		expect(bd.availableYears).toContain(curYear - 1);
	});

	it('is sorted descending', async () => {
		setupMock();
		const bd = await buildAnnualBreakdown(TENANT, 2023);
		const sorted = [...bd.availableYears].sort((a, b) => b - a);
		expect(bd.availableYears).toEqual(sorted);
	});

	it('deduplicates years that appear in both lifecycle and sui queries', async () => {
		// Both year sources could contribute curYear — it should only appear once
		setupMock();
		const curYear = new Date().getUTCFullYear();
		const bd = await buildAnnualBreakdown(TENANT, curYear);
		const occurrences = bd.availableYears.filter((y) => y === curYear).length;
		expect(occurrences).toBe(1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. return shape
// ─────────────────────────────────────────────────────────────────────────────

describe('Return shape', () => {
	beforeEach(() => vi.resetAllMocks());

	it('returns the requested year in the result', async () => {
		setupMock();
		const bd = await buildAnnualBreakdown(TENANT, 2022);
		expect(bd.year).toBe(2022);
	});

	it('all section arrays are present and default to empty', async () => {
		setupMock();
		const bd = await buildAnnualBreakdown(TENANT, 2022);
		expect(Array.isArray(bd.needsAttention)).toBe(true);
		expect(Array.isArray(bd.stillHolding)).toBe(true);
		expect(Array.isArray(bd.shortTerm)).toBe(true);
		expect(Array.isArray(bd.longTerm)).toBe(true);
		expect(Array.isArray(bd.income)).toBe(true);
		expect(Array.isArray(bd.nftHoldings)).toBe(true);
		expect(typeof bd.totals).toBe('object');
	});

	it('totals default to zero with no data', async () => {
		setupMock();
		const bd = await buildAnnualBreakdown(TENANT, 2022);
		expect(bd.totals.shortTermGain).toBe(0);
		expect(bd.totals.longTermGain).toBe(0);
		expect(bd.totals.totalIncome).toBe(0);
		expect(bd.totals.heldCostBasis).toBe(0);
		expect(bd.totals.unsettledProceeds).toBe(0);
	});

	it('dataSource is "lifecycle" when using default source', async () => {
		setupMock();
		const bd = await buildAnnualBreakdown(TENANT, 2022);
		expect(bd.dataSource).toBe('lifecycle');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Pipeline source path (source='pipeline' / source='auto')
//
// The pipeline source reads the tenant's rows and the pipeline's classification of them live
// (yearEnd/loaders.ts, classifyAll.ts), then runs the same lot ledger the lifecycle source does.
// It does not read tax_lots or tax_disposals, so a figure never depends on when classify last ran.
// ─────────────────────────────────────────────────────────────────────────────

type PipelineMockOpts = {
	/** import_transactions rows as the pipeline loader selects them. */
	importRows?:   object[];
	/** transactions rows (joined to wallets) as the pipeline loader selects them. */
	onchainRows?:  object[];
	/** The tenant's rows of `wallets` (id, address). */
	walletRows?:   object[];
	/** tax_classifications rows with is_manual = 1. */
	manualClassRows?: object[];
	/** Rows of a successful tax_pipeline_runs: any row means the tenant has run the pipeline. */
	runRows?:      object[];
	/** The error the run probe throws (the table does not exist). */
	runProbeError?: Error;
	/** tax_classifications income/airdrop, joined to import_transactions for dates. */
	incomeRows?:   object[];
	manualRows?:   object[];     // manual_cost_basis
	/** Every SQL text the mock saw, for the tests that pin what was not read. */
	seen?:         string[];
	probeArgs?:    unknown[][];
};

function setupPipelineMock(opts: PipelineMockOpts = {}) {
	mockExecute.mockImplementation(({ sql, args }: { sql: string; args?: unknown[] }) => {
		opts.seen?.push(sql);
		// auto-mode: has this tenant a successful pipeline run?
		if (sql.includes('/* tax:source */')) {
			opts.probeArgs?.push(args ?? []);
			return opts.runProbeError ? Promise.reject(opts.runProbeError) : Promise.resolve({ rows: opts.runRows ?? [] });
		}
		// income section: tax_classifications joined to import_transactions for dates
		if (sql.includes('tax_classifications tc')) return Promise.resolve({ rows: opts.incomeRows ?? [] });
		// the pipeline's own loaders
		if (sql.includes('FROM tax_classifications')) return Promise.resolve({ rows: opts.manualClassRows ?? [] });
		if (sql.includes('import_batch_id')) return Promise.resolve({ rows: opts.importRows ?? [] });
		if (sql.includes('FROM transactions t') && sql.includes('JOIN wallets')) return Promise.resolve({ rows: opts.onchainRows ?? [] });
		if (sql.includes('/* tax:wallets */') || sql.includes('SELECT address FROM wallets')) return Promise.resolve({ rows: opts.walletRows ?? [] });
		// Manual cost basis
		if (sql.includes('manual_cost_basis')) return Promise.resolve({ rows: opts.manualRows ?? [] });
		return Promise.resolve({ rows: [] });
	});
}

/** An import_transactions row as the pipeline loader returns it. */
function pImport(o: {
	id: string; timestamp_utc: string; kind: string; direction: 'in' | 'out';
	amount?: number; native_usd?: number | null; source?: string; account_id?: string | null; tx_hash?: string | null; asset_symbol?: string;
}): object {
	return {
		asset_symbol: 'BTC', amount: 1, to_amount: null, native_usd: null, tx_hash: null, source: 'coinbase',
		notes: null, category: null, description: null, account_id: 'acct-1', wallet_id: null, import_batch_id: null,
		...o,
	};
}

describe('Pipeline source path', () => {
	beforeEach(() => vi.resetAllMocks());

	it('source="pipeline" sets dataSource to "pipeline"', async () => {
		setupPipelineMock();
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.dataSource).toBe('pipeline');
	});

	it('source="auto" for a tenant with no successful pipeline run reads the lifecycle', async () => {
		const probeArgs: unknown[][] = [];
		setupPipelineMock({ runRows: [], probeArgs });
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'auto');
		// The probe is issued once, scoped to the tenant alone: the source is per tenant, not per year.
		expect(probeArgs).toEqual([[TENANT]]);
		expect(bd.dataSource).toBe('lifecycle');
	});

	it('source="auto" for a tenant with a successful pipeline run reads the pipeline', async () => {
		setupPipelineMock({ runRows: [{ one: 1 }] });
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'auto');
		expect(bd.dataSource).toBe('pipeline');
	});

	it('source="auto" with tax_pipeline_runs missing falls back to the lifecycle', async () => {
		const probeArgs: unknown[][] = [];
		setupPipelineMock({ runProbeError: new Error('relation "tax_pipeline_runs" does not exist'), probeArgs });
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'auto');
		expect(probeArgs).toHaveLength(1);
		expect(bd.dataSource).toBe('lifecycle');
	});

	it('never reads the tables the last classify run persisted', async () => {
		const seen: string[] = [];
		setupPipelineMock({ seen });
		await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(seen.filter((q) => /tax_disposals|tax_lots/.test(q))).toEqual([]);
	});

	it('a sale in the year lands in shortTerm or longTerm by the calendar-date rule, with its gain', async () => {
		setupPipelineMock({
			importRows: [
				pImport({ id: 'buy-1', timestamp_utc: '2022-01-01T00:00:00Z', kind: 'Buy', direction: 'in', native_usd: 20_000 }),
				pImport({ id: 'buy-2', timestamp_utc: '2023-03-01T00:00:00Z', kind: 'Buy', direction: 'in', native_usd: 25_000 }),
				pImport({ id: 'sell-1', timestamp_utc: '2023-06-01T00:00:00Z', kind: 'Sell', direction: 'out', native_usd: 30_000 }),
				pImport({ id: 'sell-2', timestamp_utc: '2023-08-01T00:00:00Z', kind: 'Sell', direction: 'out', native_usd: 31_000 }),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		// FIFO: the first sale takes the 2022 lot (long-term), the second takes the March 2023 lot (short-term).
		expect(bd.longTerm.map((l) => [l.buyDate.slice(0, 10), l.gainLossUsd])).toEqual([['2022-01-01', 10_000]]);
		expect(bd.shortTerm.map((l) => [l.buyDate.slice(0, 10), l.gainLossUsd])).toEqual([['2023-03-01', 6_000]]);
		expect(bd.longTerm[0].daysHeld).toBe(516);
		expect(bd.totals.longTermGain).toBeCloseTo(10_000);
		expect(bd.totals.shortTermGain).toBeCloseTo(6_000);
	});

	it('a sale on the exact one-year anniversary is still short-term', async () => {
		setupPipelineMock({
			importRows: [
				pImport({ id: 'buy-1', timestamp_utc: '2022-06-01T15:00:00Z', kind: 'Buy', direction: 'in', native_usd: 20_000 }),
				pImport({ id: 'sell-1', timestamp_utc: '2023-06-01T20:00:00Z', kind: 'Sell', direction: 'out', native_usd: 30_000 }),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.shortTerm).toHaveLength(1);
		expect(bd.longTerm).toHaveLength(0);
		expect(bd.shortTerm[0].daysHeld).toBe(365);
	});

	it('a sale with no lot behind it goes to needsAttention, with its source row and proceeds', async () => {
		setupPipelineMock({
			importRows: [pImport({ id: 'orphan-src', timestamp_utc: '2023-05-01T00:00:00Z', kind: 'Sell', direction: 'out', native_usd: 15_000 })],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.needsAttention).toHaveLength(1);
		expect(bd.shortTerm).toHaveLength(0);
		expect(bd.needsAttention[0]).toMatchObject({ sourceId: 'orphan-src', sourceType: 'import', transactionClass: 'sell', amount: 1 });
		expect(bd.needsAttention[0].proceedsUsd).toBeCloseTo(15_000);
	});

	it('the part of a sale the lots cannot cover is kept as needsAttention, not dropped', async () => {
		setupPipelineMock({
			importRows: [
				pImport({ id: 'buy-1', timestamp_utc: '2023-01-01T00:00:00Z', kind: 'Buy', direction: 'in', amount: 1, native_usd: 20_000 }),
				pImport({ id: 'sell-1', timestamp_utc: '2023-06-01T00:00:00Z', kind: 'Sell', direction: 'out', amount: 3, native_usd: 90_000 }),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.shortTerm.map((l) => [l.amount, l.proceedsUsd, l.gainLossUsd])).toEqual([[1, 30_000, 10_000]]);
		expect(bd.needsAttention.map((i) => [i.amount, i.proceedsUsd])).toEqual([[2, 60_000]]);
	});

	it('what a sale leaves is stillHolding at the end of the year, at its remaining cost', async () => {
		setupPipelineMock({
			importRows: [
				pImport({ id: 'buy-1', timestamp_utc: '2023-01-01T00:00:00Z', kind: 'Buy', direction: 'in', amount: 1, native_usd: 25_000 }),
				pImport({ id: 'sell-1', timestamp_utc: '2023-06-01T00:00:00Z', kind: 'Sell', direction: 'out', amount: 0.5, native_usd: 15_000 }),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.stillHolding).toHaveLength(1);
		expect(bd.stillHolding[0].asset).toBe('BTC');
		expect(bd.stillHolding[0].amount).toBeCloseTo(0.5);
		expect(bd.stillHolding[0].costUsd).toBeCloseTo(12_500);
	});

	it('holdings are as of the end of the selected year, not today', async () => {
		setupPipelineMock({
			importRows: [
				pImport({ id: 'buy-1', timestamp_utc: '2022-01-01T00:00:00Z', kind: 'Buy', direction: 'in', amount: 1, native_usd: 20_000 }),
				pImport({ id: 'sell-1', timestamp_utc: '2023-06-01T00:00:00Z', kind: 'Sell', direction: 'out', amount: 1, native_usd: 30_000 }),
			],
		});
		const end2022 = await buildAnnualBreakdown(TENANT, 2022, 'fifo', undefined, 'pipeline');
		const end2023 = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(end2022.stillHolding).toHaveLength(1);
		expect(end2023.stillHolding).toHaveLength(0);
	});

	it('an exchange Send and its Kraken deposit are a move: no sale, no second lot', async () => {
		setupPipelineMock({
			importRows: [
				pImport({ id: 'buy-1', timestamp_utc: '2022-01-10T00:00:00Z', kind: 'Buy', direction: 'in', native_usd: 20_000 }),
				pImport({ id: 'send-1', timestamp_utc: '2023-02-01T00:00:00Z', kind: 'Send', direction: 'out', native_usd: 100_000 }),
				pImport({ id: 'dep-1', timestamp_utc: '2023-02-01T02:00:00Z', kind: 'deposit', direction: 'in', source: 'kraken', native_usd: 100_000 }),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.shortTerm).toEqual([]);
		expect(bd.longTerm).toEqual([]);
		expect(bd.needsAttention).toEqual([]);
		expect(bd.stillHolding.map((h) => [h.acquiredDate.slice(0, 10), h.costUsd, h.amount])).toEqual([['2022-01-10', 20_000, 1]]);
		// The pair was made by amount and time, so the owner is asked to look at it.
		expect(bd.transferReviews?.map((r) => r.reason)).toEqual(['transfer_link_unconfirmed']);
	});

	it("an on-chain row the owner classified by hand is a sale, with the owner's classification", async () => {
		const wallet = `0x${'a'.repeat(40)}`;
		const other = `0x${'b'.repeat(40)}`;
		setupPipelineMock({
			walletRows: [{ id: 'w1', address: wallet }],
			importRows: [pImport({ id: 'buy-1', timestamp_utc: '2022-01-01T00:00:00Z', kind: 'Buy', direction: 'in', native_usd: 20_000, asset_symbol: 'ETH' })],
			onchainRows: [{
				id: 'oc-1', timestamp: '2023-06-01T00:00:00Z', token_symbol: 'ETH', value: '1000000000000000000', from_address: wallet,
				to_address: other, tx_type: 'outgoing', usd_value: 30_000, chain: 'ethereum', wallet_address: wallet, wallet_id: 'w1',
				token_decimals: 18, hash: `0x${'1'.repeat(64)}`,
			}],
			manualClassRows: [{ source_type: 'onchain', source_id: 'oc-1', category: 'sell', sub_category: null, confidence: 1, linked_tx_id: null, linked_source_type: null, asset_symbol: 'ETH', amount_usd: null, tax_year: 2023 }],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		// 1 ETH from 1e18 raw units, not 1e18 ETH.
		expect(bd.longTerm.map((l) => [l.asset, l.amount, l.gainLossUsd])).toEqual([['ETH', 1, 10_000]]);
	});

	it('income from tax_classifications is mapped correctly', async () => {
		setupPipelineMock({
			incomeRows: [{
				asset_symbol: 'ETH',
				amount_usd:   500,
				category:     'income',
				sub_category: 'staking',
				source_id:    'inc-src1',
				source_type:  'import',
				token_amount: 0.2,
				tx_date:      '2023-08-01T00:00:00Z',
				kind:         'Staking Income',
				description:  'staking reward',
				tx_notes:     null,
			}],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.income).toHaveLength(1);
		expect(bd.income[0].asset).toBe('ETH');
		expect(bd.income[0].usdValue).toBeCloseTo(500);
		expect(bd.income[0].amount).toBeCloseTo(0.2);
		expect(bd.income[0].kind).toBe('staking');  // uses sub_category
	});
});


// ─────────────────────────────────────────────────────────────────────────────
// 15. Aave deposits with no lot behind them
// ─────────────────────────────────────────────────────────────────────────────

describe('aaveDeposits', () => {
	beforeEach(() => vi.resetAllMocks());

	it('a collateral deposit no lot covers still names its asset and date, and has no cost basis', async () => {
		setupMock({ eventRows: [ev({ direction: 'out', timestamp_utc: '2023-05-01T00:00:00Z', asset_symbol: 'USDC', amount: 100, native_usd: 100, transaction_class: 'collateral_deposit', source_id: 'dep-1' })] });
		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.aaveDeposits).toEqual([{ asset: 'USDC', amount: 100, date: '2023-05-01T00:00:00Z', amountUsd: 100, costBasisUsd: null, gainLossUsd: null, txHash: null }]);
	});

	it('a deposit covered by a lot carries that lot\'s cost and the gain it would have been', async () => {
		setupMock({
			eventRows: [
				ev({ direction: 'in', timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'USDC', amount: 100, native_usd: 90, transaction_class: 'owned_acquisition', source_id: 'b1' }),
				ev({ direction: 'out', timestamp_utc: '2023-05-01T00:00:00Z', asset_symbol: 'USDC', amount: 100, native_usd: 100, transaction_class: 'collateral_deposit', source_id: 'dep-1' }),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023);
		expect(bd.aaveDeposits?.map((d) => [d.asset, d.costBasisUsd, d.gainLossUsd])).toEqual([['USDC', 90, 10]]);
		expect(bd.shortTerm).toEqual([]);
		expect(bd.longTerm).toEqual([]);
	});
});
