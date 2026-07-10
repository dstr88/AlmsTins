import type { APIRoute } from 'astro';
import { syncAllWallets } from '@/lib/sync/syncTransactions';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

export const POST: APIRoute = async (Astro) => {
	try {
		const session = await requireTenantSession(Astro.request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const result = await syncAllWallets(tenantId);
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	} catch (err) {
		console.error('Sync error:', err);
		return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
	}
};
