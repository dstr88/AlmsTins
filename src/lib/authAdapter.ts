import type { Adapter, AdapterAccount, AdapterSession, AdapterUser, VerificationToken } from '@auth/core/adapters';
import crypto from 'node:crypto';
import { db } from './db';

type Row = Record<string, unknown>;

const toDate = (value: unknown) => (value ? new Date(String(value)) : null);
const toStringOrUndefined = (value: unknown) => (value == null ? undefined : String(value));
const toLowercaseOrUndefined = (value: unknown) =>
	value == null ? undefined : (String(value).toLowerCase() as Lowercase<string>);
const toNumberOrUndefined = (value: unknown) => {
	if (value == null) return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
};
const toDbValue = (value: unknown): string | number | boolean | bigint | null => {
	if (value == null) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return value;
	}
	if (value instanceof Date) return value.toISOString();
	return JSON.stringify(value);
};

const normalizeAccountType = (value: unknown): AdapterAccount['type'] => {
	const type = String(value ?? '');
	if (type === 'oauth' || type === 'email' || type === 'oidc' || type === 'webauthn') {
		return type;
	}
	return 'oauth';
};

const mapUser = (row: Row): AdapterUser => ({
	id: String(row.id),
	name: row.name ? String(row.name) : null,
	email: row.email ? String(row.email) : '',
	emailVerified: toDate(row.email_verified),
	image: row.image ? String(row.image) : null,
});

const mapAccount = (row: Row): AdapterAccount => ({
	userId: String(row.user_id),
	type: normalizeAccountType(row.type),
	provider: String(row.provider),
	providerAccountId: String(row.provider_account_id),
	access_token: toStringOrUndefined(row.access_token),
	token_type: toLowercaseOrUndefined(row.token_type),
	scope: toStringOrUndefined(row.scope),
	expires_at: toNumberOrUndefined(row.expires_at),
	refresh_token: toStringOrUndefined(row.refresh_token),
	id_token: toStringOrUndefined(row.id_token),
	session_state: toStringOrUndefined(row.session_state),
});

const mapSession = (row: Row): AdapterSession => ({
	sessionToken: String(row.session_token),
	userId: String(row.user_id),
	expires: new Date(String(row.expires)),
});

const mapVerificationToken = (row: Row): VerificationToken => ({
	identifier: String(row.identifier),
	token: String(row.token),
	expires: new Date(String(row.expires)),
});

const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Ensure auth_users has a created_at column — added lazily, NO default, so existing rows
// stay NULL and the onboarding drip never retro-enrolls pre-launch users. Runs once per
// process before the first user insert; idempotent (PG ADD COLUMN IF NOT EXISTS).
let _createdAtEnsured = false;
export async function ensureAuthUsersCreatedAt(): Promise<void> {
	if (_createdAtEnsured) return;
	try {
		await db.execute({ sql: 'ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS created_at TEXT', args: [] });
	} catch (err) {
		console.warn('[authAdapter] ensure created_at column', err instanceof Error ? err.message : err);
	}
	_createdAtEnsured = true;
}

