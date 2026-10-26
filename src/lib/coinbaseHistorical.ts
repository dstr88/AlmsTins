/**
 * Historical USD prices for Bitcoin and Litecoin from Coinbase Exchange's public market data, for
 * days CoinGecko cannot price: without a Pro key it only answers the past 365 days
 * (src/lib/coingeckoHistorical.ts). Callers ask CoinGecko first and come here only when it gave
 * no price (src/lib/sync/utxoHistoricalPrice.ts, src/lib/priceMissingImportTransactions.ts).
 *
 * Source: GET api.exchange.coinbase.com/products/{BTC-USD|LTC-USD}/candles, public, no key. Its
 * history starts 2015-07-20 for BTC-USD and 2016-08-17 for LTC-USD; an earlier day is no price.
 * A request names only the product, the candle size and a date range, never an address or
 * anything about a user.
 *
 * The price of a day is the price at 12:00 UTC, the same convention as the CoinGecko lookups: from
 * 6-hour candles, the close of the 06:00 candle (the last trade before noon), else the open of the
 * 12:00 candle; if neither exists, the edge nearest noon of a candle that starts on that UTC day.
 * A day with no candle, a failed request or a 429 is no price (never another day's price), and a
 * failure is not cached, so a later call can still price it.
 *
 * One request covers a fixed block of 74 days (296 candles; Coinbase allows 300 per request).
 * Blocks are aligned to the epoch so a day always falls in the same block, and each block is
 * cached by product and block: in memory (10 min) and, once the block lies wholly in the past,
 * in the shared cache table (90 days, as the CoinGecko day prices). Requests are spaced 250 ms
 * apart, well under Coinbase's public limit of 10 per second per IP.
 */

import { getCache, setCache } from '@/lib/tursoCache';

/** price_source of a row priced here. */
export const COINBASE_SOURCE = 'coinbase:candles';

const BASE_URL = 'https://api.exchange.coinbase.com';
const PRODUCTS: Record<string, string> = { BTC: 'BTC-USD', LTC: 'LTC-USD' };

const DAY_MS = 86_400_000;
const CANDLE_SEC = 6 * 60 * 60;
const CANDLE_MS = CANDLE_SEC * 1000;
export const BLOCK_DAYS = 74;
const MIN_INTERVAL_MS = 250;
const TIMEOUT_MS = 10_000;
const TABLE_TTL = 90 * 24 * 60 * 60; // 90 days
const MEM_TTL_MS = 10 * 60 * 1000;   // 10 min

/** Price at 12:00 UTC per UTC day (YYYY-MM-DD) of one block; a day without candles is absent. */
type Block = { days: Record<string, number> };

const memory = new Map<string, { expiresAt: number; block: Block }>();
const inflight = new Map<string, Promise<Block | null>>();

/** The Coinbase product for a coin this fallback covers (BTC, LTC), or null. */
export function coinbaseProduct(symbol: string): string | null {
	return PRODUCTS[String(symbol ?? '').trim().toUpperCase()] ?? null;
}

// Requests go out one at a time, MIN_INTERVAL_MS apart (performance.now: a monotonic clock).
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = -Infinity;
function spaced<T>(fn: () => Promise<T>): Promise<T> {
	const run = queue.then(async () => {
		const wait = lastRequestAt + MIN_INTERVAL_MS - performance.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		lastRequestAt = performance.now();
		return fn();
	});
	queue = run.catch(() => undefined);
	return run;
}

