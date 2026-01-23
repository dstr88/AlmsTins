import type { APIRoute } from 'astro';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { getSimpleTokenPrices } from '@/lib/prices/coingecko';

async function getCachedPrices(symbols: string[]) {
	if (!symbols.length) return {};
	const symbolSet = new Set(symbols.map((symbol) => symbol.toUpperCase()));
	const tickers = (await getTickersUSD()) as Array<{
		symbol?: string;
		quotes?: { USD?: { price?: number } };
	}>;
	const priceMap: Record<string, number> = {};
	for (const ticker of tickers) {
		const symbol = String(ticker.symbol ?? '').trim().toUpperCase();
		if (!symbol || !symbolSet.has(symbol)) continue;
		const price = ticker.quotes?.USD?.price;
		if (typeof price === 'number') {
			priceMap[symbol] = price;
		}
	}
	return priceMap;
}

export const GET: APIRoute = async ({ url }) => {
	const symbolsParam = url.searchParams.get('symbols') ?? '';
	const symbols = symbolsParam
		.split(',')
		.map((s) => s.trim().toUpperCase())
		.filter(Boolean);

	try {
		const prices = await getSimpleTokenPrices(symbols);
		// Added token price to wallet and exchanges.
		const missing = symbols.filter((symbol) => !prices[symbol] || prices[symbol] <= 0);
		if (missing.length) {
			const cached = await getCachedPrices(missing);
			for (const symbol of missing) {
				const cachedPrice = cached[symbol];
				if (typeof cachedPrice === 'number' && cachedPrice > 0) {
					prices[symbol] = cachedPrice;
				}
			}
		}
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
