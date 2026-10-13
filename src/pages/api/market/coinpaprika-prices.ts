import type { APIRoute } from 'astro';
import { createHash } from 'crypto';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';
import { getCache, setCache } from '@/lib/tursoCache';
import { tryAcquireLock } from '@/lib/cacheLock';

const inflight = new Map<string, Promise<Record<string, number>>>();
let tickersCache: { expiresAt: number; payload: Array<any> } | null = null;
let tickersInflight: Promise<Array<any>> | null = null;
const TICKERS_TTL_MS = 60_000;
const PRICES_TTL_SECONDS = 60;
const PRICES_STALE_MAX_SECONDS = 600;
const REFRESH_LOCK_SECONDS = 20;

function buildSymbolsKey(symbols: string[]) {
	const raw = symbols.join(',');
	return createHash('sha256').update(raw).digest('hex');
}

async function getTickersCached() {
	if (tickersCache && tickersCache.expiresAt > Date.now()) {
		return { tickers: tickersCache.payload, cached: true, durationMs: 0 };
	}
	if (tickersInflight) {
		const tickers = await tickersInflight;
		return { tickers, cached: true, durationMs: 0 };
	}
	const start = Date.now();
	const promise = (async () => {
		const tickers = (await getTickersUSD()) as Array<any>;
		tickersCache = { expiresAt: Date.now() + TICKERS_TTL_MS, payload: tickers };
		return tickers;
	})();
	tickersInflight = promise;
	try {
		const tickers = await promise;
		return { tickers, cached: false, durationMs: Date.now() - start };
	} finally {
		if (tickersInflight === promise) {
			tickersInflight = null;
		}
	}
}

async function getCachedPrices(symbols: string[], requestId: string | undefined, allowedCount: number) {
	const tickersStart = Date.now();
	const { tickers, cached: tickersCached, durationMs: tickersMs } = await getTickersCached();
	console.log('[perf] coinpaprika-tickers', {
		requestId,
		durationMs: tickersMs || Date.now() - tickersStart,
		cached: tickersCached,
	});
	const buildStart = Date.now();
	const typedTickers = tickers as Array<{
		id?: string;
		symbol?: string;
		rank?: number;
		quotes?: { USD?: { price?: number } };
	}>;
	const priceMap: Record<string, number> = {};
	const symbolSet = new Set(symbols);
	const candidates = new Map<string, Array<{ id: string; price: number; rank: number }>>();
	for (const ticker of typedTickers) {
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
	}
	console.log('[perf] coinpaprika-build', {
		requestId,
		durationMs: Date.now() - buildStart,
		allowedCount,
	});
	return priceMap;
}

async function computePrices(symbols: string[], requestId: string | undefined, allowedCount: number) {
	let prices: Record<string, number> = {};

	const cachedPrices = await getCachedPrices(symbols, requestId, allowedCount);
	for (const symbol of symbols) {
		const cachedPrice = cachedPrices[symbol];
		if (typeof cachedPrice === 'number' && cachedPrice > 0) {
			prices[symbol] = cachedPrice;
		}
	}

	return { prices, coingeckoFetchedCount: 0, timedOut: false };
}

export const GET: APIRoute = async ({ url, locals }) => {
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const startedAt = Date.now();
	const requestId =
		(locals as Record<string, any>)?.requestId ??
		(typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(16).slice(2)}`);
	const symbolsParam = url.searchParams.get('symbols') ?? '';
	const rawSymbols = symbolsParam.split(',').map((s) => s.trim()).filter(Boolean);
	const symbols = allowlistSymbols(rawSymbols);
	const requestedCount = rawSymbols.length;
	const allowedCount = symbols.length;
	const droppedCount = Math.max(0, requestedCount - allowedCount);
	console.log('[coinpaprika] symbols', { requestedCount, allowedCount, droppedCount });

	if (!symbols.length) {
		console.log('[perf] coinpaprika-prices', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status: 200,
			allowedCount,
			count: 0,
		});
		return new Response(JSON.stringify({ prices: {} }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
		});
	}

	const cacheKey = `mkt:cp:symbols:${buildSymbolsKey(symbols)}:v1`;
	const lockKey = `lock:${cacheKey}`;

	const cachedDb = await getCache<{ prices: Record<string, number> }>(cacheKey, {
		allowStale: true,
		staleMaxAgeSeconds: PRICES_STALE_MAX_SECONDS,
	});
	if (cachedDb?.value?.prices) {
		if (cachedDb.isStale) {
			(async () => {
				const gotLock = await tryAcquireLock(lockKey, REFRESH_LOCK_SECONDS);
				if (!gotLock) {
					console.log('[cache] coinpaprika-prices refresh skip (lock-busy)', { requestId, cacheKey });
					return;
				}
				try {
					const result = await computePrices(symbols, requestId, allowedCount);
					await setCache(cacheKey, { prices: result.prices }, PRICES_TTL_SECONDS);
					console.log('[cache] coinpaprika-prices refreshed', {
						requestId,
						count: Object.keys(result.prices).length,
					});
				} catch (err) {
					console.warn('[cache] coinpaprika-prices refresh failed', { err });
				}
			})();
		}
		console.log('[perf] coinpaprika-prices', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status: 200,
			cached: true,
			stale: cachedDb.isStale,
			allowedCount,
			count: Object.keys(cachedDb.value.prices ?? {}).length,
		});
		return new Response(
			JSON.stringify({ prices: cachedDb.value.prices, cached: true, stale: cachedDb.isStale }),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
			},
		);
	}

	try {
		let promise = inflight.get(cacheKey);
		if (!promise) {
			promise = (async () => {
				const result = await computePrices(symbols, requestId, allowedCount);
				return result.prices;
			})();
			inflight.set(cacheKey, promise);
		}
		let priceMap: Record<string, number>;
		try {
			priceMap = await promise;
		} finally {
			if (inflight.get(cacheKey) === promise) {
				inflight.delete(cacheKey);
			}
		}
		await setCache(cacheKey, { prices: priceMap }, PRICES_TTL_SECONDS);
		console.log('[coinpaprika] done', { durationMs: Date.now() - startedAt, cached: false });
		console.log('[perf] coinpaprika-prices', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status: 200,
			cached: false,
			stale: false,
			allowedCount,
			count: Object.keys(priceMap).length,
		});
		return new Response(JSON.stringify({ prices: priceMap, cached: false, stale: false }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
		});
	} catch (error) {
		console.error('[api/coinpaprika-prices] failed', error);
		console.log('[perf] coinpaprika-prices', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status: 500,
			allowedCount,
		});
		return new Response(JSON.stringify({ error: 'Failed to fetch prices' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
