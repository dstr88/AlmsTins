import type { APIRoute } from 'astro';
import { getSimpleTokenPrices } from '@/lib/prices/coingecko';

export const GET: APIRoute = async ({ url }) => {
	const symbolsParam = url.searchParams.get('symbols') ?? '';
	const symbols = symbolsParam
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	try {
		const prices = await getSimpleTokenPrices(symbols);
		return new Response(JSON.stringify({ prices }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('[api/coingecko-prices] failed', error);
		return new Response(JSON.stringify({ error: 'Failed to fetch prices' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
