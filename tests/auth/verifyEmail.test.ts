import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /api/verify-email. Pinned here:
 *   - GET (what a mail scanner fetches) never touches the database; it forwards to the
 *     confirmation page with token, email and lang;
 *   - POST with a live token verifies and lands on the sign-in page in the right language;
 *   - pressing Confirm twice (or an older link from the same day) still says verified;
 *   - a wrong token, an expired token or a deleted account do not.
 */
const mem = vi.hoisted(() => ({
	users: [] as { id: string; email: string; email_verified: string | null }[],
	tokens: [] as { identifier: string; token: string; expires: string }[],
	queries: 0,
}));

vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		mem.queries += 1;
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		if (sql === 'SELECT token, expires FROM signup_verification_tokens WHERE identifier = ? AND token = ? LIMIT 1') {
			return { rows: mem.tokens.filter((t) => t.identifier === args[0] && t.token === args[1]), rowsAffected: 0 };
		}
		if (sql === 'DELETE FROM signup_verification_tokens WHERE identifier = ? AND token = ?') {
			mem.tokens = mem.tokens.filter((t) => !(t.identifier === args[0] && t.token === args[1]));
			return { rows: [], rowsAffected: 1 };
		}
		if (sql.startsWith('UPDATE auth_users SET email_verified = to_char(')) {
			const hits = mem.users.filter((u) => u.email === args[0] && !u.email_verified);
			for (const u of hits) u.email_verified = '2026-09-24 00:00:00';
			return { rows: hits.map((u) => ({ id: u.id })), rowsAffected: hits.length };
		}
		if (sql === 'SELECT 1 AS ok FROM auth_users WHERE email = ? LIMIT 1') {
			return { rows: mem.users.filter((u) => u.email === args[0]).map(() => ({ ok: 1 })), rowsAffected: 0 };
		}
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	return { db: { execute, batch: async () => { throw new Error('batch not expected'); } } };
});

import { GET, POST } from '../../src/pages/api/verify-email';

const redirect = (url: string, status = 302) => new Response(null, { status, headers: { Location: url } });
const get = async (qs: string) => {
	const res: Response = await (GET as any)({ request: new Request(`https://almstins.com/api/verify-email?${qs}`), redirect });
	return res.headers.get('Location');
};
const confirm = async (fields: Record<string, string>) => {
	const request = new Request('https://almstins.com/api/verify-email', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields),
	});
	const res: Response = await (POST as any)({ request, redirect });
	return res.headers.get('Location');
};
const future = () => new Date(Date.now() + 3600_000).toISOString();

beforeEach(() => {
	mem.users = [{ id: 'u-1', email: 'new@company.dev', email_verified: null }];
	mem.tokens = [{ identifier: 'signup:new@company.dev', token: 'tok-1', expires: future() }];
	mem.queries = 0;
});

describe('GET /api/verify-email', () => {
	it('forwards to the confirmation page and verifies nothing', async () => {
		expect(await get('token=tok-1&email=new%40company.dev&lang=fr')).toBe('/verify-email?token=tok-1&email=new%40company.dev&lang=fr');
		expect(await get('token=tok-1&email=new%40company.dev')).toBe('/verify-email?token=tok-1&email=new%40company.dev');
		expect(mem.queries).toBe(0);
		expect(mem.users[0].email_verified).toBeNull();
	});
});

describe('POST /api/verify-email', () => {
	it('verifies with a live token and lands on the sign-in page in that language', async () => {
		expect(await confirm({ token: 'tok-1', email: 'New@Company.dev', lang: 'es' })).toBe('/es?verified=success');
		expect(mem.users[0].email_verified).not.toBeNull();
	});

	it('pressing Confirm twice still says verified', async () => {
		expect(await confirm({ token: 'tok-1', email: 'new@company.dev', lang: 'en' })).toBe('/login?verified=success');
		expect(await confirm({ token: 'tok-1', email: 'new@company.dev', lang: 'en' })).toBe('/login?verified=success');
	});

	it('refuses a wrong token, a missing field, and a token for a deleted account', async () => {
		expect(await confirm({ token: 'nope', email: 'new@company.dev', lang: 'fr' })).toBe('/fr?verified=failed');
		expect(await confirm({ token: '', email: 'new@company.dev' })).toBe('/login?verified=failed');
		expect(mem.users[0].email_verified).toBeNull();
		mem.users = [];
		expect(await confirm({ token: 'tok-1', email: 'new@company.dev' })).toBe('/login?verified=failed');
	});

	it('an expired token says expired and is spent', async () => {
		mem.tokens[0].expires = new Date(Date.now() - 1000).toISOString();
		expect(await confirm({ token: 'tok-1', email: 'new@company.dev' })).toBe('/login?verified=expired');
		expect(mem.tokens).toHaveLength(0);
		expect(mem.users[0].email_verified).toBeNull();
	});
});
