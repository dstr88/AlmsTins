import type { APIRoute } from 'astro';
import { syncAllWallets } from '@/lib/sync/syncTransactions';
import { requireUser } from '@/lib/auth';

export const prerender = false;

export const POST: APIRoute = async (Astro) => {
	console.log('[sync-all] import.meta.env.DEV =', import.meta.env.DEV);
	// --- DEV MODE BYPASS AUTH ---
	if (import.meta.env.DEV) {
		console.info('[sync-all] DEV mode: skipping auth');
	} else {
		// --- PRODUCTION AUTH ---
		const user = await requireUser(Astro);
		if (!user) {
			return new Response('Unauthorized', { status: 401 });
		}
	}

	try {
		const result = await syncAllWallets();
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	} catch (err) {
		console.error('Sync error:', err);
		return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
	}
};
