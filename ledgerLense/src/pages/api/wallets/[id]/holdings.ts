import type { APIRoute } from 'astro';
import { db } from '@/lib/db';

const ETHERSCAN_V2_BASE_URL = 'https://api.etherscan.io/v2/api';
const SNOWTRACE_BASE_URL = 'https://api.snowtrace.io/api';
const POLYGON_CHAIN_ID = 137;
const ETHEREUM_CHAIN_ID = 1;
const AVALANCHE_CHAIN_ID = 43114;
const CACHE_TTL_MS = 1_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 25;
const SCAN_DELAY_MS = 450;
const PRICE_DELAY_MS = 250;
const ETHERSCAN_MIN_INTERVAL_MS = 700;
const SNOWTRACE_MIN_INTERVAL_MS = 700;
const COINGECKO_MIN_INTERVAL_MS = 1800;
const ETHERSCAN_RATE_LIMIT_BACKOFF_MS = 1500;

const cache = new Map<string, { expiresAt: number; payload: any }>();
const basisCache = new Map<string, { expiresAt: number; price: number | null }>();
let lastEtherscanCallAt = 0;
let lastSnowtraceCallAt = 0;
let lastCoingeckoCallAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimited(payload: any) {
	const message = String(payload?.message ?? '').toLowerCase();
	const result = String(payload?.result ?? '').toLowerCase();
	return message.includes('rate limit') || result.includes('rate limit');
}

async function throttledFetch(url: string, chainId: number) {
	const now = Date.now();
	if (chainId === AVALANCHE_CHAIN_ID) {
		const waitMs = Math.max(0, lastSnowtraceCallAt + SNOWTRACE_MIN_INTERVAL_MS - now);
		if (waitMs) await sleep(waitMs);
		lastSnowtraceCallAt = Date.now();
		return fetch(url);
	}
	const waitMs = Math.max(0, lastEtherscanCallAt + ETHERSCAN_MIN_INTERVAL_MS - now);
	if (waitMs) await sleep(waitMs);
	lastEtherscanCallAt = Date.now();
	return fetch(url);
}

async function throttledCoingeckoFetch(url: string) {
	const now = Date.now();
	const waitMs = Math.max(0, lastCoingeckoCallAt + COINGECKO_MIN_INTERVAL_MS - now);
	if (waitMs) await sleep(waitMs);
	lastCoingeckoCallAt = Date.now();
	return fetch(url);
}

type TokenTx = {
	blockNumber: string;
	timeStamp: string;
	hash: string;
	from: string;
	to: string;
	value: string;
	tokenDecimal: string;
	tokenSymbol: string;
	tokenName: string;
	contractAddress: string;
};

type HoldingsToken = {
	symbol: string;
	name: string;
	contractAddress: string;
	decimals: number;
	balance: number;
	priceUsd: number;
	valueUsd: number;
	purchaseBasisUsd?: number;
	basisType: 'purchase' | 'firstTransferIn' | 'unknown';
	profitUsd?: number;
	profitPct?: number;
	basisDate?: string | null;
};

