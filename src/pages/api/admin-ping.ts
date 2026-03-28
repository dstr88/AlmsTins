import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';

// Lightweight diagnostic — returns env/session info so we can confirm
// which build is running on Render and whether the admin check can pass.
export const GET: APIRoute = async ({ request }) => {
	const session = await getAuthSession(request).catch(() => null);
	const tenantId = String(session?.tenantId ?? '');

	const adminTenantIds = (process.env.ADMIN_TENANT_IDS ?? process.env.ADMIN_TENANT_ID ?? '').trim();
	const adminEmails = (process.env.ADMIN_EMAILS ?? process.env.ADMIN_EMAIL ?? '').trim();

	const configured = adminTenantIds.length > 0 || adminEmails.length > 0;
	const tenantMatch = adminTenantIds
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
		.includes(tenantId.toLowerCase());

	return new Response(JSON.stringify({
		build: 'v2-tenant-id',
		hasSession: Boolean(session?.user?.id),
		tenantId: tenantId ? tenantId.slice(0, 8) + '…' : null,
		adminEnvConfigured: configured,
		adminTenantIdsSet: adminTenantIds.length > 0,
		adminEmailsSet: adminEmails.length > 0,
		tenantMatch,
	}), {
		headers: { 'Content-Type': 'application/json' },
	});
};