export const authAdapter = (): Adapter => ({
	async createUser(user) {
		console.log('[authAdapter] createUser called', { email: user.email, name: user.name });
		await ensureAuthUsersCreatedAt();
		// Auth types require a string email; keep empty string if provider didn't supply one.
		const email = user.email ?? '';
		// If a user with this email already exists (e.g. created via credentials),
		// return them instead of inserting a duplicate. Auth.js will then call
		// linkAccount() to attach the new OAuth provider to the existing user.
		if (email) {
			const existing = await db.execute({
				sql: 'SELECT * FROM auth_users WHERE email = ? LIMIT 1',
				args: [email],
			});
			if (existing.rows.length) {
				console.log('[authAdapter] createUser — existing user found, returning', { email });
				return mapUser(existing.rows[0] as Row);
			}
		}
		const id = user.id ?? crypto.randomUUID();
		// Do not store the name or profile image supplied by OAuth providers —
		// Google and GitHub send the user's real name and avatar, which we don't
		// need and don't want sitting in the database.
		await db.execute({
			sql: `INSERT INTO auth_users (id, name, email, email_verified, image, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
			args: [id, null, email, user.emailVerified?.toISOString() ?? null, null, nowUtc()],
		});
		return { ...user, id, email, name: null, image: null };
	},
	async getUser(id) {
		const result = await db.execute({ sql: 'SELECT * FROM auth_users WHERE id = ? LIMIT 1', args: [id] });
		if (result.rows.length === 0) return null;
		return mapUser(result.rows[0] as Row);
	},
	async getUserByEmail(email) {
		console.log('[authAdapter] getUserByEmail called', { email });
		// Always return null — prevents OAuthAccountNotLinked entirely.
		// createUser() handles the email-exists case by returning the existing user.
		return null;
	},
	async getUserByAccount({ provider, providerAccountId }) {
		console.log('[authAdapter] getUserByAccount called', { provider, providerAccountId });
		const result = await db.execute({
			sql: `SELECT u.*
        FROM auth_users u
        INNER JOIN auth_accounts a ON a.user_id = u.id
        WHERE a.provider = ? AND a.provider_account_id = ?
        LIMIT 1`,
			args: [provider, providerAccountId],
		});
		if (result.rows.length === 0) return null;
		return mapUser(result.rows[0] as Row);
	},
	async updateUser(user) {
		// Auth types require a string email; keep empty string if provider didn't supply one.
		const email = user.email ?? '';
		// Never overwrite name/image with OAuth profile data — we don't store it.
		await db.execute({
			sql: `UPDATE auth_users
        SET email = ?, email_verified = ?
        WHERE id = ?`,
			args: [
				email,
				user.emailVerified?.toISOString() ?? null,
				user.id,
			],
		});
		const result = await db.execute({ sql: 'SELECT * FROM auth_users WHERE id = ? LIMIT 1', args: [user.id] });
		return mapUser(result.rows[0] as Row);
	},
	async deleteUser(id) {
		await db.execute({ sql: 'DELETE FROM auth_users WHERE id = ?', args: [id] });
	},
	async linkAccount(account) {
		console.log('[authAdapter] linkAccount', { provider: account.provider, providerAccountId: account.providerAccountId, userId: account.userId });
		// Use DELETE + INSERT instead of an UPSERT so this works regardless of
		// whether the auth_accounts table has a UNIQUE(provider, provider_account_id)
		// constraint. Deleting first is idempotent and avoids all constraint issues.
		await db.execute({
			sql: 'DELETE FROM auth_accounts WHERE provider = ? AND provider_account_id = ?',
			args: [toDbValue(account.provider), toDbValue(account.providerAccountId)],
		});
		await db.execute({
			sql: `INSERT INTO auth_accounts (
          id, user_id, type, provider, provider_account_id, access_token, token_type, scope,
          expires_at, refresh_token, id_token, session_state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				toDbValue(crypto.randomUUID()),
				toDbValue(account.userId),
				toDbValue(normalizeAccountType(account.type)),
				toDbValue(account.provider),
				toDbValue(account.providerAccountId),
				toDbValue(account.access_token),
				toDbValue(account.token_type),
				toDbValue(account.scope),
				toDbValue(account.expires_at),
				toDbValue(account.refresh_token),
				toDbValue(account.id_token),
				toDbValue(account.session_state),
			],
		});
		console.log('[authAdapter] linkAccount OK');
		return account;
	},
	async unlinkAccount({ provider, providerAccountId }) {
		await db.execute({
			sql: 'DELETE FROM auth_accounts WHERE provider = ? AND provider_account_id = ?',
			args: [provider, providerAccountId],
		});
	},
	async createSession(session) {
		await db.execute({
			sql: `INSERT INTO auth_sessions (session_token, user_id, expires)
        VALUES (?, ?, ?)`,
			args: [session.sessionToken, session.userId, session.expires.toISOString()],
		});
		return session;
	},
	async getSessionAndUser(sessionToken) {
		const result = await db.execute({
			sql: `SELECT s.session_token, s.user_id, s.expires, u.*
        FROM auth_sessions s
        INNER JOIN auth_users u ON u.id = s.user_id
        WHERE s.session_token = ?
        LIMIT 1`,
			args: [sessionToken],
		});
		if (result.rows.length === 0) return null;
		const row = result.rows[0] as Row;
		return {
			session: mapSession(row),
			user: mapUser(row),
		};
	},
	async updateSession(session) {
		const expiresIso = session.expires?.toISOString();
		if (!expiresIso) throw new Error('Missing session expiry');
		await db.execute({
			sql: `UPDATE auth_sessions
        SET user_id = ?, expires = ?
        WHERE session_token = ?`,
			args: [String(session.userId), expiresIso, String(session.sessionToken)],
		});
		const result = await db.execute({
			sql: 'SELECT * FROM auth_sessions WHERE session_token = ? LIMIT 1',
			args: [session.sessionToken],
		});
		if (result.rows.length === 0) return null;
		return mapSession(result.rows[0] as Row);
	},
	async deleteSession(sessionToken) {
		await db.execute({ sql: 'DELETE FROM auth_sessions WHERE session_token = ?', args: [sessionToken] });
	},
	async createVerificationToken(token) {
		await db.execute({
			sql: `INSERT INTO auth_verification_tokens (identifier, token, expires)
        VALUES (?, ?, ?)`,
			args: [token.identifier, token.token, token.expires.toISOString()],
		});
		return token;
	},
	async useVerificationToken({ identifier, token }) {
		const result = await db.execute({
			sql: `SELECT * FROM auth_verification_tokens
        WHERE identifier = ? AND token = ?
        LIMIT 1`,
			args: [identifier, token],
		});
		if (result.rows.length === 0) return null;
		await db.execute({
			sql: 'DELETE FROM auth_verification_tokens WHERE identifier = ? AND token = ?',
			args: [identifier, token],
		});
		return mapVerificationToken(result.rows[0] as Row);
	},
});
