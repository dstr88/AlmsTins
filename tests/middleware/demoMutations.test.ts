import { describe, it, expect } from 'vitest';
import { DEMO_ALLOWED_MUTATIONS, isDemoMutationAllowed } from '../../src/middleware/demoMutations';

/**
 * The API writes a demo session may make (src/middleware/demoMutations.ts, used by
 * src/middleware/app.ts). Every demo visitor shares one tenant, so the list is by method AND
 * path: PATCH /api/wallets/{id} (rename, owner label) must not ride on the DELETE entry for the
 * same path, or one visitor's text would show to every other visitor.
 */

describe('isDemoMutationAllowed', () => {
	it.each([
		['POST', '/api/wallets'],
		['DELETE', '/api/wallets/w-1'],
		['POST', '/api/wallets/w-1/sync'],
		['POST', '/api/wallets/sync-all'],
		['POST', '/api/wallets/value/sync-all'],
		['POST', '/api/wallets/w-1/token-basis'],
		['POST', '/api/lifecycle/rebuild'],
		['POST', '/api/demo/cleanup'],
		['delete', '/api/wallets/w-1'],
	])('allows %s %s', (method, path) => {
		expect(isDemoMutationAllowed(method, path)).toBe(true);
	});

	it.each([
		// the shared wallet's rename and owner label
		['PATCH', '/api/wallets/w-1'],
		['patch', '/api/wallets/w-1'],
		['PUT', '/api/wallets/w-1'],
		['POST', '/api/wallets/w-1'],
		// other methods on the allowed paths
		['DELETE', '/api/wallets'],
		['PATCH', '/api/wallets/w-1/token-basis'],
		['DELETE', '/api/wallets/w-1/sync'],
		// paths that were never allowed
		['POST', '/api/exchanges/crypto-com/accounts'],
		['POST', '/api/exchanges/crypto-com/accounts/update'],
		['DELETE', '/api/exchange-accounts/a-1'],
		['POST', '/api/wallets/w-1/sync/extra'],
		['POST', '/api/wallets-other'],
	])('refuses %s %s', (method, path) => {
		expect(isDemoMutationAllowed(method, path)).toBe(false);
	});

	it('no entry allows PATCH or PUT', () => {
		expect(DEMO_ALLOWED_MUTATIONS.filter((e) => e.method === 'PATCH' || e.method === 'PUT')).toEqual([]);
	});
});
