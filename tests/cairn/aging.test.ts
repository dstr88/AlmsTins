import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	CLOSE_KINDS, daysPastTarget, isCloseKind, MILESTONE_GRACE_DAYS, MILESTONE_STATE_LABEL, milestoneAgingLine, milestoneAgingOf,
} from '../../src/lib/cairn/aging';

/**
 * src/lib/cairn/aging.ts as pure functions (receivables tier T5, D13): a milestone's derived state,
 * with `now` always a parameter. The work paper has no clock that runs out, and this file pins that
 * absence as much as the states themselves.
 */

const at = (iso: string) => new Date(iso);
const open = { status: 'pending', paidAt: null };

describe('milestoneAgingOf', () => {
	it('a target ahead, or today, reads scheduled', () => {
		expect(milestoneAgingOf({ ...open, targetDate: '2027-02-01' }, at('2026-11-08T12:00:00Z'))).toBe('scheduled');
		expect(milestoneAgingOf({ ...open, targetDate: '2026-11-08' }, at('2026-11-08T23:59:00Z'))).toBe('scheduled');
	});

	it('the target passed: grace for MILESTONE_GRACE_DAYS, then past target with no update, for as long as it is true', () => {
		expect(MILESTONE_GRACE_DAYS).toBe(10);
		expect(milestoneAgingOf({ ...open, targetDate: '2026-11-01' }, at('2026-11-02T00:00:00Z'))).toBe('due_in_grace');
		expect(milestoneAgingOf({ ...open, targetDate: '2026-11-01' }, at('2026-11-11T23:59:00Z'))).toBe('due_in_grace');
		expect(milestoneAgingOf({ ...open, targetDate: '2026-11-01' }, at('2026-11-12T00:00:00Z'))).toBe('past_target_no_update');
		expect(milestoneAgingOf({ ...open, targetDate: '2026-11-01' }, at('2029-11-01T00:00:00Z'))).toBe('past_target_no_update');
	});

	it('no target date is its own honest state', () => {
		expect(milestoneAgingOf({ ...open, targetDate: null }, at('2026-11-08T12:00:00Z'))).toBe('no_target_date');
		expect(milestoneAgingOf({ ...open, targetDate: 'garbage' }, at('2026-11-08T12:00:00Z'))).toBe('no_target_date');
	});

	it('a signature changes the state, nothing else does: attested, disputed, then paid on top of anything', () => {
		expect(milestoneAgingOf({ targetDate: '2026-01-01', status: 'attested', paidAt: null }, at('2026-11-08T12:00:00Z'))).toBe('attested');
		expect(milestoneAgingOf({ targetDate: '2026-01-01', status: 'disputed', paidAt: null }, at('2026-11-08T12:00:00Z'))).toBe('disputed');
		expect(milestoneAgingOf({ targetDate: '2026-01-01', status: 'attested', paidAt: '2026-06-01 10:00:00' }, at('2026-11-08T12:00:00Z'))).toBe('paid');
		expect(milestoneAgingOf({ targetDate: null, status: 'pending', paidAt: '2026-06-01 10:00:00' }, at('2026-11-08T12:00:00Z'))).toBe('paid');
	});

	it('daysPastTarget runs on UTC calendar days', () => {
		expect(daysPastTarget('2026-11-01', at('2026-11-01T23:59:00Z'))).toBe(0);
		expect(daysPastTarget('2026-11-01', at('2026-11-02T00:01:00Z'))).toBe(1);
		expect(daysPastTarget(null, at('2026-11-02T00:01:00Z'))).toBeNull();
	});
});

describe('the words', () => {
	it('the line under a passed target names the last signature, or the target itself, and is null for every other state', () => {
		expect(milestoneAgingLine('past_target_no_update', { targetDate: '2026-11-01', lastSignedAt: null })).toBe('Target date passed; no update recorded since 2026-11-01.');
		expect(milestoneAgingLine('past_target_no_update', { targetDate: '2026-11-01', lastSignedAt: '2026-11-20 10:00:00' })).toBe('Target date passed; no update recorded since 2026-11-20.');
		expect(milestoneAgingLine('due_in_grace', { targetDate: '2026-11-01', lastSignedAt: null })).toContain('no update recorded since');
		for (const s of ['scheduled', 'no_target_date', 'attested', 'disputed', 'paid'] as const) {
			expect(milestoneAgingLine(s, { targetDate: '2026-11-01', lastSignedAt: null })).toBeNull();
		}
	});

	it('nothing on the work paper is ever late, missed, failed, lapsed or expired', () => {
		const ROOT = fileURLToPath(new URL('../../', import.meta.url));
		const src = fs.readFileSync(path.join(ROOT, 'src/lib/cairn/aging.ts'), 'utf8');
		// The header may name what the file refuses to do; the code and the labels may not say it.
		const code = src.replace(/\/\*\*[\s\S]*?\*\//, '');
		expect(code).not.toMatch(/\b(lapse\w*|expir\w*|late|missed|failed|overdue|delinquen\w*)\b/i);
		for (const label of Object.values(MILESTONE_STATE_LABEL)) expect(label).not.toMatch(/\b(late|missed|failed|lapse\w*|expir\w*)\b/i);
	});

	it('the three closes, and nothing else', () => {
		expect(CLOSE_KINDS).toEqual(['completed', 'terminated', 'abandoned']);
		expect(isCloseKind('completed')).toBe(true);
		expect(isCloseKind('expired')).toBe(false);
		expect(isCloseKind(null)).toBe(false);
	});
});
