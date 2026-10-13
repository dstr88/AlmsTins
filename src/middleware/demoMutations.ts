/**
 * demoMutations.ts: the API writes a demo visitor may make.
 *
 * Every demo visitor is on one shared tenant (DEMO_TENANT_ID in src/lib/demo.ts), so anything a
 * visitor writes is seen by every other visitor until the next reseed. Visitors may add, sync
 * and delete wallets to explore with their own addresses, and save a manual cost basis; nothing
 * else. Each entry names its method as well as its path, because a path pattern alone also lets
 * through every other method the route answers (PATCH /api/wallets/{id} renames a wallet and
 * sets its owner label, which other visitors would then see).
 *
 * src/middleware/app.ts calls isDemoMutationAllowed for every POST, PUT, PATCH and DELETE to
 * /api/ from a demo session; anything not listed here gets the "Sign up free" 403.
 */

type DemoMutation = { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: RegExp };

export const DEMO_ALLOWED_MUTATIONS: readonly DemoMutation[] = [
	{ method: 'POST', path: /^\/api\/wallets$/ }, // add an on-chain or custom wallet
	{ method: 'DELETE', path: /^\/api\/wallets\/[^/]+$/ }, // remove a wallet by id
	{ method: 'POST', path: /^\/api\/wallets\/[^/]+\/sync$/ }, // sync a single wallet
	{ method: 'POST', path: /^\/api\/wallets\/sync-all$/ }, // sync every wallet
	{ method: 'POST', path: /^\/api\/wallets\/value\/sync-all$/ }, // sync all wallet values
	{ method: 'POST', path: /^\/api\/wallets\/[^/]+\/token-basis$/ }, // save manual cost basis / purchase date
	{ method: 'POST', path: /^\/api\/lifecycle\/rebuild$/ }, // rebuild FIFO after sync
	{ method: 'POST', path: /^\/api\/demo\/cleanup$/ }, // wipe demo data on page leave
];

/** True when a demo session may send this write. */
export function isDemoMutationAllowed(method: string, pathname: string): boolean {
	const m = method.toUpperCase();
	return DEMO_ALLOWED_MUTATIONS.some((entry) => entry.method === m && entry.path.test(pathname));
}
