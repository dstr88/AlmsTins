import type { APIRoute } from 'astro';
import { syncWalletValuesForAllWallets } from '@/lib/sync/syncWalletValue';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
	try {
		const { tenantId } = await requireTenantSession(ctx.request);
		const result = await syncWalletValuesForAllWallets(tenantId);
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-store',
			},
		});
	} catch (err: any) {
		console.error('[VALUE] sync error', err);
		return new Response(JSON.stringify({ error: err?.message ?? 'Value sync failed' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
