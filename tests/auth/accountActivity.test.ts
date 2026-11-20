import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The last day an account was active (auth_users.last_active_on, a UTC day).
 *
 * A session lasts 30 days, so a person can use the site for weeks without signing in again and
 * last_login never moves. The app middleware now notes each signed-in page or API request
 * (noteRequestActivity in src/lib/accountActivity.ts), and the rule keeps that cheap: at most
 * one write per account per day.
 *
 * Pinned here: a visit on a live session moves last active and leaves the last sign-in alone;
 * a second request the same day sends no statement at all; a new process the same day sends one
 * statement that writes nothing; a demo session, a signed-out visitor and a scheduled job write
 * nothing; a database error never reaches the request; and the middleware calls it without
 * waiting. Every id and address is invented.
 */
vi.mock('@/lib/db', async () => (await import('../helpers/authUsersFake')).dbModule());

import { authUsers } from '../helpers/authUsersFake';
import {
	countsAsActivity,
	noteRequestActivity,
	recordActiveDay,
	utcDay,
	__resetAccountActivityForTests,
} from '../../src/lib/accountActivity';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

const SIGNED_IN_AT = '2026-11-13T04:49:00.000Z';
const visit = (userId: string, at: string, pathname = '/dashboard/verify') =>
	noteRequestActivity({ userId, pathname, demoSession: false }, new Date(at));
const activeDayWrites = () => authUsers.statements.filter((s) => s.sql.startsWith('UPDATE auth_users SET last_active_on'));