/** The 12:00 UTC price of each day from 6-hour candles [time, low, high, open, close, volume]. Pure. */
export function noonPrices(candles: unknown): Block['days'] {
	const days: Block['days'] = {};
	if (!Array.isArray(candles)) return days;
	// Per day, the edges (time and price) of the candles that start on that day: the 18:00 candle's
	// close (at midnight) is the day's last trade, never the next day's price. Closes go first, so on
	// a tie the 06:00 candle's close wins over the 12:00 candle's open.
	const edges = new Map<string, Array<[number, number]>>();
	const add = (startMs: number, ms: number, price: unknown) => {
		const p = Number(price);
		if (!Number.isFinite(startMs) || !Number.isFinite(p) || p <= 0) return;
		const day = new Date(startMs).toISOString().slice(0, 10);
		const list = edges.get(day) ?? [];
		list.push([ms, p]);
		edges.set(day, list);
	};
	const rows = candles.filter((c): c is unknown[] => Array.isArray(c) && c.length >= 5);
	for (const c of rows) add(Number(c[0]) * 1000, Number(c[0]) * 1000 + CANDLE_MS, c[4]);
	for (const c of rows) add(Number(c[0]) * 1000, Number(c[0]) * 1000, c[3]);
	for (const [day, list] of edges) {
		const noon = Date.parse(`${day}T12:00:00Z`);
		let best: [number, number] | null = null;
		for (const e of list) if (!best || Math.abs(e[0] - noon) < Math.abs(best[0] - noon)) best = e;
		if (best) days[day] = best[1];
	}
	return days;
}

/** The first day (epoch ms, 00:00 UTC) of the block that holds a day. */
export function blockStartMs(dayStartMs: number): number {
	const index = Math.floor(dayStartMs / DAY_MS);
	return Math.floor(index / BLOCK_DAYS) * BLOCK_DAYS * DAY_MS;
}

async function fetchBlock(product: string, startMs: number): Promise<Block | null> {
	// The last candle starts at 18:00 of the block's last day; Coinbase's range is inclusive.
	const endMs = startMs + BLOCK_DAYS * DAY_MS - CANDLE_MS;
	const url = `${BASE_URL}/products/${product}/candles?granularity=${CANDLE_SEC}`
		+ `&start=${new Date(startMs).toISOString()}&end=${new Date(endMs).toISOString()}`;
	try {
		return await spaced(async () => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
			try {
				const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
				if (!res.ok) return null;
				const candles = await res.json();
				// Anything but a list (an error message) is a failure, not a block without candles.
				return Array.isArray(candles) ? { days: noonPrices(candles) } : null;
			} finally {
				clearTimeout(timer);
			}
		});
	} catch {
		return null;
	}
}

async function getBlock(product: string, startMs: number): Promise<Block | null> {
	const key = `coinbase:candles6h:${product}:${new Date(startMs).toISOString().slice(0, 10)}`;
	const mem = memory.get(key);
	if (mem && mem.expiresAt > Date.now()) return mem.block;

	const cached = await getCache<Block>(key).catch(() => null);
	if (cached?.days) {
		memory.set(key, { expiresAt: Date.now() + MEM_TTL_MS, block: cached });
		return cached;
	}

	const existing = inflight.get(key);
	if (existing) return existing;

	const promise = (async () => {
		const block = await fetchBlock(product, startMs);
		if (!block) return null;
		memory.set(key, { expiresAt: Date.now() + MEM_TTL_MS, block });
		// Only a block whose last candle has closed is final; a block reaching today stays in memory.
		if (startMs + BLOCK_DAYS * DAY_MS <= Date.now()) await setCache(key, block, TABLE_TTL).catch(() => undefined);
		return block;
	})();
	inflight.set(key, promise);
	try {
		return await promise;
	} finally {
		inflight.delete(key);
	}
}

/**
 * The coin's USD price at 12:00 UTC of a UTC day (YYYY-MM-DD) from Coinbase, or null: a coin this
 * fallback does not cover, a day without candles, or a failed request. Never throws.
 */
export async function coinbaseDayUsdPrice(symbol: string, day: string): Promise<number | null> {
	const product = coinbaseProduct(symbol);
	const dayStart = Date.parse(`${day}T00:00:00Z`);
	if (!product || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(dayStart)) return null;
	try {
		const block = await getBlock(product, blockStartMs(dayStart));
		const price = block?.days[day];
		return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
	} catch {
		return null;
	}
}
