import type { SupportedChain } from '@/lib/constants';

export interface PriceRequest {
	chain: SupportedChain;
	tokenAddress: string | null;
	symbol: string;
}

export interface PriceQuote {
	key: string;
	priceUsd: number;
}

type DefiLlamaResponse = {
	coins: Record<string, { price: number }>;
};

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<string, { priceUsd: number; expiresAt: number }>();

const CHAIN_KEY_MAP: Partial<Record<SupportedChain, string>> = {
	ethereum: 'ethereum',
	polygon: 'polygon',
	avalanche: 'avalanche',
	rootstock: 'rsk',
};

/**
 * Fetches USD prices for the requested assets using DefiLlama.
 */
export async function getPrices(assets: PriceRequest[]): Promise<Record<string, PriceQuote>> {
	if (!assets.length) return {};

	const result: Record<string, PriceQuote> = {};
	const toFetch: string[] = [];
	const requestMap = new Map<string, string>(); // llamaKey -> price key

	for (const asset of assets) {
		const key = buildPriceKey(asset);
		const cached = readCache(key);
		if (cached !== undefined) {
			result[key] = { key, priceUsd: cached };
			continue;
		}

		const llamaKey = buildLlamaKey(asset);
		if (!llamaKey) {
			result[key] = { key, priceUsd: 0 };
			continue;
		}
		requestMap.set(llamaKey, key);
	}

	toFetch.push(...new Set(requestMap.keys()));
	if (toFetch.length) {
		let fetched: Record<string, { price: number }> = {};
		try {
			fetched = await fetchDefiLlama(toFetch);
		} catch (error) {
			console.error('[prices] fetch error', error);
		}
		for (const llamaKey of toFetch) {
			const key = requestMap.get(llamaKey)!;
			const price = fetched[llamaKey]?.price ?? 0;
			result[key] = { key, priceUsd: price };
			if (price > 0) {
				// Added price to cache.
				writeCache(key, price);
			}
		}
	}

	// Ensure every asset has an entry even if cached/fetched path missed it.
	for (const asset of assets) {
		const key = buildPriceKey(asset);
		if (!result[key]) {
			result[key] = { key, priceUsd: 0 };
		}
	}

	return result;
}

function buildPriceKey(asset: PriceRequest) {
	const tokenPart = asset.tokenAddress ? asset.tokenAddress.toLowerCase() : 'native';
	return `${asset.chain}:${tokenPart}`;
}

function buildLlamaKey(asset: PriceRequest) {
	const chainKey = CHAIN_KEY_MAP[asset.chain];
	if (!chainKey) return null;
	if (asset.tokenAddress) {
		return `${chainKey}:${asset.tokenAddress.toLowerCase()}`;
	}
	return `${chainKey}:native`;
}

function readCache(key: string): number | undefined {
	const entry = cache.get(key);
	if (!entry) return undefined;
	if (entry.expiresAt < Date.now()) {
		cache.delete(key);
		return undefined;
	}
	return entry.priceUsd;
}

function writeCache(key: string, priceUsd: number) {
	cache.set(key, {
		priceUsd,
		expiresAt: Date.now() + CACHE_TTL_MS,
	});
}

async function fetchDefiLlama(keys: string[]) {
	const url = `https://coins.llama.fi/prices/current/${keys.join(',')}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Price API error ${response.status}`);
	}
	const payload = (await response.json()) as DefiLlamaResponse;
	return payload.coins ?? {};
}
