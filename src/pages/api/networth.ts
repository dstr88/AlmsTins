import type { APIRoute } from 'astro';
import { getNetWorthSummary } from '@/lib/networth';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const GET: APIRoute = async ({ request }) => {
	try {
		const { tenantId } = await requireTenantSession(request);
		const summary = await getNetWorthSummary(tenantId);

		return new Response(
			JSON.stringify({
				ok: true,
				...summary,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err: unknown) {
		console.error('GET /api/networth error', err);
		const message = err instanceof Error ? err.message : 'Unable to load net worth.';

		return new Response(
			JSON.stringify({
				ok: false,
				error: message,
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
};
