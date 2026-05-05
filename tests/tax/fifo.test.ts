/**
 * Unit tests for runFifo — the core tax lot matching engine.
 *
 * runFifo is a pure function (no DB I/O): give it raw transaction rows +
 * a classification map, get back lots and disposals.  Every IRS-relevant
 * calculation — cost basis allocation, gain/loss, short/long-term — lives
 * here and is verified below.
 *
 * Run:  npm test
 */

import { describe, it, expect } from 'vitest';
import { runFifo } from '../../src/lib/yearEnd/pass4';
import type { RawImportTx, RawOnchainTx, ClassificationResult } from '../../src/lib/yearEnd/types';

// ── Minimal fixture builders ──────────────────────────────────────────────────

function importTx(
	overrides: Partial<RawImportTx> & { id: string; timestamp_utc: string },
): RawImportTx {
	return {
		asset_symbol: 'BTC',
		direction:    'in',
		kind:         'buy',
		amount:       1,
		to_amount:    null,
		native_usd:   40_000,
		tx_hash:      null,
		source:       'coinbase',
		notes:        null,
		category:     null,
		...overrides,
	};
}

function onchainTx(
	overrides: Partial<RawOnchainTx> & { id: string; timestamp: string },
): RawOnchainTx {
	return {
		token_symbol:   'ETH',
		value:          '1',
		from_address:   '0xabc',
		to_address:     '0xdef',
		tx_type:        'transfer',
		usd_value:      2_000,
		chain:          'ethereum',
		wallet_address: '0xabc',
		...overrides,
	};
}

function classifyMap(
	entries: [sourceType: 'import' | 'onchain', id: string, category: string][],
): Map<string, ClassificationResult> {
	return new Map(
		entries.map(([sourceType, id, category]) => [
			`${sourceType}:${id}`,
			{ sourceType, sourceId: id, category: category as ClassificationResult['category'], confidence: 1.0 },
		]),
	);
}

const TENANT = 'test-tenant';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Summate a numeric field across an array, treating null as 0. */
const sum = (arr: { gainLossUsd?: number | null }[], field: 'gainLossUsd') =>
	arr.reduce((acc, d) => acc + (d[field] ?? 0), 0);

// ─────────────────────────────────────────────────────────────────────────────
// 1. BASIC GAIN / LOSS
// ─────────────────────────────────────────────────────────────────────────────

