/**
 * Simple CoinGecko helpers for UI valuations.
 * Uses public APIs and returns 4-decimal USD prices.
 */
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
export async function resolveTokenIds(tokens: ResolvedToken[]): Promise<ResolvedToken[]> {
	const pending = tokens.filter((t) => !t.coingeckoId);
	if (!pending.length) return tokens;

	const updated = [...tokens];

	for (const token of pending) {
		const query = token.symbol.trim();
		if (!query) continue;
		const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
		try {
			const response = await fetch(url);
			if (response.status === 429) {
				console.warn('[coingecko] rate limited on search; keeping existing ids');
				break;
			}
			if (!response.ok) {
				console.warn('[coingecko] search failed', response.status, response.statusText);
				continue;
			}
			const payload = (await response.json()) as { coins?: Array<{ id?: string; symbol?: string }> };
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

	const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
	console.debug('[coingecko] fetching prices by id', ids);

	try {
		const response = await fetch(url);
		if (response.status === 429) {
			console.warn('[coingecko] rate limited on price fetch');
			return {};
		}
		if (!response.ok) {
			console.warn('[coingecko] price fetch failed', response.status, response.statusText);
			return {};
		}

		const payload = (await response.json()) as Record<string, { usd?: number }>;
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

// Legacy helper (symbol keyed) kept for other parts of the app that expect it.
export async function getSimpleTokenPrices(symbols: string[]): Promise<Record<string, number>> {
	const normalized = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)));
	if (!normalized.length) return {};

	const idSet = new Set<string>();
	for (const sym of normalized) {
		const id = COINGECKO_IDS[sym];
		if (id) idSet.add(id);
	}

	const ids = Array.from(idSet);
	if (!ids.length) {
		return Object.fromEntries(normalized.map((sym) => [sym, 0]));
	}

	const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
	console.debug('[coingecko] fetching prices for symbols', normalized);

	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`CoinGecko responded with ${response.status}`);
		}

		const payload = (await response.json()) as Record<string, { usd?: number }>;
		const prices: Record<string, number> = {};

		for (const sym of normalized) {
			const id = COINGECKO_IDS[sym];
			const raw = id ? payload[id]?.usd : undefined;
			const price = typeof raw === 'number' && raw > 0 ? Number(raw.toFixed(4)) : 0;
			prices[sym] = price;
		}

		console.debug('[coingecko] fetched prices', prices);
		return prices;
	} catch (error) {
		console.error('[coingecko] fetch failed', error);
		return Object.fromEntries(normalized.map((sym) => [sym, 0]));
	}
}
