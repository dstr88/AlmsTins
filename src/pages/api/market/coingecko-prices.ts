import type { APIRoute } from 'astro';
import { createHash } from 'crypto';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { getSimpleTokenPrices } from '@/lib/prices/coingecko';
import { allowlistSymbols } from '@/lib/prices/sanitizeSymbols';
import { getCache, setCache } from '@/lib/tursoCache';
import { tryAcquireLock } from '@/lib/cacheLock';

const CACHE_TTL_MS = 60_000;
const responseCache = new Map<string, { expiresAt: number; prices: Record<string, number> }>();
const PRICES_TTL_SECONDS = 60;
const PRICES_STALE_MAX_SECONDS = 600;
const REFRESH_LOCK_SECONDS = 20;

function withTimeout<T>(promise: Promise<T>, ms: number) {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timeout')), ms);
		promise
			.then((value) => {
				clearTimeout(timer);
				resolve(value);
			})
			.catch((error) => {
				clearTimeout(timer);
				reject(error);
			});
	});
}

function buildSymbolsKey(symbols: string[]) {
	const raw = symbols.join(',');
	return createHash('sha256').update(raw).digest('hex');
}

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

async function computePrices(symbols: string[]) {
	let prices: Record<string, number> = {};
	let coingeckoFetchedCount = 0;
	let timedOut = false;
	let errorMessage: string | null = null;

	const cachedPrices = await getCachedPrices(symbols);
	for (const symbol of symbols) {
		const cachedPrice = cachedPrices[symbol];
		if (typeof cachedPrice === 'number' && cachedPrice > 0) {
			prices[symbol] = cachedPrice;
		}
	}

	const missing = symbols.filter((symbol) => !prices[symbol] || prices[symbol] <= 0);
	if (missing.length) {
		try {
			const cgPrices = await withTimeout(getSimpleTokenPrices(missing), 2000);
			coingeckoFetchedCount = Object.keys(cgPrices ?? {}).length;
			for (const symbol of missing) {
				const cgPrice = cgPrices?.[symbol];
				if (typeof cgPrice === 'number' && cgPrice > 0) {
					prices[symbol] = cgPrice;
				}
			}
		} catch (error) {
			if (error instanceof Error && error.message === 'timeout') {
				timedOut = true;
			} else {
				errorMessage = error instanceof Error ? error.message : 'unknown';
			}
		}
	}

	return { prices, coingeckoFetchedCount, timedOut, errorMessage };
}

export const GET: APIRoute = async ({ url, locals }) => {
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const startedAt = Date.now();
	const requestId = (locals as Record<string, any>)?.requestId;
	const symbolsParam = url.searchParams.get('symbols') ?? '';
	const rawSymbols = symbolsParam.split(',').map((symbol) => symbol.trim()).filter(Boolean);
	const symbols = allowlistSymbols(rawSymbols);
	const requestedCount = rawSymbols.length;
	const allowedCount = symbols.length;
	const droppedCount = Math.max(0, requestedCount - allowedCount);

	console.log('[coingecko] symbols', { requestedCount, allowedCount, droppedCount });

	if (!symbols.length) {
		console.log('[perf] coingecko-prices', {
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

	const cacheKey = `mkt:cg:symbols:${buildSymbolsKey(symbols)}:v1`;
	const lockKey = `lock:${cacheKey}`;

	const cachedDb = await getCache<{ prices: Record<string, number> }>(cacheKey, {
		allowStale: true,
		staleMaxAgeSeconds: PRICES_STALE_MAX_SECONDS,
	});
	if (cachedDb && typeof cachedDb === 'object' && 'value' in cachedDb && cachedDb.value?.prices) {
		if (cachedDb.isStale) {
			(async () => {
				const gotLock = await tryAcquireLock(lockKey, REFRESH_LOCK_SECONDS);
				if (!gotLock) {
					console.log('[cache] coingecko-prices refresh skip (lock-busy)', { requestId, cacheKey });
					return;
				}
				try {
					const result = await computePrices(symbols);
					await setCache(cacheKey, { prices: result.prices }, PRICES_TTL_SECONDS);
					if (result.errorMessage) {
						console.warn('[coingecko] fetch failed', {
							requestId,
							err: result.errorMessage,
							allowedCount,
						});
					}
				} catch (err) {
					console.warn('[cache] coingecko-prices refresh failed', { err });
				}
			})();
		}
		console.log('[perf] coingecko-prices', {
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

	const cachedLocal = responseCache.get(cacheKey);
	if (cachedLocal && cachedLocal.expiresAt > Date.now()) {
		console.log('[perf] coingecko-prices', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status: 200,
			cached: true,
			stale: false,
			allowedCount,
			count: Object.keys(cachedLocal.prices ?? {}).length,
		});
		return new Response(JSON.stringify({ prices: cachedLocal.prices, cached: true, stale: false }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
		});
	}

	const result = await computePrices(symbols);
	if (result.errorMessage) {
		console.warn('[coingecko] fetch failed', { requestId, err: result.errorMessage, allowedCount });
	}

	console.log('[coingecko] done', {
		durationMs: Date.now() - startedAt,
		allowedCount,
		fetchedCount: result.coingeckoFetchedCount,
		cached: false,
		timedOut: result.timedOut,
	});

	responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, prices: result.prices });
	await setCache(cacheKey, { prices: result.prices }, PRICES_TTL_SECONDS);
	console.log('[perf] coingecko-prices', {
		requestId,
		durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
		status: 200,
		cached: false,
		stale: false,
		allowedCount,
		count: Object.keys(result.prices).length,
	});
	return new Response(JSON.stringify({ prices: result.prices, cached: false, stale: false }), {
		status: 200,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
	});
};
