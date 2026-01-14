import type { APIContext } from 'astro';
import crypto from 'node:crypto';
import { getSession } from '@auth/astro';

export const SESSION_COOKIE_NAME = 'dashboard_session';
const SESSION_SALT = import.meta.env.DASHBOARD_SESSION_SALT ?? 'titaniumhut-dashboard';

export function generateSessionToken(passphrase: string) {
	return crypto.createHash('sha256').update(`${passphrase}:${SESSION_SALT}`).digest('hex');
}

export function isAuthDisabled() {
	return import.meta.env.AUTH_DISABLED === 'true';
}

export function isValidSession(token: string | undefined) {
	const secret = import.meta.env.DASHBOARD_PASS;
	if (!secret) {
		return true;
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

export async function requireUser(context: Pick<APIContext, 'request'>): Promise<SessionUser | null> {
	if (isAuthDisabled()) {
		return { sessionToken: 'dev-mode', id: 'dev-user' };
	}

	const session = await getSession(context.request);
	if (!session) {
		return null;
	}
	const userId = session.user && 'id' in session.user ? String(session.user.id ?? '') : '';
	if (!userId) {
		return null;
	}

	return { sessionToken: 'authjs-session', id: userId };
}