const NATIVE_META: Record<number, { symbol: string; name: string; coingeckoId: string }> = {
	[ETHEREUM_CHAIN_ID]: { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum' },
	[POLYGON_CHAIN_ID]: { symbol: 'POL', name: 'Polygon', coingeckoId: 'polygon-ecosystem-token' },
	[AVALANCHE_CHAIN_ID]: { symbol: 'AVAX', name: 'Avalanche', coingeckoId: 'avalanche-2' },
};

function buildScanUrl(chainId: number, params: Record<string, string | number>) {
	if (chainId === AVALANCHE_CHAIN_ID) {
		const apiKey = import.meta.env.SNOWTRACE_API_KEY;
		if (!apiKey) throw new Error('Missing SNOWTRACE_API_KEY');
		const query = new URLSearchParams({ apikey: apiKey });
		Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
		return `${SNOWTRACE_BASE_URL}?${query.toString()}`;
	}

	const apiKey = import.meta.env.ETHERSCAN_API_KEY;
	if (!apiKey) throw new Error('Missing ETHERSCAN_API_KEY');
	const query = new URLSearchParams({ apikey: apiKey, chainid: String(chainId) });
	Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
	return `${ETHERSCAN_V2_BASE_URL}?${query.toString()}`;
}

function normalizeAddress(address: string) {
	return address.trim().toLowerCase();
}

function isSpamToken(symbol: string, name: string, decimals: number) {
	if (!symbol || !name) return true;
	if (symbol.length > 12 || name.length > 40) return true;
	const haystack = `${symbol} ${name}`.toLowerCase();
	if (/(claim|airdrop|reward|bonus|giveaway|visit|voucher|promo|http|https|scam)/.test(haystack)) return true;
	if (decimals === 0 && /(claim|airdrop|reward|bonus)/.test(haystack)) return true;
	return false;
}

function toDecimal(value: bigint, decimals: number) {
	if (decimals <= 0) return Number(value);
	const negative = value < 0n;
	const abs = negative ? -value : value;
	const base = 10n ** BigInt(decimals);
	const whole = abs / base;
	const fraction = abs % base;
	let fracStr = fraction.toString().padStart(decimals, '0');
	fracStr = fracStr.replace(/0+$/, '');
	const numStr = fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
	const num = Number(numStr);
	if (!Number.isFinite(num)) return 0;
	return negative ? -num : num;
}

async function fetchTokenTransfers(address: string, chainId: number): Promise<TokenTx[]> {
	const results: TokenTx[] = [];
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const url = buildScanUrl(chainId, {
			module: 'account',
			action: 'tokentx',
			address,
			startblock: 0,
			endblock: 99999999,
			page,
			offset: PAGE_SIZE,
			sort: 'desc',
		});
		let response: Response | null = null;
		let payload: any = null;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			response = await throttledFetch(url, chainId);
			payload = await response.json();
			if (response.ok && !isRateLimited(payload)) break;
			if (isRateLimited(payload)) {
				await sleep(ETHERSCAN_RATE_LIMIT_BACKOFF_MS);
				continue;
			}
			break;
		}
		if (!response) {
			throw new Error('Etherscan HTTP 0');
		}
		if (!response.ok) {
			throw new Error(`Etherscan HTTP ${response.status}`);
		}
		if (payload.status === '0' && payload.message !== 'No transactions found') {
			const details = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result);
			throw new Error(`Etherscan error: ${payload.message ?? 'unknown'} | result=${details}`);
		}
		const pageResults = Array.isArray(payload.result) ? (payload.result as TokenTx[]) : [];
		if (!pageResults.length) break;
		results.push(...pageResults);
		if (pageResults.length < PAGE_SIZE) break;
		await sleep(SCAN_DELAY_MS);
	}
	return results;
}

async function fetchNativeBalance(address: string, chainId: number) {
	const url = buildScanUrl(chainId, {
		module: 'account',
		action: 'balance',
		address,
		tag: 'latest',
	});
	let response: Response | null = null;
	let payload: any = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		response = await throttledFetch(url, chainId);
		payload = await response.json();
		if (response.ok && !isRateLimited(payload)) break;
		if (isRateLimited(payload)) {
			await sleep(ETHERSCAN_RATE_LIMIT_BACKOFF_MS);
			continue;
		}
		break;
	}
	if (!response) {
		throw new Error('Native balance HTTP 0');
	}
	if (!response.ok) {
		throw new Error(`Native balance HTTP ${response.status}`);
	}
	if (payload.status === '0' && payload.message !== 'No transactions found') {
		const details = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result);
		throw new Error(`Native balance error: ${payload.message ?? 'unknown'} | result=${details}`);
	}
	return BigInt(payload.result ?? '0');
}

