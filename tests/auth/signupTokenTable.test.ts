import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * signup_verification_tokens (and possibly auth_verification_tokens) only ever existed in
 * the pre-Postgres migrations, so the production database never had it: every sign-up
 * token write failed and no verification email went out. Pins that each path creates its
 * table before it reads or writes it, leaves an existing table alone, and survives two
 * first requests racing to create it.
 */
const mem = vi.hoisted(() => ({
	calls: [] as string[],
	present: new Set<string>(),
	raceOnCreate: null as null | string,
}));

vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		mem.calls.push(sql);
		if (sql === 'SELECT to_regclass(?) AS r') {
			return { rows: [{ r: mem.present.has(String(args[0])) ? String(args[0]) : null }], rowsAffected: 0 };
		}
		if (sql.startsWith('CREATE TABLE IF NOT EXISTS') && mem.raceOnCreate) {
			throw Object.assign(new Error('duplicate key value violates unique constraint "pg_type_typname_nsp_index"'), { code: mem.raceOnCreate });
		}
		return { rows: [], rowsAffected: 0 };
	};
	return { db: { execute, batch: async () => ({}) } };
});
vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock('../../src/lib/email', () => ({ sendMail: vi.fn(async () => undefined) }));

const CREATE = 'CREATE TABLE IF NOT EXISTS signup_verification_tokens';
const INDEX = 'CREATE UNIQUE INDEX IF NOT EXISTS signup_verification_tokens_idx';
const firstIndex = (prefix: string) => mem.calls.findIndex((s) => s.startsWith(prefix));

beforeEach(() => {
	mem.calls = [];
	mem.present = new Set();
	mem.raceOnCreate = null;
	vi.resetModules(); // fresh "already ensured" memo for each case
});

describe('sign-in token tables are created before use', () => {
	it('issuing a sign-up token creates the table and its index first', async () => {
		const { issueSignupVerification } = await import('../../src/lib/signupVerification');
		await issueSignupVerification({ email: 'person@almstins-test.dev', lang: 'en' });
		const create = firstIndex(CREATE);
		expect(create).toBeGreaterThanOrEqual(0);
		expect(firstIndex(INDEX)).toBeGreaterThan(create);
		expect(firstIndex('INSERT INTO signup_verification_tokens')).toBeGreaterThan(firstIndex(INDEX));
	});

	it('the verify-email confirm step creates the table before looking the token up', async () => {
		const { POST } = await import('../../src/pages/api/verify-email');
		const form = new FormData();
		form.set('token', 'a'.repeat(64));
		form.set('email', 'person@almstins-test.dev');
		const request = new Request('https://almstins.com/api/verify-email', { method: 'POST', body: form });
		const redirect = (to: string, status = 302) => new Response(null, { status, headers: { Location: to } });
		const res = await (POST as any)({ request, redirect, url: new URL(request.url) });
		expect(res.status).toBe(303); // unknown token: refused, but no missing-table error
		const create = firstIndex(CREATE);
		expect(create).toBeGreaterThanOrEqual(0);
		expect(firstIndex('SELECT token, expires FROM signup_verification_tokens')).toBeGreaterThan(create);
	});

	it('a magic-link token write creates auth_verification_tokens first', async () => {
		const { authAdapter } = await import('../../src/lib/authAdapter');
		await authAdapter().createVerificationToken!({ identifier: 'person@almstins-test.dev', token: 't', expires: new Date(Date.now() + 60_000) });
		const create = firstIndex('CREATE TABLE IF NOT EXISTS auth_verification_tokens');
		expect(create).toBeGreaterThanOrEqual(0);
		expect(firstIndex('INSERT INTO auth_verification_tokens')).toBeGreaterThan(create);
	});

	it('leaves an existing table alone: no DDL at all, not even the index', async () => {
		mem.present.add('signup_verification_tokens');
		const { ensureSignupTokenTable } = await import('../../src/lib/signupVerification');
		await ensureSignupTokenTable();
		expect(mem.calls.filter((s) => s.startsWith('CREATE'))).toEqual([]);
	});

	it('creates it once per process, not on every call', async () => {
		const { ensureSignupTokenTable } = await import('../../src/lib/signupVerification');
		await ensureSignupTokenTable();
		await ensureSignupTokenTable();
		expect(mem.calls.filter((s) => s.startsWith(CREATE))).toHaveLength(1);
	});

	it('losing a first-use race to another request (23505 / 42P07) is not an error', async () => {
		for (const code of ['23505', '42P07']) {
			mem.calls = [];
			mem.raceOnCreate = code;
			vi.resetModules();
			const { ensureSignupTokenTable } = await import('../../src/lib/signupVerification');
			await expect(ensureSignupTokenTable()).resolves.toBeUndefined();
		}
	});

	it('any other failure is thrown and not remembered, so the next call retries', async () => {
		mem.raceOnCreate = '42501'; // permission denied
		const { ensureSignupTokenTable } = await import('../../src/lib/signupVerification');
		await expect(ensureSignupTokenTable()).rejects.toMatchObject({ code: '42501' });
		mem.raceOnCreate = null;
		await expect(ensureSignupTokenTable()).resolves.toBeUndefined();
		expect(mem.calls.filter((s) => s.startsWith(CREATE))).toHaveLength(2);
	});
});
