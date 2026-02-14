/**
 * Simple CoinGecko helpers for UI valuations.
 * Uses public APIs and returns 4-decimal USD prices.
 */
import { sanitizeSymbols } from './sanitizeSymbols';

const COINGECKO_CACHE_TTL_MS = 60_000;
const COINGECKO_MIN_INTERVAL_MS = 10_000;
const COINGECKO_MAX_RETRIES = 3;
const COINGECKO_BASE_BACKOFF_MS = 10_000;
const COINGECKO_TIMEOUT_MS = 2_500;
const COINGECKO_API_KEY = import.meta.env.COINGECKO_API_KEY;

const coingeckoCache = new Map<string, { expiresAt: number; payload: any }>();
let lastCoingeckoCallAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isBrowser = typeof window !== 'undefined';

function isStrictSymbolCandidate(raw: string) {
	const normalized = raw.normalize('NFKC').trim().toUpperCase();
	if (!normalized) return false;
	if (/[^\x00-\x7F]/.test(normalized)) return false;
	if (!/^[A-Z0-9][A-Z0-9._-]{1,14}$/.test(normalized)) return false;
	return true;
}

async function fetchCoingeckoJson(url: string) {
	const cached = coingeckoCache.get(url);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.payload;
	}

	for (let attempt = 0; attempt < COINGECKO_MAX_RETRIES; attempt += 1) {
		const now = Date.now();
		const waitMs = Math.max(0, lastCoingeckoCallAt + COINGECKO_MIN_INTERVAL_MS - now);
		if (waitMs) await sleep(waitMs);
		lastCoingeckoCallAt = Date.now();

		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), COINGECKO_TIMEOUT_MS);
			const headers: Record<string, string> = { Accept: 'application/json' };
			if (!isBrowser) {
				headers['User-Agent'] = 'ledgerlense/1.0';
				if (COINGECKO_API_KEY) {
					headers['x-cg-pro-api-key'] = COINGECKO_API_KEY;
				}
			}
			const response = await fetch(url, { signal: controller.signal, headers });
			clearTimeout(timer);
			if (response.status === 429) {
				await sleep(COINGECKO_BASE_BACKOFF_MS * (attempt + 1));
				continue;
			}
			if (!response.ok) {
				let snippet = '';
				try {
					const body = await response.text();
					snippet = body.slice(0, 200);
				} catch {
					snippet = '';
				}
				console.warn('[coingecko] http error', { status: response.status, snippet });
				return null;
			}
			const payload = await response.json();
			coingeckoCache.set(url, { expiresAt: Date.now() + COINGECKO_CACHE_TTL_MS, payload });
			return payload;
		} catch {
			await sleep(COINGECKO_BASE_BACKOFF_MS * (attempt + 1));
		}
	}

	return null;
}
const COINGECKO_IDS: Record<string, string> = {
	BTC: 'bitcoin',
	ETH: 'ethereum',
	POL: 'polygon-ecosystem-token',
	AVAX: 'avalanche-2',
	ARB: 'arbitrum',
	WETH: 'weth',
};

export type ResolvedToken = {
	symbol: string; // uppercased symbol, e.g., "ARB"
	coingeckoId: string | null;
};

/**
 * Resolve CoinGecko IDs for tokens that are missing an id (coingeckoId === null).
 * Never throws; on error returns the original tokens unchanged.
 */
