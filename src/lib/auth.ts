import type { APIContext } from 'astro';
import { getAuthSession } from './authSession';

export function isAuthDisabled() {
	return process.env.AUTH_DISABLED === 'true';
}

export type SessionUser = {
	id: string;
};

export async function requireUser(context: Pick<APIContext, 'request'>): Promise<SessionUser | null> {
	if (isAuthDisabled()) {
		return { id: 'dev-user' };
	}

	const session = await getAuthSession(context.request);
	if (!session) {
		return null;
	}
	const userId = session.user && 'id' in session.user ? String(session.user.id ?? '') : '';
	if (!userId) {
		return null;
	}

	return { id: userId };
}
