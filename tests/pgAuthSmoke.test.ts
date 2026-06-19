// @ts-nocheck — diagnostic harness; loose Auth.js adapter typing is intentional.
import 'dotenv/config';
import { test } from 'vitest';

// Reproduce the real sign-in chain (Auth.js custom adapter) against Postgres to
// pinpoint what breaks the OAuth callback ("Sign-in temporarily unavailable").
// Creates + deletes a throwaway user/account/session. Needs live PG.
process.env.DB_ENGINE = 'pg';

test.skipIf(!process.env.DATABASE_URL)('auth adapter sign-in chain on PG', async () => {
	const { authAdapter } = await import('@/lib/authAdapter');
	const { db } = await import('@/lib/db');
	const a = authAdapter();
	const email = '__pgauthtest__@example.test';
	const sess = '__pgauth_sess__' + Math.floor(Date.now() / 1000);
	const results: Array<[string, string]> = [];
	let user: { id: string } | null = null;

	const step = async (name: string, fn: () => Promise<unknown>) => {
		try { const r = await fn(); results.push([name, 'OK ' + (r && typeof r === 'object' ? JSON.stringify(r).slice(0, 60) : String(r))]); return r; }
		catch (e) { results.push([name, 'FAIL -> ' + (e as Error).message.split('\n')[0]]); throw e; }
	};

	try {
		// pre-clean any leftover
		await db.execute({ sql: 'DELETE FROM auth_users WHERE email = ?', args: [email] });
		user = await step('createUser', () => a.createUser({ id: undefined as never, email, emailVerified: null, name: null, image: null })) as { id: string };
		await step('linkAccount', () => a.linkAccount({ userId: user!.id, provider: '__pgtest__', providerAccountId: 'pa1', type: 'oauth', access_token: 'x', token_type: 'bearer', scope: 's', expires_at: 1893456000, refresh_token: 'r', id_token: 'i', session_state: 'z' }));
		await step('getUserByAccount', () => a.getUserByAccount({ provider: '__pgtest__', providerAccountId: 'pa1' }));
		await step('createSession', () => a.createSession({ sessionToken: sess, userId: user!.id, expires: new Date(Date.now() + 3600e3) }));
		await step('getSessionAndUser', () => a.getSessionAndUser(sess));
	} catch { /* captured in results */ }

	// cleanup (best-effort)
	try {
		if (user) {
			await db.execute({ sql: 'DELETE FROM auth_sessions WHERE user_id = ?', args: [user.id] });
			await db.execute({ sql: 'DELETE FROM auth_accounts WHERE user_id = ?', args: [user.id] });
			await db.execute({ sql: 'DELETE FROM auth_users WHERE id = ?', args: [user.id] });
		}
	} catch { /* ignore */ }

	console.log('\n=== AUTH ADAPTER CHAIN ON PG ===');
	for (const [n, s] of results) console.log(`  ${n}: ${s}`);
}, 60_000);

test.skipIf(!process.env.DATABASE_URL)('tenant resolution on PG (real owner user)', async () => {
	const t = await import('@/lib/tenants');
	const userId = 'cfaeb2a2-7040-4ce2-abd0-b1a22273f50f'; // real owner of tenant fc236bc3
	const run = async (name: string, fn: () => Promise<unknown>) => {
		try { const r = await fn(); console.log(`  ${name}: OK ${JSON.stringify(r).slice(0, 100)}`); }
		catch (e) { console.log(`  ${name}: FAIL -> ${(e as Error).message.split('\n')[0]}`); }
	};
	console.log('\n=== TENANT RESOLUTION ON PG (the post-sign-in path) ===');
	await run('resolveActiveTenantId', () => t.resolveActiveTenantId(userId));
	await run('getTenantStateDetails', () => t.getTenantStateDetails(userId));
	await run('requireActiveTenantId', () => t.requireActiveTenantId(userId));
	await run('ensureTenantForUser', () => t.ensureTenantForUser(userId));
}, 60_000);