export async function resolveTokenIds(
	tokens: ResolvedToken[],
	options?: { allowSearch?: boolean },
): Promise<ResolvedToken[]> {
	if (!isBrowser || options?.allowSearch !== true) {
		return tokens;
	}
	const pending = tokens.filter((t) => !t.coingeckoId && isStrictSymbolCandidate(t.symbol));
	if (!pending.length) return tokens;

	const updated = [...tokens];

	for (const token of pending) {
		const query = token.symbol.trim();
		if (!query) continue;
		try {
			const url = isBrowser
				? `/api/market/coingecko-search?query=${encodeURIComponent(query)}`
				: `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
			const payload = isBrowser
				? ((await fetch(url).then((res) => res.json())) as { coins?: Array<{ id?: string; symbol?: string }> })
				: ((await fetchCoingeckoJson(url)) as { coins?: Array<{ id?: string; symbol?: string }> } | null);
			if (!payload) {
				console.warn('[coingecko] search failed');
				continue;
			}
			const coins = payload.coins ?? [];
			const exact = coins.find((c) => c.symbol?.toUpperCase() === token.symbol.toUpperCase());
			const first = coins[0];
			const chosen = exact ?? first;
			if (chosen?.id) {
				const idx = updated.findIndex((t) => t.symbol === token.symbol);
				if (idx >= 0) {
					updated[idx] = { ...updated[idx], coingeckoId: chosen.id };
				}
			}
		} catch (error) {
			console.warn('[coingecko] search error', error);
		}
	}

	return updated;
}

/**
 * Fetch prices keyed by CoinGecko ID. Returns a map keyed by symbol.
 */
export async function getSimpleTokenPricesById(tokens: ResolvedToken[]): Promise<Record<string, number>> {
	const ids = Array.from(new Set(tokens.map((t) => t.coingeckoId).filter((id): id is string => Boolean(id))));
	if (!ids.length) return {};

	const url = isBrowser
		? `/api/market/coingecko-prices-by-id?ids=${encodeURIComponent(ids.join(','))}`
		: `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
	console.debug('[coingecko] fetching prices by id', { count: ids.length });

	try {
		const payload = isBrowser
			? ((await fetch(url).then((res) => res.json())) as Record<string, { usd?: number }>)
			: ((await fetchCoingeckoJson(url)) as Record<string, { usd?: number }> | null);
		if (!payload) {
			console.warn('[coingecko] price fetch failed');
			return {};
		}
		const prices: Record<string, number> = {};

		for (const token of tokens) {
			if (!token.coingeckoId) continue;
			const raw = payload[token.coingeckoId]?.usd;
			if (typeof raw === 'number' && raw > 0) {
				prices[token.symbol.toUpperCase()] = Number(raw.toFixed(4));
			}
		}

		return prices;
	} catch (error) {
		console.error('[coingecko] price fetch error', error);
		return {};
	}
}

export async function searchCoingecko(query: string): Promise<{ coins: Array<{ id?: string; symbol?: string }> }> {
	const normalized = query.normalize('NFKC').trim().toUpperCase();
	if (!isStrictSymbolCandidate(normalized)) return { coins: [] };
	const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(normalized)}`;
	const payload = (await fetchCoingeckoJson(url)) as { coins?: Array<{ id?: string; symbol?: string }> } | null;
	return { coins: payload?.coins ?? [] };
}

export async function getSimplePricesById(ids: string[]): Promise<Record<string, { usd?: number }>> {
	const normalized = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
	if (!normalized.length) return {};
	const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(normalized.join(','))}&vs_currencies=usd`;
	const payload = (await fetchCoingeckoJson(url)) as Record<string, { usd?: number }> | null;
	return payload ?? {};
}

// Legacy helper (symbol keyed) kept for other parts of the app that expect it.
export async function getSimpleTokenPrices(symbols: string[]): Promise<Record<string, number>> {
	const normalized = sanitizeSymbols(symbols);
	if (!normalized.length) return {};

	const idSet = new Set<string>();
	for (const sym of normalized) {
		const id = COINGECKO_IDS[sym];
		if (id) idSet.add(id);
	}

	const ids = Array.from(idSet);
	if (!ids.length) {
		return {};
	}

	const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
	console.debug('[coingecko] fetching prices for symbols', { count: normalized.length });

	try {
		const payload = (await fetchCoingeckoJson(url)) as Record<string, { usd?: number }> | null;
		if (!payload) {
			console.warn('[coingecko] fetch failed');
			return {};
		}
		const prices: Record<string, number> = {};

		for (const sym of normalized) {
			const id = COINGECKO_IDS[sym];
			const raw = id ? payload[id]?.usd : undefined;
			const price = typeof raw === 'number' && raw > 0 ? Number(raw.toFixed(4)) : 0;
			prices[sym] = price;
		}

		console.debug('[coingecko] fetched prices', { count: Object.keys(prices).length });
		return prices;
	} catch (error) {
		console.warn('[coingecko] fetch failed', error);
		return {};
	}
}
