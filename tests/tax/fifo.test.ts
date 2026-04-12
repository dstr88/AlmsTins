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
import { runFifo } from '../../src/lib/tax/pass4';
import type { RawImportTx, RawOnchainTx, ClassificationResult } from '../../src/lib/tax/types';

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
	it('marks disposal as short-term when held < 365 days', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			// Sell 364 days later
			importTx({ id: 'sell1', timestamp_utc: '2023-12-31T00:00:00Z', amount: 1, native_usd: 50_000 }),
		];
		const classifications = classifyMap([
			['import', 'buy1',  'buy'],
			['import', 'sell1', 'sell'],
		]);

		const { disposals } = runFifo(TENANT, rows, [], classifications);
		expect(disposals[0].isShortTerm).toBe(true);
	});

	it('marks disposal as long-term when held ≥ 365 days', () => {
		const rows = [
			importTx({ id: 'buy1', timestamp_utc: '2022-01-01T00:00:00Z', amount: 1, native_usd: 40_000 }),
			// Sell exactly 365 days later
			importTx({ id: 'sell1', timestamp_utc: '2023-01-01T00:00:00Z', amount: 1, native_usd: 50_000 }),
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
			// Lot 1: bought 2 years ago → long-term
			importTx({ id: 'buy1', timestamp_utc: '2021-01-01T00:00:00Z', amount: 1, native_usd: 10_000 }),
			// Lot 2: bought 6 months ago → short-term
			importTx({ id: 'buy2', timestamp_utc: '2023-06-01T00:00:00Z', amount: 1, native_usd: 20_000 }),
			// Sell both
			importTx({ id: 'sell1', timestamp_utc: '2023-12-01T00:00:00Z', amount: 2, native_usd: 60_000 }),
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
