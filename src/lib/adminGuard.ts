import { getAuthSession } from './authSession';
import { db } from './db';

const ADMIN_EMAILS = new Set(
	(process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? 'donnie@titaniumhut.com')
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean),
);

export async function requireAdminSession(request: Request): Promise<{ userId: string; email: string }> {
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) {
		throw new Response('Unauthorized', { status: 401 });
	}

	// Pull email from DB (JWT may not carry it)
	const row = await db
		.execute({ sql: 'SELECT email FROM auth_users WHERE id = ? LIMIT 1', args: [session.user.id] })
		.then((r) => r.rows[0] as Record<string, unknown> | undefined)
		.catch(() => undefined);

	const email = String(row?.email ?? session.user.email ?? '').toLowerCase();

	if (!ADMIN_EMAILS.has(email)) {
		throw new Response('Forbidden', { status: 403 });
	}

	return { userId: session.user.id, email };
}
