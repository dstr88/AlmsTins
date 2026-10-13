// Fetches live stock prices from Yahoo Finance for a list of equity symbols.
// Used by cexSnapshot when the source is 'robinhood'.
// No API key required. Results are cached in-memory for 5 minutes.

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

type CacheEntry = { price: number; expiresAt: number };
const cache = new Map<string, CacheEntry>();

async function fetchOnePrice(symbol: string): Promise<number | null> {
	const now = Date.now();
	const cached = cache.get(symbol);
	if (cached && cached.expiresAt > now) return cached.price;

	try {
		const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d&includePrePost=false`;
		const res = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: { 'User-Agent': 'Mozilla/5.0' },
		});
		if (!res.ok) return null;
		const json = (await res.json()) as {
			chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> };
		};
		const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
		if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
		cache.set(symbol, { price, expiresAt: now + CACHE_TTL_MS });
		return price;
	} catch {
		return null;
	}
}

export async function fetchStockPrices(symbols: string[]): Promise<Record<string, number>> {
	if (!symbols.length) return {};
	const results = await Promise.all(symbols.map((s) => fetchOnePrice(s).then((p) => [s, p] as const)));
	const priceMap: Record<string, number> = {};
	for (const [sym, price] of results) {
		if (price !== null) priceMap[sym] = price;
	}
	return priceMap;
}
