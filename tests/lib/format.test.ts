import { describe, expect, it } from 'vitest';
import {
	formatDate,
	formatDateTime,
	formatMoney,
	formatNumber,
	formatPercent,
	formatQty,
	formatTime,
	formatUsd,
	formatUtc,
	toDate,
	toFiniteNumber,
} from '@/lib/format';
import { formatUtc as reportFormatUtc } from '@/lib/agentVault/reportFormat';

/**
 * src/lib/format.ts: dollars en-US in every language (D1), screen dates in the user's language
 * (D2), token amounts as exact text, and the fixed UTC format files use. Every time that shows a
 * clock is pinned to UTC here, so the suite gives the same answers in any zone CI runs in.
 */

describe('formatUsd (D1: en-US in every language)', () => {
	it('two decimals, thousands separators, minus before the dollar sign', () => {
		expect(formatUsd(1234.5)).toBe('$1,234.50');
		expect(formatUsd(-1234.567)).toBe('-$1,234.57');
		expect(formatUsd(0)).toBe('$0.00');
		expect(formatUsd(1e9)).toBe('$1,000,000,000.00');
	});

	it('-0 shows no sign; a tiny negative that rounds to zero keeps its minus', () => {
		expect(formatUsd(-0)).toBe('$0.00');
		expect(formatUsd(-0.001)).toBe('-$0.00');
	});

	it('signed: a plus on zero and positives', () => {
		expect(formatUsd(5, { signed: true })).toBe('+$5.00');
		expect(formatUsd(0, { signed: true })).toBe('+$0.00');
		expect(formatUsd(-5, { signed: true })).toBe('-$5.00');
	});

	it('cents: false rounds to whole dollars; a number is exactly that many decimals', () => {
		expect(formatUsd(1234.5, { cents: false })).toBe('$1,235');
		expect(formatUsd(-0.4, { cents: false })).toBe('-$0');
		expect(formatUsd(0.012345, { cents: 4 })).toBe('$0.0123');
		expect(formatUsd(3.1, { cents: 4 })).toBe('$3.1000');
		expect(formatUsd(3.1, { cents: 1 })).toBe('$3.1');
	});

	it('compact', () => {
		expect(formatUsd(1234, { compact: true })).toBe('$1.2K');
		expect(formatUsd(-3_400_000, { compact: true })).toBe('-$3.4M');
	});

	it('null, undefined, NaN, Infinity and non-numbers show the empty text', () => {
		for (const v of [null, undefined, Number.NaN, Infinity, -Infinity, '', 'abc', {}]) {
			expect(formatUsd(v)).toBe('—');
			expect(formatUsd(v, { empty: '' })).toBe('');
		}
		expect(formatUsd('12.5')).toBe('$12.50');
	});
});

describe('formatMoney (receivables)', () => {
	it('currency code, space, en-US digits with cents', () => {
		expect(formatMoney(1234, 'NGN')).toBe('NGN 1,234.00');
		expect(formatMoney(1234.567, 'USD')).toBe('USD 1,234.57');
	});
	it('minDecimals 0 drops trailing zeros (the milestone pages)', () => {
		expect(formatMoney(1234, 'NGN', { minDecimals: 0 })).toBe('NGN 1,234');
		expect(formatMoney(1234.5, 'NGN', { minDecimals: 0 })).toBe('NGN 1,234.5');
	});
	it('a missing amount shows 0, as the pages always have', () => {
		expect(formatMoney(null, 'KES')).toBe('KES 0.00');
		expect(formatMoney(Number.NaN, 'KES')).toBe('KES 0.00');
		expect(formatMoney(undefined, 'KES', { minDecimals: 0 })).toBe('KES 0');
	});
});

describe('formatQty (exact token amounts)', () => {
	it('keeps every digit of decimal text, no floating point', () => {
		expect(formatQty('1234567.891234567891234')).toBe('1,234,567.891234567891234');
		expect(formatQty('0.000000000000000001')).toBe('0.000000000000000001');
		expect(formatQty('-0.00012')).toBe('-0.00012');
		expect(formatQty('00012.50')).toBe('12.5');
	});
	it('numbers, exponent form and smallest units', () => {
		expect(formatQty(1.5e-7)).toBe('0.00000015');
		expect(formatQty(-12.5)).toBe('-12.5');
		expect(formatQty('1500000000000000000', { decimals: 18 })).toBe('1.5');
		expect(formatQty(1500000000000000000n, { decimals: 18 })).toBe('1.5');
		expect(formatQty('0x0de0b6b3a7640000', { decimals: 18 })).toBe('1');
	});
	it('maxDecimals cuts, never rounds up', () => {
		expect(formatQty('0.123456789', { maxDecimals: 6 })).toBe('0.123456');
		expect(formatQty('9.9999999', { maxDecimals: 2 })).toBe('9.99');
		expect(formatQty('-0.0000001', { maxDecimals: 4 })).toBe('0');
	});
	it('group: false and empty values', () => {
		expect(formatQty('1234567', { group: false })).toBe('1234567');
		for (const v of [null, undefined, '', 'abc', Number.NaN, Infinity]) expect(formatQty(v)).toBe('—');
		expect(formatQty(null, { empty: '' })).toBe('');
	});
});

