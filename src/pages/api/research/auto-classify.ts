import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { logActivity } from '@/lib/activityLog';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });

	const classified = await autoClassifyOwnWalletTransfers(session.tenantId);
	logActivity(session.tenantId, 'auto_classify', `${classified} classified`, { classified });

	return new Response(JSON.stringify({ ok: true, classified }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
