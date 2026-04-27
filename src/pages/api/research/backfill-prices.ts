import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getActivePlan } from '@/lib/subscriptions';
import { priceMissingImportTransactions } from '@/lib/priceMissingImportTransactions';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const plan = await getActivePlan(tenantId);
	if (plan.id === 'free') {
		return new Response(JSON.stringify({
			error: 'Price backfill is available on any paid plan. Upgrade at /dashboard/billing.',
			planRequired: 'paid',
		}), { status: 403, headers: { 'Content-Type': 'application/json' } });
	}

	const result = await priceMissingImportTransactions(tenantId);

	return new Response(JSON.stringify(result), {
		status: result.ok ? 200 : 500,
		headers: { 'Content-Type': 'application/json' },
	});
};
