import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * POST /api/signup: the strict address check and the per-IP limit (5 per hour, keyed on the
 * Cloudflare-set client IP, counting every POST valid or not). A sign-up creates the user,
 * the password and a verification token, but no tenant: that waits for the first
 * successful (verified) sign-in.
 */
const mem = vi.hoisted(() => ({ inserts: [] as string[] }));
const issued = vi.hoisted(() => vi.fn(async (_a: any) => {}));

vi.mock('@/lib/signupVerification', () => ({ issueSignupVerification: issued }));
vi.mock('@/lib/i18n/userLang', () => ({ setUserLang: async () => {} }));
vi.mock('@/lib/authAdapter', () => ({ ensureAuthUsersCreatedAt: async () => {} }));
vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		if (sql === 'SELECT id FROM auth_users WHERE email = ? LIMIT 1') return { rows: [], rowsAffected: 0 };
		if (sql.startsWith('INSERT INTO auth_users') || sql.startsWith('INSERT INTO auth_credentials')) {
			mem.inserts.push(sql.split(' ')[2]);
			return { rows: [], rowsAffected: 1 };
		}
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	return { db: { execute, batch: async () => { throw new Error('batch not expected'); } } };
});

import { POST } from '../../src/pages/api/signup';

const signup = async (email: string, ip: string, lang = 'en') => {
	const body = new URLSearchParams({ email, password: 'long enough password', lang });
	const request = new Request('https://almstins.com/api/signup', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': ip },
		body,
	});
	const redirect = (url: string, status = 302) => new Response(null, { status, headers: { Location: url } });
	const res: Response = await (POST as any)({ request, redirect, clientAddress: '10.0.0.1' });
	return res.headers.get('Location');
};

beforeEach(() => {
	mem.inserts = [];
	issued.mockClear();
});

describe('POST /api/signup', () => {
	it('refuses a scanner payload address', async () => {
		expect(await signup(`testing@example.com'"`, '198.51.100.1')).toBe('/signup?error=email');
		expect(await signup('testing@example.com', '198.51.100.1')).toBe('/signup?error=email');
		expect(mem.inserts).toHaveLength(0);
		expect(issued).not.toHaveBeenCalled();
	});

	it('creates the user and password and sends the verification link, but no tenant', async () => {
		expect(await signup('New.Person@Company.dev', '198.51.100.2', 'fr')).toBe('/fr?signup=success');
		expect(mem.inserts).toEqual(['auth_users', 'auth_credentials']);
		expect(issued).toHaveBeenCalledWith({ email: 'new.person@company.dev', lang: 'fr' });
	});

	it('limits each client IP to 5 attempts per hour, valid or not', async () => {
		const ip = '203.0.113.50';
		for (let i = 0; i < 5; i++) {
			expect(await signup(`junk${i}@example.com`, ip)).toBe('/signup?error=email');
		}
		expect(await signup('real@company.dev', ip, 'es')).toBe('/signup/es?error=rate_limited');
		expect(mem.inserts).toHaveLength(0);
		// A different client is unaffected.
		expect(await signup('real@company.dev', '203.0.113.51')).toBe('/login?signup=success');
	});

	it('an IPv6 client rotating addresses inside its /64 shares one budget', async () => {
		for (let i = 0; i < 5; i++) {
			expect(await signup(`junk${i}@example.com`, `2001:db8:77:1::${i + 1}`)).toBe('/signup?error=email');
		}
		expect(await signup('real@company.dev', '2001:db8:77:1:ffff:ffff:ffff:fffe')).toBe('/signup?error=rate_limited');
		expect(await signup('real@company.dev', '2001:db8:77:2::1')).toBe('/login?signup=success');
	});
});
