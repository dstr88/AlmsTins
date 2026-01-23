import type { APIRoute } from 'astro';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';

export const GET: APIRoute = async ({ url }) => {
	const symbolsParam = url.searchParams.get('symbols') ?? '';
	const symbols = symbolsParam
		.split(',')
		.map((s) => s.trim().toUpperCase())
		.filter(Boolean);

	try {
		const tickers = (await getTickersUSD()) as Array<{
			symbol?: string;
			quotes?: { USD?: { price?: number } };
		}>;
		const priceMap: Record<string, number> = {};
		const symbolSet = new Set(symbols);
		for (const ticker of tickers) {
			const symbol = String(ticker.symbol ?? '').trim().toUpperCase();
			if (!symbol || (symbolSet.size && !symbolSet.has(symbol))) continue;
			const price = ticker.quotes?.USD?.price;
			if (typeof price === 'number') {
				priceMap[symbol] = price;
			}
		}
		return new Response(JSON.stringify({ prices: priceMap }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('[api/coinpaprika-prices] failed', error);
		return new Response(JSON.stringify({ error: 'Failed to fetch prices' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
