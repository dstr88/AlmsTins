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
			id?: string;
			symbol?: string;
			rank?: number;
			quotes?: { USD?: { price?: number } };
		}>;
		const priceMap: Record<string, number> = {};
		const symbolSet = new Set(symbols);
		const candidates = new Map<
			string,
			Array<{ id: string; price: number; rank: number }>
		>();
		for (const ticker of tickers) {
			const symbol = String(ticker.symbol ?? '').trim().toUpperCase();
			if (!symbol || (symbolSet.size && !symbolSet.has(symbol))) continue;
			const price = ticker.quotes?.USD?.price;
			if (typeof price !== 'number') continue;
			const id = String(ticker.id ?? '').trim();
			const rank = Number.isFinite(ticker.rank) ? (ticker.rank as number) : 999999;
			const list = candidates.get(symbol) ?? [];
			list.push({ id, price, rank });
			candidates.set(symbol, list);
		}
		for (const symbol of symbolSet) {
			const list = candidates.get(symbol);
			if (!list?.length) continue;
			list.sort((a, b) => a.rank - b.rank);
			priceMap[symbol] = list[0].price;
			if (symbol === 'ETH') {
				console.log('[api/coinpaprika-prices] ETH candidates', list.slice(0, 5));
				console.log('[api/coinpaprika-prices] ETH selected', list[0]);
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
