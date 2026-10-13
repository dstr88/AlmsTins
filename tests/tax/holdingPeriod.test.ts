import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { daysUntilLongTerm, isLongTermHold, isShortTermHold } from '../../src/lib/yearEnd/holdingPeriod';

/**
 * src/lib/yearEnd/holdingPeriod.ts: long-term means held MORE than one year, by calendar
 * date (IRS Publication 544: bought Feb 5, 2024 and sold Feb 5, 2025 is not more than
 * one year; sold Feb 6, 2025 is). Both gain engines use it.
 */

describe('isLongTermHold', () => {
	it.each([
		// [acquired, disposed, long-term?]
		['2024-02-05T00:00:00Z', '2025-02-05T00:00:00Z', false], // Publication 544's own example
		['2024-02-05T00:00:00Z', '2025-02-06T00:00:00Z', true],
		['2023-01-01T00:00:00Z', '2024-01-01T00:00:00Z', false], // 365 days, exactly one year
		['2023-01-01T00:00:00Z', '2024-01-02T00:00:00Z', true],
		['2024-01-01T00:00:00Z', '2025-01-01T00:00:00Z', false], // 366 days across Feb 29, still exactly one year
		['2024-01-01T00:00:00Z', '2025-01-02T00:00:00Z', true],
		['2023-03-01T00:00:00Z', '2024-03-01T00:00:00Z', false], // a 366-day span ending in a leap year
		['2023-03-01T00:00:00Z', '2024-03-02T00:00:00Z', true],
		['2025-06-15T00:00:00Z', '2025-12-31T00:00:00Z', false],
	] as const)('acquired %s, disposed %s → long-term %s', (acq, disp, long) => {
		expect(isLongTermHold(acq, disp)).toBe(long);
		expect(isShortTermHold(acq, disp)).toBe(!long);
	});

	it('time of day never tips the anniversary into long-term', () => {
		// The old timestamp compare (pass4) called this long-term; the old 365-day count
		// (annualBreakdown) called the next case long-term. Both are exactly one year.
		expect(isLongTermHold('2024-01-01T10:00:00Z', '2025-01-01T23:59:59Z')).toBe(false);
		expect(isLongTermHold('2024-03-10T23:00:00Z', '2025-03-10T01:00:00Z')).toBe(false);
		expect(isLongTermHold('2024-03-10T23:00:00Z', '2025-03-11T00:00:01Z')).toBe(true);
	});

	it('a Feb 29 acquisition reaches its anniversary on Feb 28', () => {
		expect(isLongTermHold('2024-02-29T00:00:00Z', '2025-02-28T00:00:00Z')).toBe(false);
		expect(isLongTermHold('2024-02-29T00:00:00Z', '2025-03-01T00:00:00Z')).toBe(true);
		// Into another leap year, Feb 29 is its own anniversary.
		expect(isLongTermHold('2028-02-29T00:00:00Z', '2029-02-28T00:00:00Z')).toBe(false);
	});

	it('the last day of a month counts to the same day a year later', () => {
		expect(isLongTermHold('2024-01-31T00:00:00Z', '2025-01-31T00:00:00Z')).toBe(false);
		expect(isLongTermHold('2024-01-31T00:00:00Z', '2025-02-01T00:00:00Z')).toBe(true);
	});

	it('an unreadable date is never long-term', () => {
		expect(isLongTermHold('', '2025-01-02T00:00:00Z')).toBe(false);
		expect(isLongTermHold('2024-01-01T00:00:00Z', 'not a date')).toBe(false);
		expect(isShortTermHold('', '')).toBe(true);
	});
});

describe('daysUntilLongTerm', () => {
	it('counts to the day after the anniversary, and is 0 from then on', () => {
		expect(daysUntilLongTerm('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z')).toBe(2);
		expect(daysUntilLongTerm('2024-01-01T00:00:00Z', '2025-01-01T12:00:00Z')).toBe(1);
		expect(daysUntilLongTerm('2024-01-01T00:00:00Z', '2025-01-02T00:00:00Z')).toBe(0);
		expect(daysUntilLongTerm('2020-05-05T00:00:00Z', '2025-01-01T00:00:00Z')).toBe(0);
		expect(daysUntilLongTerm('2024-02-29T00:00:00Z', '2025-02-27T00:00:00Z')).toBe(2);
		expect(daysUntilLongTerm('nope', '2025-01-01T00:00:00Z')).toBeNull();
	});
});

// The 365-day count was the bug; no gain code may classify by a day count again.
describe('no day-count classification left in gain code', () => {
	const read = (p: string) => fs.readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
	it.each([
		'src/lib/annualBreakdown.ts',
		'src/lib/yearEndSummary.ts',
		'src/lib/yearEnd/pass4.ts',
		'src/pages/dashboard/bookkeeping.astro',
		'src/components/ExchangeAccounts.astro',
		'src/components/CryptoComAccounts.astro',
		'src/components/dashboard/WalletSummary.tsx',
	])('%s', (p) => {
		expect(read(p)).not.toMatch(/(daysHeld|days)\s*(>=|<|>|<=)\s*36[56]\b/);
		expect(read(p)).not.toMatch(/36[56]\s*-\s*(lot\.)?daysHeld/);
	});
	it('the help text says one year, in every language', () => {
		for (const p of ['src/i18n/dashboard/annual-records.ts', 'src/pages/year-summary.astro']) {
			expect(read(p)).not.toMatch(/365 (days|días|jours)/);
		}
	});
});

