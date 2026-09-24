import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { CredentialsSignin } from '@auth/core/errors';

/**
 * Password sign-in (the Credentials provider's authorize). Pinned here:
 *   - a verified password user signs in;
 *   - the right password on an unverified address is refused with code 'email_unverified'
 *     (so the login page can say why) and the verification email is re-sent, rate-limited;
 *   - an unverified password on an account that also has a Google/GitHub link is refused
 *     with code 'use_provider' (sign in with the provider), and nothing is re-sent;
 *   - the re-sent link opens the /verify-email confirmation page in the user's language;
 *   - a wrong password reveals nothing (null, no email), junk input never reaches the DB.
 */
const mem = vi.hoisted(() => ({
	users: [] as Record<string, any>[],
	tokens: [] as { identifier: string; token: string; expires: string }[],
	queries: 0,
}));
const sendMail = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/lib/email', () => ({ sendMail }));
vi.mock('@/lib/db', () => {
	const execute = async (stmt: any) => {
		mem.queries += 1;
		const sql = String(typeof stmt === 'string' ? stmt : stmt.sql).replace(/\s+/g, ' ').trim();
		const args = (typeof stmt === 'string' ? [] : stmt.args) ?? [];
		if (sql.startsWith('SELECT u.id, u.name, u.email, u.email_verified, c.password_hash')) {
			const u = mem.users.find((x) => x.email === args[0] && x.password_hash);
			return { rows: u ? [u] : [], rowsAffected: 0 };
		}
		if (sql === 'SELECT expires FROM signup_verification_tokens WHERE identifier = ?') {
			return { rows: mem.tokens.filter((t) => t.identifier === args[0]), rowsAffected: 0 };
		}
		if (sql === 'INSERT INTO signup_verification_tokens (identifier, token, expires) VALUES (?, ?, ?)') {
			mem.tokens.push({ identifier: args[0], token: args[1], expires: args[2] });
			return { rows: [], rowsAffected: 1 };
		}
		if (sql.startsWith('ALTER TABLE auth_users ADD COLUMN lang')) return { rows: [], rowsAffected: 0 };
		if (sql === 'SELECT lang FROM auth_users WHERE id = ? LIMIT 1') {
			const u = mem.users.find((x) => x.id === args[0]);
			return { rows: u ? [{ lang: u.lang ?? 'en' }] : [], rowsAffected: 0 };
		}
		throw new Error(`unexpected SQL in test: ${sql}`);
	};
	return { db: { execute, batch: async () => { throw new Error('batch not expected'); } } };
});

import { authorizeCredentials, EmailNotVerifiedError, UseProviderError } from '../../src/lib/credentialsAuth';
import { __resetSignupVerificationLimitsForTests } from '../../src/lib/signupVerification';
import { hashPassword } from '../../src/lib/passwords';

let HASH = '';
beforeAll(async () => {
	HASH = await hashPassword('correct horse battery');
});

const req = (ip = '203.0.113.7') => new Request('https://almstins.com/api/auth/callback/credentials', { headers: { 'cf-connecting-ip': ip } });

beforeEach(() => {
	mem.users = [
		{ id: 'u-verified', name: null, email: 'ok@company.dev', email_verified: '2026-09-01 10:00:00', password_hash: HASH, has_account: false },
		{ id: 'u-unverified', name: null, email: 'new@company.dev', email_verified: null, password_hash: HASH, has_account: false, lang: 'es' },
		{ id: 'u-mixed', name: null, email: 'mixed@company.dev', email_verified: null, password_hash: HASH, has_account: true },
	];
	mem.tokens = [];
	mem.queries = 0;
	sendMail.mockClear();
	__resetSignupVerificationLimitsForTests();
});

describe('authorizeCredentials', () => {
	it('signs in a verified password user', async () => {
		const user = await authorizeCredentials({ email: '  OK@Company.dev ', password: 'correct horse battery' }, req());
		expect(user).toEqual({ id: 'u-verified', name: null, email: 'ok@company.dev' });
		expect(sendMail).not.toHaveBeenCalled();
	});

	it('refuses an unverified address with code email_unverified and re-sends the link once', async () => {
		const err = await authorizeCredentials({ email: 'new@company.dev', password: 'correct horse battery' }, req()).catch((e) => e);
		expect(err).toBeInstanceOf(EmailNotVerifiedError);
		expect(err).toBeInstanceOf(CredentialsSignin);
		expect(err.code).toBe('email_unverified');
		// Auth.js builds the redirect from these: /login?error=CredentialsSignin&code=email_unverified
		expect(err.type).toBe('CredentialsSignin');
		expect(err.kind).toBe('signIn');

		expect(sendMail).toHaveBeenCalledTimes(1);
		const mail = (sendMail.mock.calls[0] as any[])[0];
		expect(mail.to).toBe('new@company.dev');
		expect(mail.subject).toBe('Verifica tu correo electrónico'); // the user's stored language
		expect(mail.text).toContain('/verify-email?token=');
		expect(mail.text).not.toContain('/api/verify-email');
		expect(mail.text).toContain('&lang=es');
		expect(mem.tokens).toHaveLength(1);
		expect(mem.tokens[0].identifier).toBe('signup:new@company.dev');

		// A second attempt right away is refused the same way, but nothing is re-sent.
		await expect(authorizeCredentials({ email: 'new@company.dev', password: 'correct horse battery' }, req())).rejects.toBeInstanceOf(EmailNotVerifiedError);
		expect(sendMail).toHaveBeenCalledTimes(1);
	});

	it('the durable cooldown holds even when the in-memory limits reset (a deploy)', async () => {
		await authorizeCredentials({ email: 'new@company.dev', password: 'correct horse battery' }, req()).catch(() => {});
		expect(sendMail).toHaveBeenCalledTimes(1);
		__resetSignupVerificationLimitsForTests();
		await authorizeCredentials({ email: 'new@company.dev', password: 'correct horse battery' }, req('198.51.100.9')).catch(() => {});
		expect(sendMail).toHaveBeenCalledTimes(1);
	});

	it('an account that also has a Google/GitHub link: code use_provider, nothing re-sent', async () => {
		const err = await authorizeCredentials({ email: 'mixed@company.dev', password: 'correct horse battery' }, req()).catch((e) => e);
		expect(err).toBeInstanceOf(UseProviderError);
		expect(err).toBeInstanceOf(CredentialsSignin);
		expect(err.code).toBe('use_provider');
		expect(sendMail).not.toHaveBeenCalled();
		expect(mem.tokens).toHaveLength(0);
	});

	it('a wrong password returns null and sends nothing, verified or not', async () => {
		expect(await authorizeCredentials({ email: 'new@company.dev', password: 'wrong password!!' }, req())).toBeNull();
		expect(await authorizeCredentials({ email: 'ok@company.dev', password: 'wrong password!!' }, req())).toBeNull();
		expect(sendMail).not.toHaveBeenCalled();
	});

	it('unknown address returns null', async () => {
		expect(await authorizeCredentials({ email: 'nobody@company.dev', password: 'correct horse battery' }, req())).toBeNull();
	});

	it('junk or oversized input never reaches the database', async () => {
		expect(await authorizeCredentials({ email: 'a\u0000@x.io', password: 'x' }, req())).toBeNull();
		expect(await authorizeCredentials({ email: `${'a'.repeat(300)}@x.io`, password: 'x' }, req())).toBeNull();
		expect(await authorizeCredentials({ email: 'ok@company.dev', password: '' }, req())).toBeNull();
		expect(await authorizeCredentials(undefined, req())).toBeNull();
		expect(mem.queries).toBe(0);
	});
});
