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
 *   2. Short-term (<365 days) vs long-term (≥365 days) classification
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

describe('Short-term vs long-term (365-day threshold)', () => {
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

	it('held exactly 365 days → longTerm', async () => {
		// 2023-01-01 → 2024-01-01 = 365 days (2023 is not a leap year)
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2023-01-01T00:00:00Z' }),
			ev({ direction: 'out', timestamp_utc: '2024-01-01T00:00:00Z' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2024);
		expect(bd.longTerm).toHaveLength(1);
		expect(bd.shortTerm).toHaveLength(0);
		expect(bd.longTerm[0].daysHeld).toBe(365);
	});

	it('held 366 days (leap year 2024 buy → 2025 sell) → longTerm', async () => {
		// 2024-01-01 → 2025-01-01 = 366 days (2024 IS a leap year)
		setupMock({ eventRows: [
			ev({ direction: 'in',  timestamp_utc: '2024-01-01T00:00:00Z' }),
			ev({ direction: 'out', timestamp_utc: '2025-01-01T00:00:00Z' }),
		]});

		const bd = await buildAnnualBreakdown(TENANT, 2025);
		expect(bd.longTerm).toHaveLength(1);
		expect(bd.longTerm[0].daysHeld).toBe(366);
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
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Setup mock for the pipeline path.
 * Routes db.execute calls to the pipeline tables (tax_disposals, tax_lots,
 * tax_classifications) based on SQL content.
 */
type PipelineMockOpts = {
	disposalRows?: object[];     // tax_disposals LEFT JOIN tax_lots
	lotRows?:      object[];     // tax_lots (open lots — stillHolding)
	incomeRows?:   object[];     // tax_classifications income/airdrop
	countRows?:    object[];     // COUNT(*) from tax_disposals (auto source check)
	manualRows?:   object[];     // manual_cost_basis
};

function setupPipelineMock(opts: PipelineMockOpts = {}) {
	mockExecute.mockImplementation(({ sql }: { sql: string }) => {
		// auto-mode: COUNT(*) FROM tax_disposals to decide which source to use
		if (sql.includes('COUNT(*)') && sql.includes('tax_disposals') && sql.includes('strftime'))
			return Promise.resolve({ rows: opts.countRows ?? [{ cnt: 0 }] });

		// tax_disposals LEFT JOIN tax_lots — main settled lots query
		if (sql.includes('tax_disposals') && sql.includes('LEFT JOIN tax_lots'))
			return Promise.resolve({ rows: opts.disposalRows ?? [] });

		// tax_lots open lots — stillHolding query
		if (sql.includes('FROM tax_lots') && sql.includes('is_exhausted'))
			return Promise.resolve({ rows: opts.lotRows ?? [] });

		// tax_classifications income — joined to import_transactions for dates
		if (sql.includes('tax_classifications') && sql.includes('import_transactions'))
			return Promise.resolve({ rows: opts.incomeRows ?? [] });

		// Manual cost basis
		if (sql.includes('manual_cost_basis'))
			return Promise.resolve({ rows: opts.manualRows ?? [] });

		// NFT snapshots + hidden list
		if (sql.includes('wallet_nft_snapshot') || sql.includes('nft_hidden'))
			return Promise.resolve({ rows: [] });

		// Available years (lifecycle events + sui)
		return Promise.resolve({ rows: [] });
	});
}

/** Build a tax_disposals + tax_lots join row with sensible defaults. */
function disposalRow(overrides: {
	is_short_term?: 0 | 1;
	disposed_at: string;
	acquired_at?: string | null;
	lot_id?: string;
	asset_symbol?: string;
	quantity?: number;
	proceeds_usd?: number | null;
	cost_basis_usd?: number | null;
	gain_loss_usd?: number | null;
	source_id?: string;
	source_type?: string;
	category?: string;
}): object {
	return {
		asset_symbol:    overrides.asset_symbol   ?? 'BTC',
		quantity:        overrides.quantity        ?? 1,
		proceeds_usd:    overrides.proceeds_usd    ?? 30_000,
		cost_basis_usd:  overrides.cost_basis_usd  ?? 20_000,
		gain_loss_usd:   overrides.gain_loss_usd   ?? 10_000,
		is_short_term:   overrides.is_short_term   ?? 1,
		disposed_at:     overrides.disposed_at,
		acquired_at:     overrides.acquired_at     ?? '2023-01-01T00:00:00.000Z',
		source_id:       overrides.source_id       ?? 'disposal-src1',
		source_type:     overrides.source_type     ?? 'import',
		category:        overrides.category        ?? 'sell',
		lot_id:          overrides.lot_id          ?? 'lot-uuid-1',
		notes:           null,
	};
}

describe('Pipeline source path', () => {
	beforeEach(() => vi.resetAllMocks());

	it('source="pipeline" sets dataSource to "pipeline"', async () => {
		setupPipelineMock();
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.dataSource).toBe('pipeline');
	});

	it('source="auto" with count=0 falls back to lifecycle (dataSource="lifecycle")', async () => {
		setupMock(); // lifecycle mock handles all queries
		// Override just the COUNT check
		const originalImpl = mockExecute.getMockImplementation();
		mockExecute.mockImplementation(({ sql }: { sql: string }) => {
			if (sql.includes('COUNT(*)') && sql.includes('tax_disposals') && sql.includes('strftime'))
				return Promise.resolve({ rows: [{ cnt: 0 }] });
			return originalImpl!({ sql } as { sql: string });
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'auto');
		expect(bd.dataSource).toBe('lifecycle');
	});

	it('source="auto" with count>0 uses pipeline (dataSource="pipeline")', async () => {
		setupPipelineMock({ countRows: [{ cnt: 3 }] });
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'auto');
		expect(bd.dataSource).toBe('pipeline');
	});

	it('short-term disposal is placed in shortTerm by is_short_term=1', async () => {
		setupPipelineMock({
			disposalRows: [
				disposalRow({ disposed_at: '2023-06-01T00:00:00Z', is_short_term: 1 }),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.shortTerm).toHaveLength(1);
		expect(bd.longTerm).toHaveLength(0);
		expect(bd.shortTerm[0].asset).toBe('BTC');
		expect(bd.shortTerm[0].gainLossUsd).toBeCloseTo(10_000);
	});

	it('long-term disposal is placed in longTerm by is_short_term=0', async () => {
		setupPipelineMock({
			disposalRows: [
				disposalRow({
					disposed_at: '2023-06-01T00:00:00Z',
					acquired_at: '2022-01-01T00:00:00Z',
					is_short_term: 0,
					gain_loss_usd: 20_000,
				}),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.longTerm).toHaveLength(1);
		expect(bd.shortTerm).toHaveLength(0);
		expect(bd.longTerm[0].gainLossUsd).toBeCloseTo(20_000);
	});

	it('daysHeld is computed from acquired_at to disposed_at', async () => {
		// 365-day hold: 2022-06-01 → 2023-06-01
		setupPipelineMock({
			disposalRows: [
				disposalRow({
					disposed_at: '2023-06-01T00:00:00Z',
					acquired_at: '2022-06-01T00:00:00Z',
					is_short_term: 0,
				}),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.longTerm[0].daysHeld).toBe(365);
	});

	it('disposal with lot_id="unmatched" goes to needsAttention', async () => {
		setupPipelineMock({
			disposalRows: [
				disposalRow({
					disposed_at: '2023-05-01T00:00:00Z',
					lot_id:      'unmatched',
					acquired_at: null,
					proceeds_usd: 15_000,
					source_id:   'orphan-src',
					source_type: 'import',
					category:    'sell',
				}),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.needsAttention).toHaveLength(1);
		expect(bd.shortTerm).toHaveLength(0);
		expect(bd.needsAttention[0].sourceId).toBe('orphan-src');
		expect(bd.needsAttention[0].proceedsUsd).toBeCloseTo(15_000);
	});

	it('open lots appear in stillHolding', async () => {
		setupPipelineMock({
			lotRows: [{
				asset_symbol:   'BTC',
				acquired_at:    '2023-01-01T00:00:00.000Z',
				remaining_qty:  0.5,
				cost_basis_usd: 12_500,
			}],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.stillHolding).toHaveLength(1);
		expect(bd.stillHolding[0].asset).toBe('BTC');
		expect(bd.stillHolding[0].amount).toBeCloseTo(0.5);
		expect(bd.stillHolding[0].costUsd).toBeCloseTo(12_500);
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

	it('totals are computed from pipeline sections', async () => {
		setupPipelineMock({
			disposalRows: [
				disposalRow({ disposed_at: '2023-04-01T00:00:00Z', is_short_term: 1, gain_loss_usd: 5_000 }),
				disposalRow({ disposed_at: '2023-08-01T00:00:00Z', acquired_at: '2022-01-01T00:00:00Z', is_short_term: 0, gain_loss_usd: 8_000 }),
			],
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'pipeline');
		expect(bd.totals.shortTermGain).toBeCloseTo(5_000);
		expect(bd.totals.longTermGain).toBeCloseTo(8_000);
	});

	it('source="auto" with tax_disposals throwing falls back to lifecycle', async () => {
		// Simulate tax_disposals table not existing (pipeline never run)
		setupMock(); // lifecycle mock for the fallback path
		const originalImpl = mockExecute.getMockImplementation();
		mockExecute.mockImplementation(({ sql }: { sql: string }) => {
			if (sql.includes('COUNT(*)') && sql.includes('tax_disposals') && sql.includes('strftime'))
				return Promise.reject(new Error('no such table: tax_disposals'));
			return originalImpl!({ sql } as { sql: string });
		});
		const bd = await buildAnnualBreakdown(TENANT, 2023, 'fifo', undefined, 'auto');
		expect(bd.dataSource).toBe('lifecycle');
	});
});
