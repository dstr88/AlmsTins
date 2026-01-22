import type { APIRoute } from 'astro';
import { getSimplePricesById } from '@/lib/prices/coingecko';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const url = new URL(request.url);
		const rawIds = url.searchParams.get('ids') ?? '';
		const ids = rawIds
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean);
		if (!ids.length) {
			return new Response(JSON.stringify({ error: 'Missing ids' }), { status: 400 });
		}
		const payload = await getSimplePricesById(ids);
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
		});
	} catch (error) {
		console.error('[api/coingecko-prices-by-id] failed', error);
		return new Response(JSON.stringify({ error: 'Unable to fetch CoinGecko prices' }), { status: 500 });
	}
};
