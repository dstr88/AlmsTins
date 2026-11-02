import { describe, it, expect } from 'vitest';
import { agingStateOf, effectivePromisedDate, GRACE_DAYS, LAPSE_AFTER_DAYS } from '../../src/lib/receivables/aging';
import {
	buildNoticeEmail,
	DAY15_AFTER_PROMISE,
	DAY20_AFTER_PROMISE,
	DAY9_AFTER_PROMISE,
	daysPastPromised,
	dueNotices,
	lapseDayOf,
	LAPSE_WARN_LEAD_DAYS,
	NOTICE_RECIPIENTS,
	noticeBlock,
	type NoticeDeal,
} from '../../src/lib/receivables/notices';
import {
	NOTICE_SUBJECT_CLIENT,
	NOTICE_SUBJECT_LENDER,
} from '../../src/lib/receivables/copy/notices';

/**
 * The pure half of the aging notices (A4 / D8): notice selection by date math alone (`now`
 * is always a parameter — the suite's pinned clock is the backstop, never the pattern), and
 * the email bodies those notices produce. Invented data throughout.
 */

const DAY_MS = 86_400_000;
const at = (ymd: string, time = '12:00:00') => new Date(`${ymd}T${time}Z`);
const PROMISED = '2026-10-01';
/** `now` at N whole days after the promised date. */
const promisedPlus = (days: number) => new Date(at(PROMISED).getTime() + days * DAY_MS);

/** Facts derived through the REAL aging state, so a test can never feed the schedule a pair
 *  (state, dates) that production code would not produce. */
function factsOf(
	dueDate: string | null,
	extensions: ReadonlyArray<{ newPromisedDate: string | null }>,
	lastOwnerTouchAt: string | null,
	now: Date,
) {
	return {
		aging: agingStateOf(dueDate, extensions, 'active', lastOwnerTouchAt, now),
		promisedDate: effectivePromisedDate(dueDate, extensions),
		lastOwnerTouchAt,
	};
}

const TOUCH_BEFORE_PROMISE = '2026-09-02 10:00:00';

describe('the schedule constants are the plan\'s (Donnie\'s 9 / 15 / 20, warn 14 days out)', () => {
	it('pins the days and who each notice reaches', () => {
		expect([DAY9_AFTER_PROMISE, DAY15_AFTER_PROMISE, DAY20_AFTER_PROMISE]).toEqual([9, 15, 20]);
		expect(LAPSE_WARN_LEAD_DAYS).toBe(14);
		// Day 9 is lender-only BECAUSE the record still publicly reads "due, in grace" then —
		// an email never says more than the record shows. The lapse warning is the lender's
		// last two weeks to act; the lapse itself tells both sides.
		expect(NOTICE_RECIPIENTS).toEqual({
			day9: ['lender'],
			day15: ['lender', 'client'],
			day20: ['lender', 'client'],
			lapse_warn: ['lender'],
			lapsed: ['lender', 'client'],
		});
	});
});

