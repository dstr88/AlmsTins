import type { APIRoute } from 'astro';
import { searchCoingecko } from '@/lib/prices/coingecko';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const url = new URL(request.url);
		const query = url.searchParams.get('query')?.trim() ?? '';
		if (!query) {
			return new Response(JSON.stringify({ error: 'Missing query' }), { status: 400 });
		}
		const payload = await searchCoingecko(query);
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
		});
	} catch (error) {
		console.error('[api/coingecko-search] failed', error);
		return new Response(JSON.stringify({ error: 'Unable to search CoinGecko' }), { status: 500 });
	}
};
