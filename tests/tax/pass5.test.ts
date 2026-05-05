/**
 * Tests for pass5 — Review queue builder.
 *
 * buildReviewQueue collects transactions that need manual attention before
 * the tax report is considered complete.  It has three independent triggers:
 *
 *   1. unknown_type    — row was not classified by any earlier pass
 *   2. low_confidence  — classified with confidence < 0.7
 *   3. missing_price   — taxable event with no native_usd / usd_value
 *
 * Deduplication: an `existingReviewKeys` set (format "sourceType:id:reason")
 * prevents the same item+reason from being queued twice across pipeline runs.
 *
 * Both import and on-chain row types are processed; on-chain rows do NOT
 * get a low_confidence check (no confidence on onchain rows by design).
 */

import { describe, it, expect } from 'vitest';
import { buildReviewQueue } from '../../src/lib/yearEnd/pass5';
import type { RawImportTx, RawOnchainTx, ClassificationResult } from '../../src/lib/yearEnd/types';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function importRow(overrides: Partial<RawImportTx> & { id: string }): RawImportTx {
	return {
		timestamp_utc: '2024-06-01T00:00:00Z',
		asset_symbol:  'ETH',
		direction:     'in',
		kind:          'buy',
		amount:        1,
		to_amount:     null,
		native_usd:    3_000,
		tx_hash:       null,
		source:        'coinbase',
		notes:         null,
		category:      null,
		...overrides,
	};
}

function onchainRow(overrides: Partial<RawOnchainTx> & { id: string }): RawOnchainTx {
	return {
		timestamp:      '2024-06-01T00:00:00Z',
		token_symbol:   'ETH',
		value:          '1',
		from_address:   '0xabc',
		to_address:     '0xdef',
		tx_type:        'transfer',
		usd_value:      3_000,
		chain:          'ethereum',
		wallet_address: '0xabc',
		...overrides,
	};
}

function cls(
	sourceType: 'import' | 'onchain',
	sourceId: string,
	category: ClassificationResult['category'],
	confidence = 0.9,
): [string, ClassificationResult] {
	return [
		`${sourceType}:${sourceId}`,
		{ sourceType, sourceId, category, confidence, assetSymbol: 'ETH', amountUsd: 100, taxYear: 2024 },
	];
}

function classMap(...entries: [string, ClassificationResult][]): Map<string, ClassificationResult> {
	return new Map(entries);
}