describe('dueNotices: the promised-date clock', () => {
	const due = (days: number) => dueNotices(factsOf(PROMISED, [], TOUCH_BEFORE_PROMISE, promisedPlus(days)), promisedPlus(days));

	it('nothing before day 9; day 9 and the last grace day draw the lender nudge', () => {
		expect(due(8)).toEqual([]);
		expect(due(9)).toEqual(['day9']);
		expect(due(GRACE_DAYS)).toEqual(['day9']);
	});

	it('days 11–14 sit between notices: past due, but nothing due yet', () => {
		expect(due(11)).toEqual([]);
		expect(due(14)).toEqual([]);
	});

	it('day 15 and day 20 fire on their days; catch-up never backfills (latest only)', () => {
		expect(due(15)).toEqual(['day15']);
		expect(due(19)).toEqual(['day15']);
		expect(due(20)).toEqual(['day20']);
		// First seen at day 23 (the cron was down): one day-20 email, not three.
		expect(due(23)).toEqual(['day20']);
	});

	it('any owner update after the promised day stops the sequence (an unpaid flag is one)', () => {
		// The flag does not move the date — the record honestly stays past due — but the
		// financier has spoken since the promise, so the reminders stop.
		const flagged = '2026-10-05 09:00:00';
		const now = promisedPlus(16);
		const facts = factsOf(PROMISED, [], flagged, now);
		expect(facts.aging).toBe('past_due_not_updated');
		expect(dueNotices(facts, now)).toEqual([]);
	});

	it('an extension restarts the clock at the new promised date with fresh grace', () => {
		const ext = [{ newPromisedDate: '2026-11-20' }];
		const extendedAt = '2026-10-12 09:00:00';
		// Day 16 past the OLD promise: the new date governs, nothing is due.
		expect(dueNotices(factsOf(PROMISED, ext, extendedAt, promisedPlus(16)), promisedPlus(16))).toEqual([]);
		// Day 9 past the NEW promise: the grace nudge runs again.
		const now9 = new Date(at('2026-11-20').getTime() + 9 * DAY_MS);
		expect(dueNotices(factsOf(PROMISED, ext, extendedAt, now9), now9)).toEqual(['day9']);
	});

	it('a settled claim and an undated record draw nothing from this clock', () => {
		const now = promisedPlus(30);
		expect(dueNotices({ aging: 'settled', promisedDate: PROMISED, lastOwnerTouchAt: null }, now)).toEqual([]);
		expect(dueNotices(factsOf(null, [], TOUCH_BEFORE_PROMISE, now), now)).toEqual([]);
	});
});

describe('dueNotices: the lapse clock (owner silence)', () => {
	const silent = (days: number, dueDate: string | null = null) => {
		const touch = '2026-01-01 00:00:00';
		const now = new Date(at('2026-01-01', '00:00:00').getTime() + days * DAY_MS);
		return dueNotices(factsOf(dueDate, [], touch, now), now);
	};

	it('warns the lender from lapse−14 days of silence, undated records included', () => {
		expect(silent(LAPSE_AFTER_DAYS - LAPSE_WARN_LEAD_DAYS - 1)).toEqual([]);
		expect(silent(LAPSE_AFTER_DAYS - LAPSE_WARN_LEAD_DAYS)).toEqual(['lapse_warn']);
		expect(silent(LAPSE_AFTER_DAYS - 1)).toEqual(['lapse_warn']);
	});

	it('at lapse the state takes over: the lapsed notice alone, for both sides', () => {
		expect(silent(LAPSE_AFTER_DAYS)).toEqual(['lapsed']);
		expect(silent(LAPSE_AFTER_DAYS + 40)).toEqual(['lapsed']);
	});

	it('the two clocks are independent: deep past-due AND near-lapse both fire', () => {
		const touch = '2026-01-01 00:00:00';
		const now = new Date(at('2026-01-01', '00:00:00').getTime() + 170 * DAY_MS); // 2026-06-20
		const facts = factsOf('2026-02-01', [], touch, now);
		expect(facts.aging).toBe('past_due_not_updated');
		expect(dueNotices(facts, now)).toEqual(['day20', 'lapse_warn']);
	});

	it('a missing or unparseable touch never draws a lapse warning (aging.ts\'s fail direction)', () => {
		const now = promisedPlus(30);
		expect(dueNotices(factsOf(PROMISED, [], null, now), now)).toEqual(['day20']);
		expect(dueNotices(factsOf(PROMISED, [], 'not a date', now), now)).toEqual(['day20']);
	});

	it('lapseDayOf is touch + LAPSE_AFTER_DAYS, and null without a touch', () => {
		expect(lapseDayOf('2026-01-01 00:00:00')).toBe('2026-06-30');
		expect(lapseDayOf(null)).toBeNull();
		expect(lapseDayOf('garbage')).toBeNull();
	});

	it('daysPastPromised runs the same calendar-day math as the states', () => {
		expect(daysPastPromised(PROMISED, at(PROMISED, '23:59:00'))).toBe(0);
		expect(daysPastPromised(PROMISED, at('2026-10-02', '00:01:00'))).toBe(1);
		expect(daysPastPromised(null, at('2026-10-02'))).toBeNull();
	});
});