async function fetchCurrentPrices(
	contracts: string[],
	platform: 'polygon-pos' | 'ethereum' | 'avalanche',
) {
	const prices: Record<string, number> = {};
	const chunkSize = 40;
	for (let i = 0; i < contracts.length; i += chunkSize) {
		const batch = contracts.slice(i, i + chunkSize);
		const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${encodeURIComponent(
			batch.join(','),
		)}&vs_currencies=usd`;
		try {
			const response = await throttledCoingeckoFetch(url);
			if (!response.ok) {
				if (response.status === 429) {
					await sleep(COINGECKO_MIN_INTERVAL_MS * 2);
				}
				await sleep(PRICE_DELAY_MS);
				continue;
			}
			const payload = (await response.json()) as Record<string, { usd?: number }>;
			for (const [key, value] of Object.entries(payload)) {
				const usd = value?.usd;
				if (typeof usd === 'number') {
					prices[key.toLowerCase()] = usd;
				}
			}
		} catch {
			// Ignore pricing failures; fallback handled by caller.
		}
		await sleep(PRICE_DELAY_MS);
	}
	return prices;
}

async function fetchNativePrice(chainId: number) {
	const meta = NATIVE_META[chainId];
	if (!meta) return 0;
	const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(meta.coingeckoId)}&vs_currencies=usd`;
	try {
		const response = await throttledCoingeckoFetch(url);
		if (!response.ok) return 0;
		const payload = (await response.json()) as Record<string, { usd?: number }>;
		const raw = payload[meta.coingeckoId]?.usd;
		return typeof raw === 'number' ? raw : 0;
	} catch {
		return 0;
	}
}

async function fetchHistoricalPrice(
	contract: string,
	timestampSec: number,
	platform: 'polygon-pos' | 'ethereum' | 'avalanche',
) {
	const dayKey = new Date(timestampSec * 1000).toISOString().slice(0, 10);
	const cacheKey = `${platform}:${contract}:${dayKey}`;
	const cached = basisCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.price;

	const from = Math.max(0, timestampSec - 3600);
	const to = timestampSec + 3600;
	const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${contract}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
	let price: number | null = null;
	try {
		const response = await throttledCoingeckoFetch(url);
		if (response.ok) {
			const payload = (await response.json()) as { prices?: Array<[number, number]> };
			const points = payload.prices ?? [];
			if (points.length) {
				price = points[points.length - 1][1];
			}
		}
	} catch {
		price = null;
	}

	basisCache.set(cacheKey, { expiresAt: Date.now() + 86_400_000, price });
	return price;
}

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
	const walletId = params.id ?? '';
	const url = new URL(request.url);
	const chainId = Number(url.searchParams.get('chainid') ?? POLYGON_CHAIN_ID);
	if (!walletId) {
		return new Response(JSON.stringify({ error: 'Missing wallet id' }), { status: 400 });
	}
	if (![POLYGON_CHAIN_ID, ETHEREUM_CHAIN_ID, AVALANCHE_CHAIN_ID].includes(chainId)) {
		return new Response(
			JSON.stringify({ error: 'Only Polygon (137), Ethereum (1), and Avalanche (43114) are supported.' }),
			{ status: 400 },
		);
	}

	const cacheKey = `${walletId}:${chainId}`;
	const cached = cache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return new Response(JSON.stringify(cached.payload), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' },
		});
	}

	const walletResult = await db.execute({
		sql: 'SELECT id, address, label FROM wallets WHERE id = ? LIMIT 1',
		args: [walletId],
	});
	const wallet = walletResult.rows[0] as unknown as { id?: string; address?: string; label?: string } | undefined;
	if (!wallet?.address) {
		return new Response(JSON.stringify({ error: 'Wallet not found' }), { status: 404 });
	}

	const address = normalizeAddress(wallet.address);
	const chainLabel =
		chainId === POLYGON_CHAIN_ID ? 'Polygon' : chainId === ETHEREUM_CHAIN_ID ? 'Ethereum' : 'Avalanche';
	const pricePlatform =
		chainId === POLYGON_CHAIN_ID ? 'polygon-pos' : chainId === ETHEREUM_CHAIN_ID ? 'ethereum' : 'avalanche';
	let transfers: TokenTx[] = [];
	try {
		transfers = await fetchTokenTransfers(address, chainId);
	} catch (err: any) {
		return new Response(JSON.stringify({ error: err?.message ?? 'Failed to fetch token transfers' }), { status: 500 });
	}

	type TokenAgg = {
		symbol: string;
		name: string;
		decimals: number;
		contractAddress: string;
		balance: bigint;
		firstIn?: number;
	};

	const aggregates = new Map<string, TokenAgg>();
	for (const tx of transfers) {
		const contract = (tx.contractAddress ?? '').toLowerCase();
		if (!contract) continue;
		const symbol = (tx.tokenSymbol ?? '').trim();
		const name = (tx.tokenName ?? '').trim();
		const decimals = Number(tx.tokenDecimal ?? 0);
		if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) continue;
		if (isSpamToken(symbol, name, decimals)) continue;
		const from = normalizeAddress(tx.from ?? '');
		const to = normalizeAddress(tx.to ?? '');
		if (from === address && to === address) continue;
		let delta = 0n;
		if (to === address) {
			delta = BigInt(tx.value ?? '0');
		} else if (from === address) {
			delta = -BigInt(tx.value ?? '0');
		} else {
			continue;
		}
		const timestamp = Number(tx.timeStamp ?? 0);
		const existing = aggregates.get(contract) ?? {
			symbol,
			name,
			decimals,
			contractAddress: contract,
			balance: 0n,
		};
		existing.balance += delta;
		if (delta > 0n && timestamp) {
			existing.firstIn = existing.firstIn ? Math.min(existing.firstIn, timestamp) : timestamp;
		}
		aggregates.set(contract, existing);
	}

	const contracts = Array.from(aggregates.values())
		.filter((entry) => entry.balance > 0n)
		.map((entry) => entry.contractAddress);
	const currentPrices = await fetchCurrentPrices(contracts, pricePlatform);

	const tokens: HoldingsToken[] = [];
	let totalUsd = 0;

	const nativeMeta = NATIVE_META[chainId];
	if (nativeMeta) {
		try {
			const rawBalance = await fetchNativeBalance(address, chainId);
			const balance = toDecimal(rawBalance, 18);
			if (balance > 0) {
				const priceUsd = await fetchNativePrice(chainId);
				const valueUsd = balance * priceUsd;
				totalUsd += valueUsd;
				tokens.push({
					symbol: nativeMeta.symbol,
					name: nativeMeta.name,
					contractAddress: 'native',
					decimals: 18,
					balance,
					priceUsd,
					valueUsd,
					basisType: 'unknown',
				});
			}
		} catch {
			// Ignore native balance failures; token list still renders.
		}
	}

	for (const entry of aggregates.values()) {
		if (entry.balance <= 0n) continue;
		const balance = toDecimal(entry.balance, entry.decimals);
		if (!Number.isFinite(balance) || balance <= 0) continue;

		const priceUsd = currentPrices[entry.contractAddress] ?? 0;
		const valueUsd = balance * priceUsd;
		totalUsd += valueUsd;

		let basisType: HoldingsToken['basisType'] = 'unknown';
		let basisPrice: number | null = null;
		let basisDate: string | null = null;

		if (entry.firstIn) {
			const historical = await fetchHistoricalPrice(entry.contractAddress, entry.firstIn, pricePlatform);
			if (typeof historical === 'number' && historical > 0) {
				basisPrice = historical;
				basisType = 'firstTransferIn';
				basisDate = new Date(entry.firstIn * 1000).toISOString();
			}
		}

		const profitUsd =
			basisPrice !== null && priceUsd > 0 ? (priceUsd - basisPrice) * balance : undefined;
		const profitPct =
			basisPrice !== null && priceUsd > 0 ? ((priceUsd - basisPrice) / basisPrice) * 100 : undefined;

		tokens.push({
			symbol: entry.symbol,
			name: entry.name,
			contractAddress: entry.contractAddress,
			decimals: entry.decimals,
			balance,
			priceUsd,
			valueUsd,
			purchaseBasisUsd: basisPrice ?? undefined,
			basisType,
			profitUsd,
			profitPct,
			basisDate,
		});
	}

	const filteredTokens = tokens.filter(
		(token) => token.contractAddress === 'native' || token.valueUsd > 0,
	);
	filteredTokens.sort((a, b) => b.valueUsd - a.valueUsd);

	const payload = {
		chain: chainLabel,
		wallet: wallet.label ?? walletId,
		address: wallet.address,
		asOf: new Date().toISOString(),
		totalUsd,
		tokens: filteredTokens,
	};

	cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });

	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' },
	});
};
