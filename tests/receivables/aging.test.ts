import { describe, it, expect } from 'vitest';
import {
	agingStateOf,
	effectivePromisedDate,
	GRACE_DAYS,
	LAPSE_AFTER_DAYS,
} from '../../src/lib/receivables/aging';

/**
 * src/lib/receivables/aging.ts as pure functions — the single derivation every surface calls
 * (the receivables-aging plan, locked 2026-10-31). `now` is always a parameter; nothing here
 * reads the system time. All dates are invented example data.
 */

const DAY_MS = 86_400_000;
const at = (iso: string) => new Date(iso);

/** A recent touch, so only the date math is under test. */
const FRESH = '2026-03-01 00:00:00';

describe('the named constants are the locked design values', () => {
	it('GRACE_DAYS is 10 calendar days', () => {
		expect(GRACE_DAYS).toBe(10);
	});
	it('LAPSE_AFTER_DAYS is 180 days', () => {
		expect(LAPSE_AFTER_DAYS).toBe(180);
	});
});

describe('date boundaries (due 2026-03-10, grace through 2026-03-20)', () => {
	it.each([
		['the day before the due date', '2026-03-09T00:00:00Z', 'active'],
		['on the due date, morning', '2026-03-10T00:00:00Z', 'active'],
		['on the due date, one second to midnight', '2026-03-10T23:59:59Z', 'active'],
		['grace day 1', '2026-03-11T00:00:00Z', 'due_in_grace'],
		['grace day 10, end of day', '2026-03-20T23:59:59Z', 'due_in_grace'],
		['day 11 — grace expired', '2026-03-21T00:00:00Z', 'past_due_not_updated'],
	] as const)('%s → %s', (_name, now, state) => {
		expect(agingStateOf('2026-03-10', [], 'active', FRESH, at(now))).toBe(state);
	});
});

describe('extensions reset the date and the grace window', () => {
	const chain = [{ newPromisedDate: '2026-04-01' }, { newPromisedDate: '2026-05-01' }];

	it('the LAST extension wins: past the first date but before the second is active', () => {
		expect(agingStateOf('2026-03-10', chain, 'active', '2026-04-15 09:00:00', at('2026-04-20T00:00:00Z'))).toBe('active');
	});

	it('a fresh grace window runs from the extended date', () => {
		expect(agingStateOf('2026-03-10', chain, 'active', '2026-04-15 09:00:00', at('2026-05-11T00:00:00Z'))).toBe('due_in_grace');
		expect(agingStateOf('2026-03-10', chain, 'active', '2026-04-15 09:00:00', at('2026-05-12T00:00:00Z'))).toBe('past_due_not_updated');
	});

	it('an entry without a valid date is skipped, not treated as clearing the date', () => {
		expect(effectivePromisedDate('2026-03-10', [{ newPromisedDate: '2026-04-01' }, { newPromisedDate: null }])).toBe('2026-04-01');
		expect(effectivePromisedDate('2026-03-10', [{ newPromisedDate: 'not-a-date' }])).toBe('2026-03-10');
	});

	it('without any extension the due date stands; an invalid due date reads as none', () => {
		expect(effectivePromisedDate('2026-03-10', [])).toBe('2026-03-10');
		expect(effectivePromisedDate(null, [])).toBeNull();
		expect(effectivePromisedDate('March 10', [])).toBeNull();
	});
});

describe('settled short-circuits', () => {
	it('a discharged claim reads settled, whatever the dates say', () => {
		expect(agingStateOf('2020-01-01', [], 'discharged', '2020-01-01 00:00:00', at('2026-03-10T00:00:00Z'))).toBe('settled');
	});
	it('settled beats lapse: an ancient discharged claim never reads lapsed', () => {
		expect(agingStateOf(null, [], 'discharged', null, at('2026-03-10T00:00:00Z'))).toBe('settled');
	});
});

describe('the lapse backstop (D7)', () => {
	const touch = '2026-01-01 00:00:00';
	const touchMs = Date.UTC(2026, 0, 1);

	it('fires at exactly LAPSE_AFTER_DAYS of owner silence', () => {
		expect(agingStateOf('2026-01-15', [], 'active', touch, new Date(touchMs + LAPSE_AFTER_DAYS * DAY_MS))).toBe('lapsed');
	});

	it('does not fire one millisecond earlier', () => {
		expect(agingStateOf('2026-01-15', [], 'active', touch, new Date(touchMs + LAPSE_AFTER_DAYS * DAY_MS - 1))).toBe('past_due_not_updated');
	});

	it('undated records lapse too', () => {
		expect(agingStateOf(null, [], 'active', touch, new Date(touchMs + LAPSE_AFTER_DAYS * DAY_MS))).toBe('lapsed');
	});

	it('an undated record with a fresh touch reads no_promised_date, not lapsed', () => {
		expect(agingStateOf(null, [], 'active', touch, at('2026-02-01T00:00:00Z'))).toBe('no_promised_date');
	});

	it('lapse beats the date states: a record inside grace still lapses on owner silence', () => {
		// Due 2026-06-25: 2026-06-30 would be grace day 5, but the touch is 180 days old.
		expect(agingStateOf('2026-06-25', [], 'active', touch, new Date(touchMs + LAPSE_AFTER_DAYS * DAY_MS))).toBe('lapsed');
	});

	it('a missing or unparseable touch never lapses (a plumbing bug must keep the encumbrance)', () => {
		expect(agingStateOf('2026-01-15', [], 'active', null, at('2027-06-01T00:00:00Z'))).toBe('past_due_not_updated');
		expect(agingStateOf(null, [], 'active', 'garbage', at('2027-06-01T00:00:00Z'))).toBe('no_promised_date');
	});

	it('a touch in the future (clock skew) never lapses', () => {
		expect(agingStateOf('2026-01-15', [], 'active', '2026-06-01 00:00:00', at('2026-02-01T00:00:00Z'))).toBe('past_due_not_updated');
	});

	it('an extension event also moves the lapse reference when passed as the touch', () => {
		// Same claim, touch refreshed by the extension: silence now runs from the event, and
		// 2026-07-08 sits inside the fresh grace window that opened on 2026-07-01.
		const extended = [{ newPromisedDate: '2026-07-01' }];
		expect(agingStateOf('2026-01-15', extended, 'active', '2026-06-20 00:00:00', at('2026-07-08T00:00:00Z'))).toBe('due_in_grace');
	});
});