describe('noticeBlock: the deal-identifier block, with no party name anywhere', () => {
	const DEAL: NoticeDeal = {
		receivableId: 'a1'.repeat(32),
		invoiceNo: 'INV-0042',
		face: 18500,
		currency: 'USD',
		promisedDate: '2026-10-03',
		recordedDay: '2026-06-12',
		lastOwnerTouchAt: '2026-06-12 10:00:00',
	};
	const NOW = new Date(at('2026-10-03').getTime() + 15 * DAY_MS);
	const BASE = 'https://almstins.com';

	it('the client day-15 line is D8\'s example, identifier block and all', () => {
		const block = noticeBlock('day15', 'client', DEAL, BASE, NOW)!;
		expect(block.split('\n')[0]).toBe(
			'The claim recorded 2026-06-12 against your invoice INV-0042 (USD 18,500.00, payment promised 2026-10-03) has not been updated by its lender in 15 days.',
		);
		expect(block).toContain(`https://almstins.com/verify/registry?id=${DEAL.receivableId}`);
	});

	it('the lender lines carry the same block and the one-click desk link', () => {
		const block = noticeBlock('day9', 'lender', DEAL, BASE, NOW)!;
		expect(block).toContain('invoice INV-0042 (USD 18,500.00, payment promised 2026-10-03, claim recorded 2026-06-12)');
		expect(block).toContain('settled, extended, or unpaid');
		expect(block).toContain(`https://almstins.com/verify/desk?id=${DEAL.receivableId}`);
	});

	it('a pair the schedule never sends builds nothing: day 9 and the lapse warning have no client form', () => {
		expect(noticeBlock('day9', 'client', DEAL, BASE, NOW)).toBeNull();
		expect(noticeBlock('lapse_warn', 'client', DEAL, BASE, NOW)).toBeNull();
	});

	it('an undated record says so in the block instead of inventing a date', () => {
		const undated = { ...DEAL, promisedDate: null };
		const block = noticeBlock('lapsed', 'client', undated, BASE, NOW)!;
		expect(block).toContain('(USD 18,500.00, no promised payment date on record)');
		expect(block).toContain('lapsed — record not maintained');
	});

	it('the lapse warning names the dates: last touch and the day it lapses', () => {
		const quiet = { ...DEAL, lastOwnerTouchAt: '2026-05-01 10:00:00' };
		const block = noticeBlock('lapse_warn', 'lender', quiet, BASE, NOW)!;
		expect(block).toContain('since 2026-05-01');
		expect(block).toContain(`lapses on ${lapseDayOf(quiet.lastOwnerTouchAt)}`);
		expect(block).toContain('no longer counted');
	});
});

describe('buildNoticeEmail: generic subjects, the digest shape, the opt-out footer', () => {
	it('subjects carry zero identifiers, whatever is inside', () => {
		const { subject, text } = buildNoticeEmail('client', ['Block about INV-0042.'], { optoutUrl: 'https://almstins.com/o?token=t' });
		expect(subject).toBe(NOTICE_SUBJECT_CLIENT);
		expect(subject).not.toMatch(/INV|\d/);
		expect(text).toContain('Block about INV-0042.');
		expect(buildNoticeEmail('lender', ['x']).subject).toBe(NOTICE_SUBJECT_LENDER);
		expect(NOTICE_SUBJECT_LENDER).not.toMatch(/\d/);
	});

	it('several qualifying claims become one email with one block each', () => {
		const { text } = buildNoticeEmail('lender', ['First deal block.', 'Second deal block.']);
		expect(text).toContain('First deal block.\n\nSecond deal block.');
	});

	it('client emails end on the opt-out link; lender emails never carry one', () => {
		const client = buildNoticeEmail('client', ['b'], { optoutUrl: 'https://almstins.com/api/verify/receivables/notice-optout?token=t1' });
		expect(client.text).toContain('No more of these notices: https://almstins.com/api/verify/receivables/notice-optout?token=t1');
		const lender = buildNoticeEmail('lender', ['b'], { optoutUrl: 'https://x.test/never' });
		expect(lender.text).not.toContain('No more of these notices');
		expect(lender.text).not.toContain('x.test/never');
		// Both end on the boundary line the other receivables mail already carries.
		for (const t of [client.text, lender.text]) expect(t).toContain('records and proves');
	});
});
