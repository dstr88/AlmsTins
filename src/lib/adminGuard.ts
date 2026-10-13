import { getAuthSession } from './authSession';
import { db } from './db';

// Comma-separated list of admin emails (case-insensitive).
const ADMIN_EMAILS = new Set(
	(process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? '')
		.split(',')
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean),
);

// Comma-separated list of admin tenant IDs — more reliable than email because
// the tenant ID is always present in the JWT regardless of OAuth email privacy.
// Set ADMIN_TENANT_IDS on Render to the tenant ID shown in the account menu.
const ADMIN_TENANT_IDS = new Set(
	(process.env.ADMIN_TENANT_IDS ?? process.env.ADMIN_TENANT_ID ?? '')
		.split(',')
		.map((id) => id.trim().toLowerCase())
		.filter(Boolean),
);

function isAdminEmail(email: string): boolean {
	return Boolean(email && ADMIN_EMAILS.has(email.toLowerCase()));
}

function isAdminTenant(tenantId: string | null | undefined): boolean {
	return Boolean(tenantId && ADMIN_TENANT_IDS.has(tenantId.toLowerCase()));
}

export async function requireAdminSession(request: Request): Promise<{ userId: string; email: string }> {
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) {
		throw new Response('Unauthorized', { status: 401 });
	}

	// Check tenant ID first — always in JWT, no email dependency.
	if (isAdminTenant(session.tenantId)) {
		const email = session.user.email ?? '';
		return { userId: session.user.id, email };
	}

	// Fallback: check email (from JWT or DB).
	const row = await db
		.execute({ sql: 'SELECT email FROM auth_users WHERE id = ? LIMIT 1', args: [session.user.id] })
		.then((r) => r.rows[0] as Record<string, unknown> | undefined)
		.catch(() => undefined);

	const email = String(row?.email ?? session.user.email ?? '').toLowerCase();

	if (!isAdminEmail(email)) {
		throw new Response('Forbidden', { status: 403 });
	}

	return { userId: session.user.id, email };
}

/** Returns true if the session belongs to an admin (tenant ID or email match). */
export async function isAdminSession(request: Request): Promise<boolean> {
	try {
		await requireAdminSession(request);
		return true;
	} catch {
		return false;
	}
}
