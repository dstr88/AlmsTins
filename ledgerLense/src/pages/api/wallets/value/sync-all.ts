import type { APIRoute } from 'astro';
import { syncWalletValuesForAllWallets } from '@/lib/sync/syncWalletValue';
import { requireUser } from '@/lib/auth';

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
	try {
		if (!import.meta.env.DEV) {
			const user = await requireUser(ctx);
			if (!user) {
				return new Response('Unauthorized', { status: 401 });
			}
		}

		const result = await syncWalletValuesForAllWallets();
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
