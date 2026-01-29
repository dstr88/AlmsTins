import { getCache, setCache } from '@/lib/tursoCache';

const BASE_URL = 'https://api.coinpaprika.com/v1';
const CACHE_KEY = 'coinpaprika:tickers:all:quotes=USD';

const MEMORY_TTL_SECONDS = Math.min(
	300,
	Math.max(60, Number(import.meta.env.COINPAPRIKA_L1_TTL_SECONDS ?? 120)),
);
const TURSO_TTL_SECONDS = Math.min(
	3600,
	Math.max(60, Number(import.meta.env.COINPAPRIKA_L2_TTL_SECONDS ?? 600)),
);

const memoryCache = new Map<string, { expiresAt: number; payload: unknown }>();
// Deduplicate concurrent fetches per cache key.
const inflight = new Map<string, Promise<unknown>>();
let lastFetchAt = 0;
const MIN_INTERVAL_MS = 12_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getMemoryCache(key: string) {
	const cached = memoryCache.get(key);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.payload;
	}
	return null;
}

function setMemoryCache(key: string, payload: unknown, ttlSeconds: number) {
	memoryCache.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, payload });
}

async function fetchTickersUSD() {
	const now = Date.now();
	const waitMs = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - now);
	if (waitMs) {
		await sleep(waitMs);
	}
	lastFetchAt = Date.now();
	const url = `${BASE_URL}/tickers?quotes=USD`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Coinpaprika HTTP ${response.status}`);
	}
	const payload = await response.json();
	if (!Array.isArray(payload)) {
		throw new Error('Coinpaprika payload invalid');
	}
	return payload;
}

export async function getTickersUSD(options?: { forceRefresh?: boolean }) {
	const forceRefresh = options?.forceRefresh === true;

	if (!forceRefresh) {
		const memory = getMemoryCache(CACHE_KEY);
		if (memory) return memory;
		const cached = await getCache(CACHE_KEY);
		if (cached) {
			setMemoryCache(CACHE_KEY, cached, MEMORY_TTL_SECONDS);
			return cached;
		}
	}

	const existing = inflight.get(CACHE_KEY);
	if (existing) return existing;

	const promise = (async () => {
		const payload = await fetchTickersUSD();
		setMemoryCache(CACHE_KEY, payload, MEMORY_TTL_SECONDS);
		await setCache(CACHE_KEY, payload, TURSO_TTL_SECONDS);
		return payload;
	})();

	inflight.set(CACHE_KEY, promise);

	try {
		return await promise;
	} finally {
		inflight.delete(CACHE_KEY);
	}
}

export async function prewarmCoinpaprikaCache() {
	await getTickersUSD();
}