describe('formatNumber / formatPercent follow the language', () => {
	it('separators per language', () => {
		expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
		expect(formatNumber(1234.5, 'es')).toBe('1234,5');
		expect(formatNumber(12345.5, 'es')).toBe('12.345,5');
		expect(formatNumber(1234.5, 'fr')).toBe('1 234,5');
		expect(formatPercent(0.0825, 'en')).toBe('8.25%');
		expect(formatPercent(0.0825, 'fr')).toBe('8,25 %');
	});
});

describe('toDate / toFiniteNumber', () => {
	it('reads the shapes the app stores', () => {
		expect(toDate('2026-10-25T15:04:05.000Z')?.toISOString()).toBe('2026-10-25T15:04:05.000Z');
		expect(toDate('2026-10-25 15:04:05')?.toISOString()).toBe('2026-10-25T15:04:05.000Z');
		expect(toDate('2026-10-25')?.toISOString()).toBe('2026-10-25T00:00:00.000Z');
		expect(toDate(Date.UTC(2026, 9, 25))?.toISOString()).toBe('2026-10-25T00:00:00.000Z');
		for (const v of [null, undefined, '', 'nope', Number.NaN, new Date('x'), {}]) expect(toDate(v)).toBeNull();
	});
	it('numbers from numbers and numeric text only', () => {
		expect(toFiniteNumber('1.5')).toBe(1.5);
		expect(toFiniteNumber(3n)).toBe(3);
		for (const v of [null, undefined, '', ' ', 'x', Number.NaN, Infinity, true]) expect(toFiniteNumber(v)).toBeNull();
	});
});

describe('formatDate / formatDateTime (D2: the language on screens)', () => {
	const T = '2026-10-25T15:04:05.000Z';
	const utc = { timeZone: 'UTC' } as const;
	it('medium (default)', () => {
		expect(formatDate(T, 'en', utc)).toBe('Oct 25, 2026');
		expect(formatDate(T, 'es', utc)).toBe('25 oct 2026');
		expect(formatDate(T, 'fr', utc)).toBe('25 oct. 2026');
	});
	it('other styles', () => {
		expect(formatDate(T, 'en', { ...utc, style: 'long' })).toBe('October 25, 2026');
		expect(formatDate(T, 'es', { ...utc, style: 'long' })).toBe('25 de octubre de 2026');
		expect(formatDate(T, 'fr', { ...utc, style: 'long' })).toBe('25 octobre 2026');
		expect(formatDate(T, 'en', { ...utc, style: 'short' })).toBe('10/25/2026');
		expect(formatDate(T, 'fr', { ...utc, style: 'short' })).toBe('25/10/2026');
		expect(formatDate(T, 'en', { ...utc, style: 'dayMonth' })).toBe('Oct 25');
		expect(formatDate(T, 'en', { ...utc, style: 'monthYear' })).toBe('Oct 2026');
	});
	it('date and time', () => {
		expect(formatDateTime(T, 'en', utc)).toBe('Oct 25, 2026, 3:04 PM');
		expect(formatDateTime(T, 'es', utc)).toBe('25 oct 2026, 15:04');
		expect(formatDateTime(T, 'fr', utc)).toBe('25 oct. 2026, 15:04');
		expect(formatDateTime(T, 'en', { ...utc, seconds: true })).toBe('Oct 25, 2026, 3:04:05 PM');
		expect(formatTime(T, 'en', utc)).toBe('3:04 PM');
		expect(formatTime(T, 'fr', utc)).toBe('15:04');
	});
	it('a bare day with timeZone UTC is that day in any zone', () => {
		expect(formatDate('2026-01-01', 'en', utc)).toBe('Jan 1, 2026');
	});
	it('missing values show the empty text; unreadable text is shown as it is', () => {
		expect(formatDate(null, 'en')).toBe('—');
		expect(formatDate('', 'fr', { empty: '' })).toBe('');
		expect(formatDate('soon', 'en')).toBe('soon');
		expect(formatDateTime(undefined, 'es')).toBe('—');
		expect(formatTime(Number.NaN, 'en')).toBe('—');
	});
});

describe('formatUtc (files)', () => {
	it('fixed UTC text, and reportFormat re-exports the same function', () => {
		expect(formatUtc('2026-10-18T09:10:00.000Z')).toBe('2026-10-18 09:10:00 UTC');
		expect(formatUtc('not a time')).toBe('not a time');
		expect(reportFormatUtc).toBe(formatUtc);
	});
});
