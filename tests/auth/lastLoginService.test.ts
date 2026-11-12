import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getSignInContext, runWithSignInContext, serviceLabelForId } from '../../src/lib/signupService';

/**
 * Each sign-in stamps the product it was headed for and the country the request came from, so the
 * owner's list of last logins can say "Verify · Singapore". Pinned here: the label for each stored
 * product id (Unknown for anything else), the country carried into the sign-in context, the stamp's
 * own write in the auth route, the list reading the two columns, and the migrations that add them.
 */

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

describe('serviceLabelForId', () => {
	it.each([
		['wallet-watcher', 'Wallet Watcher (almstins.com)'],
		['verify', 'Verify'],
		['receivables', 'Receivables'],
		['agent-vault', 'Agent Vault'],
	])('%s reads as its product', (id, label) => {
		expect(serviceLabelForId(id)).toBe(label);
	});

	it('a missing or unknown id reads Unknown', () => {
		for (const v of [null, undefined, '', 'nonsense', 'constructor', 'toString']) {
			expect(serviceLabelForId(v as any)).toBe('Unknown');
		}
	});
});

describe('the sign-in context carries the country', () => {
	it('is the country the request came from, and null when none was given', () => {
		runWithSignInContext('/verify', () => {
			expect(getSignInContext()?.country).toBe('SG');
		}, 'SG');
		runWithSignInContext('/verify', () => {
			expect(getSignInContext()?.country).toBeNull();
		});
	});
});

describe('the sign-in stamp', () => {
	const route = read('src/pages/api/auth/[...auth].ts');

	it('writes the product and country in its own statement', () => {
		expect(route).toContain('UPDATE auth_users SET last_login_service = ?, last_login_country = ? WHERE id = ?');
		expect(route).toContain('getSignInContext()');
	});

	it('is separate from the last_login write, so a missing column does not stop last_login', () => {
		const service = route.indexOf('last_login_service = ?');
		const lastLoginOnly = route.indexOf('UPDATE auth_users SET last_login = ? WHERE id = ?');
		expect(service).toBeGreaterThan(-1);
		expect(lastLoginOnly).toBeGreaterThan(-1);
		expect(route.slice(service, lastLoginOnly)).toContain('} catch (error) {');
	});

	it('both sign-in handlers pass the request country into the context', () => {
		expect(route.match(/getClientCountry\(request\)/g)?.length).toBe(2);
	});
});

describe('the owner list', () => {
	const admin = read('src/pages/admin/index.astro');

	it('reads both columns and shows the product and country under the time', () => {
		expect(admin).toContain('u.last_login_service, u.last_login_country');
		expect(admin).toContain('serviceLabelForId(u.last_login_service)');
		expect(admin).toContain('countryName(u.last_login_country)');
	});
});

describe('the migrations', () => {
	it('add both columns in the Postgres and libSQL databases', () => {
		const pg = read('migrations-pg/0074_auth_last_login_service.sql');
		const libsql = read('migrations/20261111_auth_last_login_service.sql');
		for (const sql of [pg, libsql]) {
			expect(sql).toContain('ALTER TABLE auth_users ADD COLUMN');
			expect(sql).toContain('last_login_service TEXT');
			expect(sql).toContain('last_login_country TEXT');
		}
	});
});
