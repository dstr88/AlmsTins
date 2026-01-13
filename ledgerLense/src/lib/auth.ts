import type { APIContext } from 'astro';
import crypto from 'node:crypto';
import { db } from './db';

export const SESSION_COOKIE_NAME = 'dashboard_session';
const SESSION_SALT = import.meta.env.DASHBOARD_SESSION_SALT ?? 'titaniumhut-dashboard';

export function generateSessionToken(passphrase: string) {
	return crypto.createHash('sha256').update(`${passphrase}:${SESSION_SALT}`).digest('hex');
}

export function isAuthDisabled() {
	return false;
}

export function isValidSession(token: string | undefined) {
	const secret = import.meta.env.DASHBOARD_PASS;
	if (!secret) {
		return false;
	}
	if (!token) {
		return false;
	}
	return token === generateSessionToken(secret);
}

export type SessionUser = {
	sessionToken: string;
	id: string;
};

let cachedUserId: string | null = null;

export async function requireUser(context: Pick<APIContext, 'cookies'>): Promise<SessionUser | null> {
	const userId = await resolveUserId();
	if (isAuthDisabled()) {
		return null;
	}

	const token = context.cookies.get(SESSION_COOKIE_NAME)?.value;
	if (!token || !isValidSession(token)) {
		return null;
	}

	return { sessionToken: token, id: userId };
}

async function resolveUserId() {
	if (cachedUserId) return cachedUserId;
	const result = await db.execute('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
	if (result.rows.length === 0) {
		throw new Error('No user configured in database');
	}
	const row = result.rows[0] as Record<string, unknown>;
	const idValue = row.id;
	cachedUserId = String(idValue);
	return cachedUserId;
}