function noExisting(): Set<string> {
	return new Set<string>();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. General behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('General behaviour', () => {
	it('returns empty array for empty inputs', () => {
		const items = buildReviewQueue([], [], classMap(), noExisting());
		expect(items).toHaveLength(0);
	});

	it('returns empty array when every row is well-classified and priced', () => {
		const rows = [importRow({ id: 'r1', native_usd: 100 })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'r1', 'buy')), noExisting());
		expect(items).toHaveLength(0);
	});

	it('processes both import and onchain rows in the same call', () => {
		const iRows = [importRow({ id: 'i1', native_usd: null })];
		const oRows = [onchainRow({ id: 'o1', usd_value: null })];
		const clsMap = classMap(cls('import', 'i1', 'sell'), cls('onchain', 'o1', 'sell'));
		const items = buildReviewQueue(iRows, oRows, clsMap, noExisting());
		const reasons = items.map((x) => x.reason);
		expect(reasons).toContain('missing_price');
		const sources = items.map((x) => x.sourceType);
		expect(sources).toContain('import');
		expect(sources).toContain('onchain');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. unknown_type — import rows
// ─────────────────────────────────────────────────────────────────────────────

describe('unknown_type — import rows', () => {
	it('queues a row with no classification entry', () => {
		const rows = [importRow({ id: 'u1' })];
		const items = buildReviewQueue(rows, [], classMap(), noExisting());
		expect(items).toHaveLength(1);
		expect(items[0].reason).toBe('unknown_type');
		expect(items[0].sourceId).toBe('u1');
		expect(items[0].sourceType).toBe('import');
	});

	it('queues a row whose category is "unknown"', () => {
		const rows = [importRow({ id: 'u2' })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'u2', 'unknown')), noExisting());
		expect(items[0].reason).toBe('unknown_type');
	});

	it('reasonDetail includes the transaction date', () => {
		const rows = [importRow({ id: 'u3', timestamp_utc: '2024-03-15T10:00:00Z' })];
		const items = buildReviewQueue(rows, [], classMap(), noExisting());
		expect(items[0].reasonDetail).toContain('2024-03-15');
	});

	it('reasonDetail includes the kind field', () => {
		const rows = [importRow({ id: 'u4', kind: 'SomeWeirdKind' })];
		const items = buildReviewQueue(rows, [], classMap(), noExisting());
		expect(items[0].reasonDetail).toContain('SomeWeirdKind');
	});

	it('reasonDetail uses "(none)" when kind is null', () => {
		const rows = [importRow({ id: 'u5', kind: null })];
		const items = buildReviewQueue(rows, [], classMap(), noExisting());
		expect(items[0].reasonDetail).toContain('(none)');
	});

	it('snapshotJson is valid JSON containing the symbol', () => {
		const rows = [importRow({ id: 'u6', asset_symbol: 'BTC' })];
		const items = buildReviewQueue(rows, [], classMap(), noExisting());
		const snap = JSON.parse(items[0].snapshotJson!);
		expect(snap.symbol).toBe('BTC');
	});

	it('stops further checks for that row after unknown_type (no additional items)', () => {
		// A row that's unknown AND has no native_usd should only get unknown_type,
		// not also missing_price — the continue statement after unknown_type handles this.
		const rows = [importRow({ id: 'u7', native_usd: null })];
		const items = buildReviewQueue(rows, [], classMap(), noExisting());
		expect(items).toHaveLength(1);
		expect(items[0].reason).toBe('unknown_type');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. unknown_type — onchain rows
// ─────────────────────────────────────────────────────────────────────────────

describe('unknown_type — onchain rows', () => {
	it('queues an onchain row with no classification', () => {
		const rows = [onchainRow({ id: 'ou1' })];
		const items = buildReviewQueue([], rows, classMap(), noExisting());
		expect(items[0].reason).toBe('unknown_type');
		expect(items[0].sourceType).toBe('onchain');
		expect(items[0].sourceId).toBe('ou1');
	});

	it('queues an onchain row classified as "unknown"', () => {
		const rows = [onchainRow({ id: 'ou2' })];
		const items = buildReviewQueue([], rows, classMap(cls('onchain', 'ou2', 'unknown')), noExisting());
		expect(items[0].reason).toBe('unknown_type');
	});

	it('reasonDetail includes the token symbol', () => {
		const rows = [onchainRow({ id: 'ou3', token_symbol: 'USDC' })];
		const items = buildReviewQueue([], rows, classMap(), noExisting());
		expect(items[0].reasonDetail).toContain('USDC');
	});

	it('reasonDetail uses "ETH" when token_symbol is null', () => {
		const rows = [onchainRow({ id: 'ou4', token_symbol: null })];
		const items = buildReviewQueue([], rows, classMap(), noExisting());
		expect(items[0].reasonDetail).toContain('ETH');
	});

	it('stops further checks for unknown onchain row (no missing_price on top)', () => {
		const rows = [onchainRow({ id: 'ou5', usd_value: null })];
		const items = buildReviewQueue([], rows, classMap(), noExisting());
		expect(items).toHaveLength(1);
		expect(items[0].reason).toBe('unknown_type');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. low_confidence — import rows only
// ─────────────────────────────────────────────────────────────────────────────

describe('low_confidence — import rows', () => {
	it('queues an import row with confidence < 0.7', () => {
		const rows = [importRow({ id: 'lc1', native_usd: 100 })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'lc1', 'income', 0.5)), noExisting());
		expect(items.some((x) => x.reason === 'low_confidence')).toBe(true);
	});

	it('does NOT queue a row with confidence exactly 0.7', () => {
		const rows = [importRow({ id: 'lc2', native_usd: 100 })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'lc2', 'buy', 0.7)), noExisting());
		expect(items.filter((x) => x.reason === 'low_confidence')).toHaveLength(0);
	});

	it('does NOT queue a row with confidence above 0.7', () => {
		const rows = [importRow({ id: 'lc3', native_usd: 100 })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'lc3', 'buy', 0.95)), noExisting());
		expect(items).toHaveLength(0);
	});

	it('reasonDetail contains the auto category', () => {
		const rows = [importRow({ id: 'lc4', native_usd: 100 })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'lc4', 'airdrop', 0.4)), noExisting());
		const item = items.find((x) => x.reason === 'low_confidence')!;
		expect(item.reasonDetail).toContain('airdrop');
	});

	it('reasonDetail contains the rounded confidence percentage', () => {
		const rows = [importRow({ id: 'lc5', native_usd: 100 })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'lc5', 'income', 0.45)), noExisting());
		const item = items.find((x) => x.reason === 'low_confidence')!;
		expect(item.reasonDetail).toContain('45%');
	});

	it('snapshotJson includes the autoCategory field', () => {
		const rows = [importRow({ id: 'lc6', native_usd: 100 })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'lc6', 'swap', 0.6)), noExisting());
		const snap = JSON.parse(items.find((x) => x.reason === 'low_confidence')!.snapshotJson!);
		expect(snap.autoCategory).toBe('swap');
	});

	it('can produce BOTH low_confidence AND missing_price for the same row', () => {
		// Low confidence + taxable category + no price → both items
		const rows = [importRow({ id: 'lc7', native_usd: null })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'lc7', 'sell', 0.5)), noExisting());
		const reasons = items.map((x) => x.reason);
		expect(reasons).toContain('low_confidence');
		expect(reasons).toContain('missing_price');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. missing_price — import rows