describe('Basic gain / loss', () => {
	it('records a capital gain when proceeds exceed cost basis', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 50_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		expect(disposals).toHaveLength(1);
		expect(disposals[0].gainLossUsd).toBeCloseTo(10_000);
		expect(disposals[0].costBasisUsd).toBeCloseTo(40_000);
		expect(disposals[0].proceedsUsd).toBeCloseTo(50_000);
	});

	it('records a capital loss when proceeds are below cost basis', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 30_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		expect(disposals[0].gainLossUsd).toBeCloseTo(-10_000);
	});

	it('records null gain/loss when cost basis is unknown', () => {
		// Sell with no prior buy — cost basis is unknown
		const rows = [
			importTx({ id: 'sell1', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 50_000 }),
		];
		const classifications = classifyMap([['import', 'sell1', 'sell']]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		expect(disposals).toHaveLength(1);
		expect(disposals[0].lotId).toBe('unmatched');
		expect(disposals[0].gainLossUsd).toBeNull();
		expect(disposals[0].costBasisUsd).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. FIFO ORDERING
// ─────────────────────────────────────────────────────────────────────────────

describe('FIFO lot ordering', () => {
	it('consumes the oldest lot first', () => {
		// Two buys: Jan ($30k), Feb ($50k). One sell in March.
		// FIFO should use the Jan lot → cost basis $30k.
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 30_000 }),
			importTx({ id: 'buy2', timestamp_utc: '2023-02-01T00:00:00Z', amount: 1, native_usd: 50_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-03-01T00:00:00Z', amount: 1, native_usd: 45_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'buy2',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { lots, disposals } = runFifo(TENANT, rows, [], classifications);

		// Should have 2 lots; the Jan one exhausted, the Feb one still open
		expect(lots).toHaveLength(2);
		const janLot = lots.find((l) => l.sourceId === 'buy1')!;
		const febLot = lots.find((l) => l.sourceId === 'buy2')!;
		expect(janLot.isExhausted).toBe(true);
		expect(febLot.isExhausted).toBeUndefined(); // not exhausted

		// Disposal should reference the Jan lot
		expect(disposals).toHaveLength(1);
		expect(disposals[0].lotId).toBe(janLot.id);
		expect(disposals[0].costBasisUsd).toBeCloseTo(30_000);
		expect(disposals[0].gainLossUsd).toBeCloseTo(15_000); // 45k - 30k
	});

	it('leaves the second lot with correct remaining quantity after partial sell', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 60_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 35_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { lots, disposals } = runFifo(TENANT, rows, [], classifications);

		expect(lots).toHaveLength(1);
		expect(lots[0].remainingQty).toBeCloseTo(1);

		expect(disposals).toHaveLength(1);
		// cost basis for 1 of 2 BTC = $60k / 2 = $30k
		expect(disposals[0].costBasisUsd).toBeCloseTo(30_000);
		expect(disposals[0].gainLossUsd).toBeCloseTo(5_000);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. MULTI-LOT DISPOSAL
// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-lot disposal', () => {
	it('spans two lots when a single disposal exceeds the first lot', () => {
		// Buy 0.5 BTC at $20k, buy 0.5 BTC at $40k, sell 1 BTC at $60k.
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2022-01-01T00:00:00Z', amount: 0.5, native_usd: 20_000 }),
			importTx({ id: 'buy2', timestamp_utc: '2022-06-01T00:00:00Z', amount: 0.5, native_usd: 40_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 60_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'buy2',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { lots, disposals } = runFifo(TENANT, rows, [], classifications);

		// Both lots should be exhausted
		expect(lots.every((l) => l.isExhausted)).toBe(true);

		// Two disposal slices — one per lot consumed
		expect(disposals).toHaveLength(2);
		const totalGain = sum(disposals, 'gainLossUsd');

		// Proceeds: 0.5 × $60k = $30k per slice
		// Cost:     slice1 = $20k, slice2 = $40k
		// Gain:     ($30k - $20k) + ($30k - $40k) = $10k - $10k = $0
		expect(totalGain).toBeCloseTo(0);
	});

	it('correctly pro-rates proceeds across each slice', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 10_000 }),
			importTx({ id: 'buy2', timestamp_utc: '2022-06-01T00:00:00Z', amount: 1, native_usd: 20_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 60_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'buy2',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals).toHaveLength(2);

		// Each slice: 1/2 of $60k = $30k proceeds
		for (const d of disposals) {
			expect(d.proceedsUsd).toBeCloseTo(30_000);
			expect(d.quantity).toBeCloseTo(1);
		}

		// slice1 gain: $30k - $10k = $20k
		// slice2 gain: $30k - $20k = $10k
		const gains = disposals.map((d) => d.gainLossUsd!).sort((a, b) => b - a);
		expect(gains[0]).toBeCloseTo(20_000);
		expect(gains[1]).toBeCloseTo(10_000);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SHORT-TERM vs LONG-TERM
// ─────────────────────────────────────────────────────────────────────────────

describe('Short-term / long-term holding period', () => {
	it('marks disposal as short-term when held < 12 calendar months', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			// Sell 364 days later — clearly short-term
			importTx({ id: 'sell1', timestamp_utc: '2023-12-31T00:00:00Z', amount: 1, native_usd: 50_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals[0].isShortTerm).toBe(true);
	});

	it('marks disposal as short-term when held EXACTLY 12 calendar months (IRS boundary)', () => {
		// IRS rule: "more than 1 year" = long-term. Exactly 12 months = still short-term.
		// Acquired Jan 1 2022, disposed Jan 1 2023 = exactly 12 months = SHORT-TERM.
		// The old code using < 365 days would have incorrectly classified this as long-term.
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 50_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals[0].isShortTerm).toBe(true); // exactly 12 months = short-term per IRS
	});

	it('marks disposal as long-term when held MORE than 12 calendar months', () => {
		// Acquired Jan 1 2022, disposed Jan 2 2023 = 12 months + 1 day = LONG-TERM.
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-02T00:00:00Z', amount: 1, native_usd: 50_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals[0].isShortTerm).toBe(false);
	});

	it('handles leap year correctly: Jan 1 2024 → Jan 1 2025 (366 days) = short-term', () => {
		// 2024 is a leap year (366 days). Jan 1 2024 → Jan 1 2025 = exactly 12 calendar months.
		// Despite being 366 days, this is still exactly 12 months = SHORT-TERM.
		// A naive fixed-day check (≥ 365 days → long-term) would misclassify this.
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2024-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2025-01-01T00:00:00Z', amount: 1, native_usd: 50_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals[0].isShortTerm).toBe(true); // 366 days but exactly 12 months = short-term
	});

	it('handles leap year correctly: Jan 1 2024 → Jan 2 2025 (367 days) = long-term', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2024-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2025-01-02T00:00:00Z', amount: 1, native_usd: 50_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals[0].isShortTerm).toBe(false);
	});

	it('handles a disposal spanning one short-term and one long-term lot', () => {
		const rows = [
			// Lot 1: bought 2+ years ago → clearly long-term (disposed Jan 2 2024, held > 12 months)
			importTx({ id: 'buy1', timestamp_utc: '2021-01-01T00:00:00Z', amount: 1, native_usd: 10_000 }),
			// Lot 2: bought 6 months ago → short-term
			importTx({ id: 'buy2', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 20_000 }),
			// Sell both — disposed Jan 2 2024
			importTx({ id: 'sell1', timestamp_utc: '2024-01-02T00:00:00Z', amount: 2, native_usd: 60_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'buy2',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals).toHaveLength(2);

		const ltDisposal = disposals.find((d) => !d.isShortTerm)!;
		const stDisposal = disposals.find((d) => d.isShortTerm)!;
		expect(ltDisposal).toBeDefined();
		expect(stDisposal).toBeDefined();
		// Long-term lot has lower cost → higher gain
		expect(ltDisposal.gainLossUsd!).toBeGreaterThan(stDisposal.gainLossUsd!);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. INDEPENDENT ASSET POOLS
// ─────────────────────────────────────────────────────────────────────────────

describe('Independent asset pools', () => {
	it('does not allow BTC lots to satisfy an ETH disposal', () => {
		const rows = [
			importTx({ id: 'buy-btc', timestamp_utc: '2023-01-01T00:00:00Z', asset_symbol: 'BTC', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell-eth', timestamp_utc: '2023-06-01T00:00:00Z', asset_symbol: 'ETH', amount: 1, native_usd: 2_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy-btc',  'buy'],
			['import', 'sell-eth', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		// ETH sell should be unmatched — BTC lot cannot satisfy it
		expect(disposals).toHaveLength(1);
		expect(disposals[0].lotId).toBe('unmatched');
	});

	it('tracks BTC and ETH gains independently in the same run', () => {
		const rows = [
			importTx({ id: 'buy-btc',  timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'BTC', amount: 1, native_usd: 30_000 }),
			importTx({ id: 'buy-eth',  timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'ETH', amount: 1, native_usd: 1_000 }),
			importTx({ id: 'sell-btc', timestamp_utc: '2023-01-01T00:00:00Z', asset_symbol: 'BTC', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell-eth', timestamp_utc: '2023-01-01T00:00:00Z', asset_symbol: 'ETH', amount: 1, native_usd: 2_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy-btc',  'buy'],
			['import', 'buy-eth',  'buy'],
			['import', 'sell-btc', 'sell'],
			['import', 'sell-eth', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals).toHaveLength(2);

		const btcDisposal = disposals.find((d) => d.assetSymbol === 'BTC')!;
		const ethDisposal = disposals.find((d) => d.assetSymbol === 'ETH')!;

		expect(btcDisposal.gainLossUsd).toBeCloseTo(10_000);
		expect(ethDisposal.gainLossUsd).toBeCloseTo(1_000);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. INCOME AND AIRDROP LOTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Income and airdrop lots', () => {
	it('creates a cost-basis lot from income (staking reward)', () => {
		const rows = [
			importTx({ id: 'reward1', timestamp_utc: '2022-06-01T00:00:00Z', amount: 0.5, native_usd: 10_000 }),
			importTx({ id: 'sell1',   timestamp_utc: '2023-06-01T00:00:00Z', amount: 0.5, native_usd: 15_000 }),
		];
		const classifications = classifyMap([
			['import', 'reward1', 'income'],
			['import', 'sell1',   'sell'],
		]);

		const { lots, disposals } = runFifo(TENANT, rows, [], classifications);

		expect(lots).toHaveLength(1);
		expect(lots[0].lotType).toBe('income');
		expect(disposals[0].gainLossUsd).toBeCloseTo(5_000);
	});

	it('creates a lot from an airdrop and uses FMV at receipt as cost basis', () => {
		const rows = [
			importTx({ id: 'drop1', timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'ARB', amount: 100, native_usd: 150 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', asset_symbol: 'ARB', amount: 100, native_usd: 200 }),
		];
		const classifications = classifyMap([
			['import', 'drop1', 'airdrop'],
			['import', 'sell1', 'sell'],
		]);

		const { lots, disposals } = runFifo(TENANT, rows, [], classifications);

		expect(lots[0].lotType).toBe('airdrop');
		// Cost basis = FMV at airdrop = $150; proceeds = $200; gain = $50
		expect(disposals[0].gainLossUsd).toBeCloseTo(50);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ONCHAIN TRANSACTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('Onchain transactions', () => {
	it('creates a lot from an onchain buy and matches an import sell', () => {
		const onchain = [
			onchainTx({
				id: 'onchain-buy1',
				timestamp:    '2022-01-01T00:00:00Z',
				token_symbol: 'ETH',
				value:        '2',
				usd_value:    4_000,
			}),
		];
		const importRows = [
			importTx({
				id:            'sell1',
				timestamp_utc: '2023-01-01T00:00:00Z',
				asset_symbol:  'ETH',
				amount:        2,
				native_usd:    6_000,
			}),
		];
		const classifications = classifyMap([
			['onchain', 'onchain-buy1', 'buy'],
			['import',  'sell1',        'sell'],
		]);

		const { disposals } = runFifo(TENANT, importRows, onchain, classifications);

		expect(disposals).toHaveLength(1);
		expect(disposals[0].gainLossUsd).toBeCloseTo(2_000); // 6k - 4k
	});

	it('correctly identifies the symbol from token_symbol on an onchain disposal', () => {
		const onchain = [
			onchainTx({
				id:           'onchain-buy1',
				timestamp:    '2022-01-01T00:00:00Z',
				token_symbol: 'MATIC',
				value:        '100',
				usd_value:    80,
			}),
			onchainTx({
				id:           'onchain-sell1',
				timestamp:    '2023-01-01T00:00:00Z',
				token_symbol: 'MATIC',
				value:        '100',
				usd_value:    200,
			}),
		];
		const classifications = classifyMap([
			['onchain', 'onchain-buy1',  'buy'],
			['onchain', 'onchain-sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, [], onchain, classifications);

		expect(disposals[0].assetSymbol).toBe('MATIC');
		expect(disposals[0].gainLossUsd).toBeCloseTo(120); // 200 - 80
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. FLOATING-POINT EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('Floating-point edge cases', () => {
	it('does not produce a phantom unmatched disposal from 0.1 + 0.2 arithmetic', () => {
		// Classic IEEE 754: 0.1 + 0.2 = 0.30000000000000004
		// Without the epsilon guard, selling 0.3 BTC leaves a tiny phantom remainder
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2022-01-01T00:00:00Z', amount: 0.1, native_usd: 4_000 }),
			importTx({ id: 'buy2', timestamp_utc: '2022-02-01T00:00:00Z', amount: 0.2, native_usd: 8_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 0.3, native_usd: 15_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'buy2',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		// Should produce exactly 2 disposal slices (one per lot), not 3
		// (the phantom 3rd would be the near-zero unmatched remainder)
		const unmatched = disposals.filter((d) => d.lotId === 'unmatched');
		expect(unmatched).toHaveLength(0);
		expect(disposals).toHaveLength(2);
	});

	it('handles very small quantities without creating phantom lots', () => {
		// 10 buys of 0.01 BTC each, then sell 0.1 BTC
		const rows = Array.from({ length: 10 }, (_, i) =>
			importTx({
				id:            `buy${i}`,
				timestamp_utc: `2022-0${(i % 9) + 1}-01T00:00:00Z`,
				amount:        0.01,
				native_usd:    400,
			}),
		).concat([
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 0.1, native_usd: 5_000 }),
		]);

		const entries: [string, string, string][] = [
			...Array.from({ length: 10 }, (_, i): [string, string, string] => ['import', `buy${i}`, 'buy']),
			['import', 'sell1', 'sell'],
		];
		const classifications = classifyMap(entries as ['import' | 'onchain', string, string][]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		const unmatched = disposals.filter((d) => d.lotId === 'unmatched');
		expect(unmatched).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. LOTS STRUCTURE
// ─────────────────────────────────────────────────────────────────────────────

describe('Lot structure', () => {
	it('generates unique IDs for every lot', () => {
		const rows = Array.from({ length: 5 }, (_, i) =>
			importTx({ id: `buy${i}`, timestamp_utc: `2022-0${i + 1}-01T00:00:00Z`, amount: 1, native_usd: 10_000 }),
		);
		const classifications = classifyMap(
			rows.map((r) => ['import', r.id, 'buy'] as ['import', string, string]),
		);

		const { lots } = runFifo(TENANT, rows, [], classifications);
		const ids = lots.map((l) => l.id);
		expect(new Set(ids).size).toBe(5);
	});

	it('sets pricePerUnit correctly from cost basis and quantity', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 80_000 }),
		];
		const classifications = classifyMap([['import', 'buy1', 'buy']]);

		const { lots } = runFifo(TENANT, rows, [], classifications);
		expect(lots[0].pricePerUnit).toBeCloseTo(40_000); // $80k / 2 BTC
	});

	it('sets pricePerUnit to null when cost basis is unknown', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: null }),
		];
		const classifications = classifyMap([['import', 'buy1', 'buy']]);

		const { lots } = runFifo(TENANT, rows, [], classifications);
		expect(lots[0].pricePerUnit).toBeNull();
		expect(lots[0].costBasisUsd).toBeNull();
	});

	it('marks exhausted lots correctly', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 30_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { lots } = runFifo(TENANT, rows, [], classifications);
		expect(lots[0].isExhausted).toBe(true);
		expect(lots[0].remainingQty).toBeCloseTo(0);
	});

	it('does not mark a partially-consumed lot as exhausted', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2022-01-01T00:00:00Z', amount: 3, native_usd: 90_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 35_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { lots } = runFifo(TENANT, rows, [], classifications);
		expect(lots[0].isExhausted).toBeUndefined();
		expect(lots[0].remainingQty).toBeCloseTo(2);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. MATHEMATICAL INVARIANTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Mathematical invariants', () => {
	it('disposal slice quantities always sum to the original disposal quantity', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2021-01-01T00:00:00Z', amount: 0.7, native_usd: 21_000 }),
			importTx({ id: 'buy2', timestamp_utc: '2021-06-01T00:00:00Z', amount: 0.8, native_usd: 32_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1.3, native_usd: 65_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'buy2',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		const sliceSum = disposals.reduce((acc, d) => acc + d.quantity, 0);
		expect(sliceSum).toBeCloseTo(1.3);
	});

	it('proceeds slices sum to total disposal proceeds', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2021-01-01T00:00:00Z', amount: 1, native_usd: 30_000 }),
			importTx({ id: 'buy2', timestamp_utc: '2021-06-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 100_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'buy2',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		const proceedsSum = disposals.reduce((acc, d) => acc + (d.proceedsUsd ?? 0), 0);
		expect(proceedsSum).toBeCloseTo(100_000);
	});

	it('total cost basis + total gain = total proceeds', () => {
		const rows = [
			importTx({ id: 'buy1',  timestamp_utc: '2021-01-01T00:00:00Z', amount: 1, native_usd: 20_000 }),
			importTx({ id: 'buy2',  timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-06-01T00:00:00Z', amount: 2, native_usd: 90_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'buy2',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		const totalProceeds   = disposals.reduce((a, d) => a + (d.proceedsUsd  ?? 0), 0);
		const totalCost       = disposals.reduce((a, d) => a + (d.costBasisUsd ?? 0), 0);
		const totalGain       = disposals.reduce((a, d) => a + (d.gainLossUsd  ?? 0), 0);

		expect(totalCost + totalGain).toBeCloseTo(totalProceeds);
	});

	it('no lot has a negative remaining quantity after disposal', () => {
		// Sell more than available — lots exhaust to zero, not below
		const rows = [
			importTx({ id: 'buy1',  timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 30_000 }),
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 2, native_usd: 80_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { lots } = runFifo(TENANT, rows, [], classifications);

		for (const lot of lots) {
			expect(lot.remainingQty).toBeGreaterThanOrEqual(0);
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. SWAP to_amount FIELD
// ─────────────────────────────────────────────────────────────────────────────

describe('Swap — to_amount as acquisition quantity', () => {
	it('creates a lot using to_amount quantity when to_amount is set on a buy row', () => {
		// Exchange reports a convert/swap as one row:
		//   amount    = 1    (ETH given up — ignored for the acquisition lot)
		//   to_amount = 2000 (USDC received — becomes the lot quantity)
		//   native_usd = 2000 (USD value of the USDC received)
		// The lot for USDC should have quantity 2000, not 1.
		const rows = [
			importTx({
				id:            'swap-buy',
				timestamp_utc: '2023-01-01T00:00:00Z',
				asset_symbol:  'USDC',
				direction:     'in',
				amount:        1,      // ETH given — irrelevant for the lot
				to_amount:     2_000,  // USDC received
				native_usd:    2_000,
			}),
		];
		const classifications = classifyMap([['import', 'swap-buy', 'buy']]);

		const { lots } = runFifo(TENANT, rows, [], classifications);

		expect(lots).toHaveLength(1);
		expect(lots[0].quantity).toBeCloseTo(2_000);
		expect(lots[0].remainingQty).toBeCloseTo(2_000);
		// price per unit: $2000 / 2000 USDC = $1.00
		expect(lots[0].pricePerUnit).toBeCloseTo(1.0);
	});

	it('falls back to amount when to_amount is null on a buy row', () => {
		const rows = [
			importTx({
				id:            'buy1',
				timestamp_utc: '2023-01-01T00:00:00Z',
				asset_symbol:  'ETH',
				amount:        2,
				to_amount:     null, // no to_amount
				native_usd:    6_000,
			}),
		];
		const classifications = classifyMap([['import', 'buy1', 'buy']]);

		const { lots } = runFifo(TENANT, rows, [], classifications);

		expect(lots[0].quantity).toBeCloseTo(2);
	});

	it('uses amount (not to_amount) for the disposal quantity on a swap-classified row', () => {
		// A swap disposal row: amount=1 ETH disposed, to_amount=2000 USDC received.
		// The disposal should consume 1 ETH lot, not 2000.
		const rows = [
			importTx({ id: 'buy-eth',   timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'ETH', amount: 1,     native_usd: 1_500 }),
			importTx({ id: 'swap-sell', timestamp_utc: '2023-01-01T00:00:00Z', asset_symbol: 'ETH', direction: 'out', amount: 1, to_amount: 2_000, native_usd: 2_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy-eth',   'buy'],
			['import', 'swap-sell', 'swap'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		expect(disposals).toHaveLength(1);
		expect(disposals[0].quantity).toBeCloseTo(1);   // 1 ETH disposed
		expect(disposals[0].proceedsUsd).toBeCloseTo(2_000); // proceeds = native_usd
		expect(disposals[0].gainLossUsd).toBeCloseTo(500);   // 2000 - 1500
		expect(disposals[0].category).toBe('swap');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 12 (continued). TWO-ROW CEX SWAP — the Coinbase "Convert" pattern
// ─────────────────────────────────────────────────────────────────────────────

describe('Swap — two-row CEX pattern (Coinbase Convert)', () => {
	// Coinbase reports a Convert as TWO rows both with kind='Convert' → both
	// classified as 'swap':
	//   Row A: direction='out', asset='ETH', amount=1   → disposal of ETH
	//   Row B: direction='in',  asset='USDC', amount=2000 → acquisition lot for USDC
	//
	// Before this fix, both rows entered buildDisposals and row B created a
	// spurious USDC disposal with null cost basis. Row B never entered
	// buildAcquisitions, so USDC had no lot and future sells were 'unmatched'.

	it('outgoing swap row creates a disposal of the sold asset', () => {
		const rows = [
			importTx({ id: 'buy-eth', timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'ETH', amount: 1, native_usd: 1_500 }),
			importTx({ id: 'swap-out', timestamp_utc: '2023-06-01T00:00:00Z', asset_symbol: 'ETH', direction: 'out', amount: 1, native_usd: 2_000 }),
			importTx({ id: 'swap-in',  timestamp_utc: '2023-06-01T00:00:00Z', asset_symbol: 'USDC', direction: 'in', amount: 2_000, native_usd: 2_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy-eth',  'buy'],
			['import', 'swap-out', 'swap'],
			['import', 'swap-in',  'swap'],
		]);

		const { lots, disposals } = runFifo(TENANT, rows, [], classifications);

		// Exactly ONE disposal: the ETH sold
		const ethDisposals = disposals.filter(d => d.assetSymbol === 'ETH');
		expect(ethDisposals).toHaveLength(1);
		expect(ethDisposals[0].quantity).toBeCloseTo(1);
		expect(ethDisposals[0].proceedsUsd).toBeCloseTo(2_000);
		expect(ethDisposals[0].gainLossUsd).toBeCloseTo(500); // 2000 - 1500

		// ZERO USDC disposals — the incoming swap leg must NOT create a disposal
		const usdcDisposals = disposals.filter(d => d.assetSymbol === 'USDC');
		expect(usdcDisposals).toHaveLength(0);

		// An acquisition lot for USDC was created
		const usdcLot = lots.find(l => l.assetSymbol === 'USDC');
		expect(usdcLot).toBeDefined();
		expect(usdcLot!.quantity).toBeCloseTo(2_000);
		expect(usdcLot!.costBasisUsd).toBeCloseTo(2_000); // FMV at swap date = cost basis
	});

	it('USDC lot from swap-in has correct cost basis for a subsequent sell', () => {
		// Full round-trip: buy ETH → swap to USDC → sell USDC
		const rows = [
			importTx({ id: 'buy-eth',   timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'ETH',  direction: 'in',  amount: 1,     native_usd: 1_500 }),
			importTx({ id: 'swap-out',  timestamp_utc: '2023-06-01T00:00:00Z', asset_symbol: 'ETH',  direction: 'out', amount: 1,     native_usd: 2_000 }),
			importTx({ id: 'swap-in',   timestamp_utc: '2023-06-01T00:00:00Z', asset_symbol: 'USDC', direction: 'in',  amount: 2_000, native_usd: 2_000 }),
			importTx({ id: 'sell-usdc', timestamp_utc: '2023-12-01T00:00:00Z', asset_symbol: 'USDC', direction: 'out', amount: 2_000, native_usd: 2_100 }),
		];
		const classifications = classifyMap([
			['import', 'buy-eth',   'buy'],
			['import', 'swap-out',  'swap'],
			['import', 'swap-in',   'swap'],
			['import', 'sell-usdc', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		const usdcSell = disposals.find(d => d.sourceId === 'sell-usdc');
		expect(usdcSell).toBeDefined();
		expect(usdcSell!.costBasisUsd).toBeCloseTo(2_000); // cost basis from swap-in lot
		expect(usdcSell!.gainLossUsd).toBeCloseTo(100);    // $2100 - $2000
		expect(usdcSell!.lotId).not.toBe('unmatched');      // must be matched, not orphaned
	});

	it('two-row swap produces exactly two lots total (ETH buy + USDC swap-in)', () => {
		const rows = [
			importTx({ id: 'buy-eth',  timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'ETH',  direction: 'in',  amount: 1,     native_usd: 1_500 }),
			importTx({ id: 'swap-out', timestamp_utc: '2023-06-01T00:00:00Z', asset_symbol: 'ETH',  direction: 'out', amount: 1,     native_usd: 2_000 }),
			importTx({ id: 'swap-in',  timestamp_utc: '2023-06-01T00:00:00Z', asset_symbol: 'USDC', direction: 'in',  amount: 2_000, native_usd: 2_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy-eth',  'buy'],
			['import', 'swap-out', 'swap'],
			['import', 'swap-in',  'swap'],
		]);

		const { lots } = runFifo(TENANT, rows, [], classifications);
		expect(lots).toHaveLength(2);
		expect(lots.map(l => l.assetSymbol).sort()).toEqual(['ETH', 'USDC']);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. BURN AND LOST DISPOSALS
// ─────────────────────────────────────────────────────────────────────────────

describe('Burn and lost disposals', () => {
	it('creates a burn disposal with zero proceeds and full loss of cost basis', () => {
		// Sending tokens to a burn address: native_usd = 0.
		// Expected: proceedsUsd = 0, gainLossUsd = -costBasis (full loss).
		const rows = [
			importTx({ id: 'buy1',  timestamp_utc: '2022-01-01T00:00:00Z', amount: 100, native_usd: 500, asset_symbol: 'SHIB' }),
			importTx({ id: 'burn1', timestamp_utc: '2023-06-01T00:00:00Z', amount: 100, native_usd: 0,   asset_symbol: 'SHIB' }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'burn1', 'burn'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		expect(disposals).toHaveLength(1);
		expect(disposals[0].category).toBe('burn');
		expect(disposals[0].proceedsUsd).toBeCloseTo(0);
		expect(disposals[0].gainLossUsd).toBeCloseTo(-500); // 0 proceeds - $500 cost
	});

	it('creates a lost disposal with null proceeds when native_usd is null', () => {
		// Tokens lost (hack, lost key, etc.) with no known FMV recovery.
		const rows = [
			importTx({ id: 'buy1',  timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			importTx({ id: 'lost1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: null }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'lost1', 'lost'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		expect(disposals).toHaveLength(1);
		expect(disposals[0].category).toBe('lost');
		expect(disposals[0].proceedsUsd).toBeNull();
		// Can't compute gain/loss without proceeds
		expect(disposals[0].gainLossUsd).toBeNull();
	});

	it('exhausts the lot after a full burn', () => {
		const rows = [
			importTx({ id: 'buy1',  timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 30_000 }),
			importTx({ id: 'burn1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 0 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'burn1', 'burn'],
		]);

		const { lots } = runFifo(TENANT, rows, [], classifications);
		expect(lots[0].isExhausted).toBe(true);
		expect(lots[0].remainingQty).toBeCloseTo(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. LIQUIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Liquidation disposals', () => {
	it('creates a liquidation disposal and computes gain/loss correctly', () => {
		// Aave liquidated 1 ETH of collateral at $1,800 when cost basis was $2,000.
		const rows = [
			importTx({ id: 'buy1',  timestamp_utc: '2022-01-01T00:00:00Z', asset_symbol: 'ETH', amount: 1, native_usd: 2_000 }),
			importTx({ id: 'liq1',  timestamp_utc: '2022-11-01T00:00:00Z', asset_symbol: 'ETH', amount: 1, native_usd: 1_800 }),
		];
		const classifications = classifyMap([
			['import', 'buy1', 'buy'],
			['import', 'liq1', 'liquidation'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		expect(disposals).toHaveLength(1);
		expect(disposals[0].category).toBe('liquidation');
		expect(disposals[0].proceedsUsd).toBeCloseTo(1_800);
		expect(disposals[0].costBasisUsd).toBeCloseTo(2_000);
		expect(disposals[0].gainLossUsd).toBeCloseTo(-200); // forced-sale loss
	});

	it('marks a liquidation disposal short-term when held < 365 days', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2022-06-01T00:00:00Z', asset_symbol: 'ETH', amount: 1, native_usd: 2_000 }),
			// Liquidated 6 months later → short-term
			importTx({ id: 'liq1', timestamp_utc: '2022-11-01T00:00:00Z', asset_symbol: 'ETH', amount: 1, native_usd: 1_800 }),
		];
		const classifications = classifyMap([
			['import', 'buy1', 'buy'],
			['import', 'liq1', 'liquidation'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals[0].isShortTerm).toBe(true);
	});

	it('creates an unmatched liquidation disposal when no lot exists', () => {
		// Protocol liquidated a position we have no acquisition record for.
		const rows = [
			importTx({ id: 'liq1', timestamp_utc: '2022-11-01T00:00:00Z', asset_symbol: 'ETH', amount: 1, native_usd: 1_800 }),
		];
		const classifications = classifyMap([['import', 'liq1', 'liquidation']]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);

		expect(disposals).toHaveLength(1);
		expect(disposals[0].lotId).toBe('unmatched');
		expect(disposals[0].costBasisUsd).toBeNull();
		expect(disposals[0].gainLossUsd).toBeNull();
	});
});
