import type { APIRoute } from 'astro';
import { searchCoingecko } from '@/lib/prices/coingecko';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const requestId = (locals as Record<string, any>)?.requestId;
	try {
		const url = new URL(request.url);
		const query = url.searchParams.get('query')?.trim() ?? '';
		if (!query) {
			console.log('[perf] coingecko-search', {
				requestId,
				durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
				status: 400,
			});
			return new Response(JSON.stringify({ error: 'Missing query' }), { status: 400 });
		}
		const payload = await searchCoingecko(query);
		console.log('[perf] coingecko-search', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status: 200,
			count: Array.isArray(payload?.coins) ? payload.coins.length : 0,
		});
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
		});
	} catch (error) {
		console.error('[api/coingecko-search] failed', error);
		console.log('[perf] coingecko-search', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status: 500,
		});
		return new Response(JSON.stringify({ error: 'Unable to search CoinGecko' }), { status: 500 });
	}
};