// ─────────────────────────────────────────────────────────────────────────────

describe('missing_price — import rows', () => {
	const TAXABLE: ClassificationResult['category'][] = [
		'sell', 'swap', 'liquidation', 'burn', 'lost', 'nft-sale', 'income', 'airdrop',
	];
	const NON_TAXABLE: ClassificationResult['category'][] = [
		'buy', 'transfer', 'fee', 'loan-proceeds', 'loan-repayment',
		'collateral-deposit', 'loan-interest-paid',
	];

	it.each(TAXABLE)(
		'queues a missing_price item for taxable category "%s" when native_usd is null',
		(cat) => {
			const rows = [importRow({ id: `mp-${cat}`, native_usd: null })];
			const items = buildReviewQueue(rows, [], classMap(cls('import', `mp-${cat}`, cat)), noExisting());
			expect(items.some((x) => x.reason === 'missing_price'), `${cat} should trigger missing_price`).toBe(true);
		},
	);

	it.each(NON_TAXABLE)(
		'does NOT queue missing_price for non-taxable category "%s"',
		(cat) => {
			const rows = [importRow({ id: `no-mp-${cat}`, native_usd: null })];
			const items = buildReviewQueue(rows, [], classMap(cls('import', `no-mp-${cat}`, cat)), noExisting());
			expect(items.filter((x) => x.reason === 'missing_price')).toHaveLength(0);
		},
	);

	it('does NOT queue missing_price when native_usd is present and positive', () => {
		const rows = [importRow({ id: 'mp2', native_usd: 500 })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'mp2', 'sell')), noExisting());
		expect(items.filter((x) => x.reason === 'missing_price')).toHaveLength(0);
	});

	it('queues missing_price when native_usd is 0 (falsy)', () => {
		const rows = [importRow({ id: 'mp3', native_usd: 0 })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'mp3', 'sell')), noExisting());
		expect(items.some((x) => x.reason === 'missing_price')).toBe(true);
	});

	it('reasonDetail includes the asset symbol', () => {
		const rows = [importRow({ id: 'mp4', asset_symbol: 'SOL', native_usd: null })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'mp4', 'sell')), noExisting());
		const item = items.find((x) => x.reason === 'missing_price')!;
		expect(item.reasonDetail).toContain('SOL');
	});

	it('reasonDetail uses "tokens" when asset_symbol is null', () => {
		const rows = [importRow({ id: 'mp5', asset_symbol: null, native_usd: null })];
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'mp5', 'sell')), noExisting());
		const item = items.find((x) => x.reason === 'missing_price')!;
		expect(item.reasonDetail).toContain('tokens');
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. missing_price — onchain rows
// ─────────────────────────────────────────────────────────────────────────────

