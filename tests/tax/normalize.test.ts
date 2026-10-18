import { describe, it, expect, vi } from 'vitest';

// lifecycle.ts and historyRows.ts (compared against below) open the database at import; the helpers are pure.
vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [], rowsAffected: 0 }) } }));

import { normalizeAmount, normalizeAsset, normalizeTxHash, parseInstant } from '../../src/lib/tax/normalize';
import { AMOUNT_TOLERANCE, LINK_WINDOW_MINUTES, selectArrivalMatch } from '../../src/lib/tax/arrivalMatch';
import * as lifecycle from '../../src/lib/lifecycle';
import { toUtcDate } from '../../src/lib/historyRows';

/**
 * src/lib/tax/normalize.ts and arrivalMatch.ts: the pure pieces moved out of lifecycle.ts so the
 * ledger core and the transfer resolver can use them without its database import. lifecycle.ts
 * imports them back, so its results do not change: these tests pin that the lifecycle module is
 * handed the same functions, and what they do.
 */

describe('lifecycle.ts uses, and still exports, the moved functions', () => {
	it('exports the same functions', () => {
		expect(lifecycle.normalizeAmount).toBe(normalizeAmount);
		expect(lifecycle.normalizeAsset).toBe(normalizeAsset);
		expect(lifecycle.selectArrivalMatch).toBe(selectArrivalMatch);
	});

	it('keeps the lifecycle rebuild\'s link window and tolerance (6 hours, 1%)', () => {
		expect(LINK_WINDOW_MINUTES).toBe(360);
		expect(AMOUNT_TOLERANCE).toBe(0.01);
	});
});

describe('normalizeAsset', () => {
	it.each([
		['eth', undefined, 'ETH'],
		['Usdc', null, 'USDC'],
		['MATIC', undefined, 'POL'],
		['wmatic', undefined, 'POL'],
		['POL', undefined, 'POL'],
		['native', 'ethereum', 'ETH'],
		['NATIVE', 'polygon', 'POL'],
		['native', 'avalanche', 'AVAX'],
		// Only the three chains the lifecycle rebuild knew; any other stays as it is.
		['native', 'bsc', 'NATIVE'],
		['native', undefined, 'NATIVE'],
		['native', 'eth', 'NATIVE'],
		['', undefined, ''],
	])('%s on %s is %s', (symbol, chain, out) => {
		expect(normalizeAsset(symbol, chain)).toBe(out);
	});
});

describe('normalizeAmount', () => {
	it.each([
		['1500000000000000000', 18, 1.5],
		['1000000000000000000', 18, 1],
		['1', 18, 1e-18],
		['2500000', 6, 2.5],
		['123456789', 8, 1.23456789],
		['100000000', 8, 1],
		['0', 18, 0],
		['42', 1, 4.2],
		['5', 2, 0.05],
	])('%s with %s decimals is %s', (value, decimals, out) => {
		expect(normalizeAmount(value, decimals)).toBe(out);
	});

	it('reads a missing or non-finite decimals as 18, as the rebuild always has', () => {
		expect(normalizeAmount('1500000000000000000', null)).toBe(1.5);
		expect(normalizeAmount('1500000000000000000', Number.NaN)).toBe(1.5);
		expect(normalizeAmount('1500000000000000000', Number.POSITIVE_INFINITY)).toBe(1.5);
	});

	it('an empty or unreadable value is null', () => {
		expect(normalizeAmount(null, 18)).toBeNull();
		expect(normalizeAmount('', 18)).toBeNull();
		expect(normalizeAmount('abc', 18)).toBeNull();
	});

	// Known gap, kept so the lifecycle rebuild does not change (see normalize.ts): 0 decimals reads the
	// value as a fraction. Fixing it is a deliberate lifecycle change; when it lands, flip this to `it`.
	it.fails('a token with 0 decimals reads its value as whole units', () => {
		expect(normalizeAmount('5', 0)).toBe(5);
		expect(normalizeAmount('100', 0)).toBe(100);
	});
});