beforeEach(() => {
	authUsers.reset();
	__resetAccountActivityForTests();
	authUsers.add({ id: 'u-1', email: 'regular@example.test', last_login: SIGNED_IN_AT, last_active_on: '2026-11-13' });
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('a visit on a live session', () => {
	it('moves last active and leaves the last sign-in alone', async () => {
		expect(await visit('u-1', '2026-11-19T23:10:00Z')).toBe(true);
		expect(authUsers.get('u-1')).toMatchObject({ last_active_on: '2026-11-19', last_login: SIGNED_IN_AT });
		expect(authUsers.writes().every((sql) => !/\blast_login\b/.test(sql))).toBe(true);
	});

	it('an API request counts too', async () => {
		expect(await visit('u-1', '2026-11-19T08:00:00Z', '/api/verify/destinations')).toBe(true);
		expect(authUsers.get('u-1').last_active_on).toBe('2026-11-19');
	});

	it('records an account that was never seen before', async () => {
		authUsers.add({ id: 'u-2', email: 'fresh@example.test', last_login: null, last_active_on: null });
		expect(await visit('u-2', '2026-11-19T08:00:00Z')).toBe(true);
		expect(authUsers.get('u-2').last_active_on).toBe('2026-11-19');
	});

	it('the day is the UTC day, whatever the server clock zone', () => {
		expect(utcDay(new Date('2026-11-19T23:59:59Z'))).toBe('2026-11-19');
		expect(utcDay(new Date('2026-11-20T00:00:00Z'))).toBe('2026-11-20');
	});
});

describe('at most one write per account per day', () => {
	it('a second request the same day sends no statement at all', async () => {
		await visit('u-1', '2026-11-19T08:00:00Z');
		const after = authUsers.statements.length;
		expect(await visit('u-1', '2026-11-19T08:00:05Z')).toBe(false);
		expect(await visit('u-1', '2026-11-19T22:00:00Z', '/api/wallets')).toBe(false);
		expect(authUsers.statements.length).toBe(after);
		expect(activeDayWrites()).toHaveLength(1);
	});

	it('requests that arrive together send one statement', async () => {
		const results = await Promise.all([1, 2, 3, 4, 5].map(() => visit('u-1', '2026-11-19T08:00:00Z')));
		expect(results.filter(Boolean)).toHaveLength(1);
		expect(activeDayWrites()).toHaveLength(1);
	});

	it('a new process the same day asks once and writes nothing: the stored day is already today', async () => {
		await visit('u-1', '2026-11-19T08:00:00Z');
		__resetAccountActivityForTests(); // a restart, or a second instance
		expect(await visit('u-1', '2026-11-19T09:00:00Z')).toBe(false);
		expect(activeDayWrites()).toHaveLength(2);
		expect(authUsers.get('u-1').last_active_on).toBe('2026-11-19');
		// The statement itself refuses a row whose day is not older.
		expect(activeDayWrites()[1].sql).toBe('UPDATE auth_users SET last_active_on = ? WHERE id = ? AND (last_active_on IS NULL OR last_active_on < ?)');
	});

	it('the next day writes again, and each account is counted on its own', async () => {
		authUsers.add({ id: 'u-2', email: 'second@example.test', last_active_on: null });
		await visit('u-1', '2026-11-19T08:00:00Z');
		expect(await visit('u-2', '2026-11-19T08:00:01Z')).toBe(true);
		expect(await visit('u-1', '2026-11-20T00:00:01Z')).toBe(true);
		expect(authUsers.get('u-1').last_active_on).toBe('2026-11-20');
		expect(authUsers.get('u-2').last_active_on).toBe('2026-11-19');
	});

	it('never moves a day backwards', async () => {
		authUsers.get('u-1').last_active_on = '2026-11-21';
		expect(await recordActiveDay('u-1', new Date('2026-11-20T10:00:00Z'))).toBe(false);
		expect(authUsers.get('u-1').last_active_on).toBe('2026-11-21');
	});
});

describe('what does not count', () => {
	it('a demo session writes nothing', async () => {
		expect(await noteRequestActivity({ userId: '', pathname: '/dashboard/vault', demoSession: true }, new Date('2026-11-19T08:00:00Z'))).toBe(false);
		// Even if a caller passed an id along with the demo flag.
		expect(await noteRequestActivity({ userId: 'u-1', pathname: '/dashboard/vault', demoSession: true }, new Date('2026-11-19T08:00:00Z'))).toBe(false);
		expect(authUsers.statements).toEqual([]);
		expect(authUsers.get('u-1').last_active_on).toBe('2026-11-13');
	});

	it('a signed-out visitor writes nothing', async () => {
		for (const userId of ['', null, undefined]) {
			expect(await noteRequestActivity({ userId, pathname: '/dashboard/vault', demoSession: false })).toBe(false);
		}
		expect(authUsers.statements).toEqual([]);
	});

	it('a scheduled job writes nothing', async () => {
		expect(await visit('u-1', '2026-11-19T08:00:00Z', '/api/cron/verify-monitor')).toBe(false);
		expect(authUsers.statements).toEqual([]);
	});

	it('the rule, as one decision', () => {
		expect(countsAsActivity({ userId: 'u-1', pathname: '/dashboard/verify', demoSession: false })).toBe(true);
		expect(countsAsActivity({ userId: 'u-1', pathname: '/api/verify/destinations', demoSession: false })).toBe(true);
		expect(countsAsActivity({ userId: 'u-1', pathname: '/api/cron/onboarding-drip', demoSession: false })).toBe(false);
		expect(countsAsActivity({ userId: 'u-1', pathname: '/dashboard/verify', demoSession: true })).toBe(false);
		expect(countsAsActivity({ userId: '', pathname: '/dashboard/verify', demoSession: false })).toBe(false);
	});
});

describe('it never fails or holds up a request', () => {
	it('a database error is swallowed and logged, and nothing is tried again for a minute', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		authUsers.failOn = /last_active_on = \?/;
		await expect(visit('u-1', '2026-11-19T08:00:00Z')).resolves.toBe(false);
		expect(warn).toHaveBeenCalledTimes(1);
		authUsers.failOn = null;
		const after = authUsers.statements.length;
		expect(await visit('u-1', '2026-11-19T08:00:30Z')).toBe(false);
		expect(authUsers.statements.length).toBe(after);
		// After the minute the day is recorded: a failure loses nothing for good.
		expect(await visit('u-1', '2026-11-19T08:01:01Z')).toBe(true);
		expect(authUsers.get('u-1').last_active_on).toBe('2026-11-19');
	});

	it('the log line carries no address', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		authUsers.failOn = /last_active_on = \?/;
		await visit('u-1', '2026-11-19T08:00:00Z');
		expect(JSON.stringify(warn.mock.calls)).not.toContain('@');
	});

	it('a database that could not check its columns still records the day when the column is there', async () => {
		authUsers.failOn = /information_schema/;
		expect(await visit('u-1', '2026-11-19T08:00:00Z')).toBe(true);
		expect(authUsers.get('u-1').last_active_on).toBe('2026-11-19');
	});

	it('the middleware starts it without waiting, for every signed-in request, outside the tenant context', () => {
		const app = read('src/middleware/app.ts');
		expect(app).toContain("import { noteRequestActivity } from '../lib/accountActivity';");
		expect(app).toContain('void noteRequestActivity({ userId, pathname, demoSession: !userId && isDemoRequest(request) });');
		expect(app).not.toContain('await noteRequestActivity(');
		// After the session is resolved, before the demo branch and the tenant context.
		const call = app.indexOf('void noteRequestActivity(');
		expect(call).toBeGreaterThan(app.indexOf('await getAuthSessionState(request)'));
		expect(call).toBeLessThan(app.indexOf('const proceedWith = async'));
		expect(call).toBeLessThan(app.indexOf('if (!userId && isDemoRequest(request)) {'));
	});

	it('a scheduled job never reaches the middleware that notes activity', async () => {
		const { isPublicPath } = await import('../../src/middleware/auth');
		expect(isPublicPath('/api/cron/verify-monitor')).toBe(true);
	});
});