describe('missing_price — onchain rows', () => {
	const TAXABLE: ClassificationResult['category'][] = [
		'sell', 'swap', 'liquidation', 'burn', 'lost', 'nft-sale', 'income', 'airdrop',
	];

	it.each(TAXABLE)(
		'queues missing_price for onchain taxable "%s" when usd_value is null',
		(cat) => {
			const rows = [onchainRow({ id: `omp-${cat}`, usd_value: null })];
			const items = buildReviewQueue([], rows, classMap(cls('onchain', `omp-${cat}`, cat)), noExisting());
			expect(items.some((x) => x.reason === 'missing_price')).toBe(true);
		},
	);

	it('does NOT queue missing_price when usd_value is positive', () => {
		const rows = [onchainRow({ id: 'omp2', usd_value: 1_000 })];
		const items = buildReviewQueue([], rows, classMap(cls('onchain', 'omp2', 'sell')), noExisting());
		expect(items.filter((x) => x.reason === 'missing_price')).toHaveLength(0);
	});

	it('queues missing_price when usd_value is 0 (falsy)', () => {
		const rows = [onchainRow({ id: 'omp3', usd_value: 0 })];
		const items = buildReviewQueue([], rows, classMap(cls('onchain', 'omp3', 'sell')), noExisting());
		expect(items.some((x) => x.reason === 'missing_price')).toBe(true);
	});

	it('reasonDetail includes the token symbol', () => {
		const rows = [onchainRow({ id: 'omp4', token_symbol: 'MATIC', usd_value: null })];
		const items = buildReviewQueue([], rows, classMap(cls('onchain', 'omp4', 'income')), noExisting());
		expect(items.find((x) => x.reason === 'missing_price')!.reasonDetail).toContain('MATIC');
	});

	it('reasonDetail uses "tokens" when token_symbol is null', () => {
		const rows = [onchainRow({ id: 'omp5', token_symbol: null, usd_value: null })];
		const items = buildReviewQueue([], rows, classMap(cls('onchain', 'omp5', 'sell')), noExisting());
		expect(items.find((x) => x.reason === 'missing_price')!.reasonDetail).toContain('tokens');
	});

	it('onchain does NOT check low_confidence (no such field on onchain rows)', () => {
		// Well-classified onchain sell with a price → zero items
		const rows = [onchainRow({ id: 'omp6', usd_value: 500 })];
		const items = buildReviewQueue([], rows, classMap(cls('onchain', 'omp6', 'sell', 0.1)), noExisting());
		// low_confidence check doesn't exist for onchain — only unknown and missing_price
		expect(items.filter((x) => x.reason === 'low_confidence')).toHaveLength(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Deduplication via existingReviewKeys
// ─────────────────────────────────────────────────────────────────────────────

describe('Deduplication via existingReviewKeys', () => {
	it('does not re-queue an unknown_type item already in the set', () => {
		const rows = [importRow({ id: 'dup1' })];
		const existing = new Set(['import:dup1:unknown_type']);
		const items = buildReviewQueue(rows, [], classMap(), existing);
		expect(items).toHaveLength(0);
	});

	it('does not re-queue a low_confidence item already in the set', () => {
		const rows = [importRow({ id: 'dup2', native_usd: 100 })];
		const existing = new Set(['import:dup2:low_confidence']);
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'dup2', 'sell', 0.5)), existing);
		expect(items.filter((x) => x.reason === 'low_confidence')).toHaveLength(0);
	});

	it('does not re-queue a missing_price item already in the set', () => {
		const rows = [importRow({ id: 'dup3', native_usd: null })];
		const existing = new Set(['import:dup3:missing_price']);
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'dup3', 'sell')), existing);
		expect(items.filter((x) => x.reason === 'missing_price')).toHaveLength(0);
	});

	it('only deduplicates the exact reason — other reasons still queue', () => {
		// missing_price already queued, but low_confidence is new → low_confidence queues
		const rows = [importRow({ id: 'dup4', native_usd: null })];
		const existing = new Set(['import:dup4:missing_price']);
		const items = buildReviewQueue(rows, [], classMap(cls('import', 'dup4', 'sell', 0.4)), existing);
		expect(items.filter((x) => x.reason === 'missing_price')).toHaveLength(0);
		expect(items.filter((x) => x.reason === 'low_confidence')).toHaveLength(1);
	});

	it('deduplicates onchain unknown_type correctly', () => {
		const rows = [onchainRow({ id: 'odup1' })];
		const existing = new Set(['onchain:odup1:unknown_type']);
		const items = buildReviewQueue([], rows, classMap(), existing);
		expect(items).toHaveLength(0);
	});

	it('does NOT deduplicate a different sourceId with the same reason', () => {
		const rows = [importRow({ id: 'new1' })];
		const existing = new Set(['import:old1:unknown_type']); // different id
		const items = buildReviewQueue(rows, [], classMap(), existing);
		expect(items).toHaveLength(1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. snapshotJson validity
// ─────────────────────────────────────────────────────────────────────────────

describe('snapshotJson validity', () => {
	it('all import review items have valid JSON snapshots', () => {
		const rows = [
			importRow({ id: 's1' }),                                               // unknown
			importRow({ id: 's2', native_usd: 100 }),                              // low confidence
			importRow({ id: 's3', native_usd: null }),                             // missing price (sell)
		];
		const clsMap = classMap(
			cls('import', 's2', 'income', 0.3),
			cls('import', 's3', 'sell', 0.9),
		);
		const items = buildReviewQueue(rows, [], clsMap, noExisting());
		for (const item of items) {
			expect(() => JSON.parse(item.snapshotJson!), `invalid JSON for reason ${item.reason}`).not.toThrow();
		}
	});

	it('all onchain review items have valid JSON snapshots', () => {
		const rows = [
			onchainRow({ id: 'os1' }),                                             // unknown
			onchainRow({ id: 'os2', usd_value: null }),                            // missing price
		];
		const clsMap = classMap(cls('onchain', 'os2', 'sell'));
		const items = buildReviewQueue([], rows, clsMap, noExisting());
		for (const item of items) {
			expect(() => JSON.parse(item.snapshotJson!)).not.toThrow();
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Multi-row batches
// ─────────────────────────────────────────────────────────────────────────────

describe('Multi-row batches', () => {
	it('processes all rows independently and returns one item per trigger', () => {
		const iRows = [
			importRow({ id: 'b1' }),                                               // unknown
			importRow({ id: 'b2', native_usd: null }),                             // low conf + missing price
			importRow({ id: 'b3', native_usd: 500 }),                             // clean
		];
		const oRows = [
			onchainRow({ id: 'ob1' }),                                             // unknown
			onchainRow({ id: 'ob2', usd_value: null }),                            // missing price
		];
		const clsMap = classMap(
			cls('import', 'b2', 'airdrop', 0.4),
			cls('import', 'b3', 'buy', 0.99),
			cls('onchain', 'ob2', 'income'),
		);
		const items = buildReviewQueue(iRows, oRows, clsMap, noExisting());

		const bySource = (id: string) => items.filter((x) => x.sourceId === id);
		expect(bySource('b1')).toHaveLength(1);          // unknown_type only
		expect(bySource('b2')).toHaveLength(2);          // low_confidence + missing_price
		expect(bySource('b3')).toHaveLength(0);          // clean
		expect(bySource('ob1')).toHaveLength(1);         // unknown_type
		expect(bySource('ob2')).toHaveLength(1);         // missing_price
	});

	it('total item count is correct across a mixed batch', () => {
		const iRows = [
			importRow({ id: 'm1' }),                   // 1 (unknown)
			importRow({ id: 'm2', native_usd: null }), // 1 (unknown — stops further checks)
		];
		const items = buildReviewQueue(iRows, [], classMap(), noExisting());
		expect(items).toHaveLength(2);
		expect(items.every((x) => x.reason === 'unknown_type')).toBe(true);
	});
});