describe('normalizeTxHash', () => {
	const HEX = 'ab12'.repeat(16);
	it.each([
		[`0x${HEX}`, HEX],
		[`0X${HEX}`.replace('0X', '0x'), HEX],
		[HEX.toUpperCase(), HEX],
		[`  0x${HEX.toUpperCase()}  `, HEX],
		['', ''],
		[null, ''],
		[undefined, ''],
		// Not 64 hex digits: kept exactly (Solana signatures, Sui digests, exchange ids are case-sensitive).
		['5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW', '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW'],
		['TXID-AbC-123', 'TXID-AbC-123'],
		['0xabc', '0xabc'],
	])('%s', (input, out) => {
		expect(normalizeTxHash(input)).toBe(out);
	});
});

describe('parseInstant', () => {
	it.each([
		['2025-03-04T12:34:56.000Z', Date.UTC(2025, 2, 4, 12, 34, 56)],
		['2025-03-04T12:34:56Z', Date.UTC(2025, 2, 4, 12, 34, 56)],
		['2025-03-04 12:34:56', Date.UTC(2025, 2, 4, 12, 34, 56)], // stored without a zone means UTC
		['2025-03-04T12:34:56', Date.UTC(2025, 2, 4, 12, 34, 56)],
		['2025-03-04 12:34', Date.UTC(2025, 2, 4, 12, 34)],
		['2025-03-04 12:34:56.250', Date.UTC(2025, 2, 4, 12, 34, 56, 250)],
		['2025-03-04T14:34:56+02:00', Date.UTC(2025, 2, 4, 12, 34, 56)],
		['2025-03-04', Date.UTC(2025, 2, 4)],
		['  2025-03-04 00:00:00  ', Date.UTC(2025, 2, 4)],
	])('%s', (input, ms) => {
		expect(parseInstant(input)).toBe(ms);
	});

	it('a Date is its own instant', () => {
		expect(parseInstant(new Date(Date.UTC(2025, 0, 1)))).toBe(Date.UTC(2025, 0, 1));
	});

	it.each([[''], ['   '], [null], [undefined], ['not a date'], ['2025-13-45 00:00:00'], ['2025-03-04T25:00:00Z'], ['2025-03-04T12:60:00Z']])('%j cannot be read', (input) => {
		expect(parseInstant(input)).toBeNull();
	});

	// Date.parse reads these in the machine's zone, or rolls a day that does not exist into the next month.
	it.each([['Mar 4, 2025'], ['03/04/2025'], ['2025/03/04'], ['20250304'], ['2025-02-30'], ['2025-02-29'], ['2025-04-31 10:00:00'], ['2025-03-04T12:34:56+02'], ['2025-03-04t12:00:00z']])(
		'%j is not a stored timestamp',
		(input) => {
			expect(parseInstant(input)).toBeNull();
		},
	);

	it('a day that exists is read: Feb 29 in a leap year, the last day of a month', () => {
		expect(parseInstant('2024-02-29')).toBe(Date.UTC(2024, 1, 29));
		expect(parseInstant('2025-04-30 23:59:59')).toBe(Date.UTC(2025, 3, 30, 23, 59, 59));
		expect(parseInstant('2025-03-04T14:34:56+0200')).toBe(Date.UTC(2025, 2, 4, 12, 34, 56));
		expect(parseInstant('2025-03-04 14:34:56-05:00')).toBe(Date.UTC(2025, 2, 4, 19, 34, 56));
	});

	it('reads every spelling the way the records export does', () => {
		for (const raw of ['2025-03-04T12:34:56.000Z', '2025-03-04 12:34:56', '2025-03-04T12:34:56', '2025-03-04T14:34:56+02:00', '2025-03-04', '2024-02-29 23:59:59']) {
			expect(parseInstant(raw), raw).toBe(Date.parse(toUtcDate(raw).sortKey));
		}
		expect(toUtcDate('not a date').date).toBe('not a date');
		expect(parseInstant('not a date')).toBeNull();
	});
});
