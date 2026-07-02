// src/pages/api/wallets/[id]/holdings.ts
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { getTickersUSD } from '@/lib/coinpaprikaProvider';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { tryAcquireLock } from '@/lib/cacheLock';
import { getTokentxPaged, getNativeBalanceWei } from '@/lib/etherscan';
import { getTokenBalances, getTokenMetadata } from '@/lib/alchemy';
import { isSpamName } from '@/lib/tokenClassification';
import { getTokenOverrides, lookupOverride, type OverrideMaps } from '@/lib/tokenOverrides';
import { DEMO_TENANT_ID, isDemoWalletAddress, DEMO_WALLET_CONFIGS } from '@/lib/demo';

const SNOWTRACE_BASE_URL = 'https://api.snowtrace.io/api';
const POLYGON_CHAIN_ID = 137;
const ETHEREUM_CHAIN_ID = 1;
const AVALANCHE_CHAIN_ID = 43114;
const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 25;
const SCAN_DELAY_MS = 1200;
const PRICE_DELAY_MS = 1000;
const SNOWTRACE_MIN_INTERVAL_MS = 1200;
const COINGECKO_MIN_INTERVAL_MS = 1800;
const ETHERSCAN_RATE_LIMIT_BACKOFF_MS = 5_000;
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_STALE_MAX_MS = 60 * 60 * 1000;
const SNAPSHOT_LOCK_SECONDS = 20;

const HOLDINGS_DEBUG = String(import.meta.env.HOLDINGS_DEBUG ?? '').trim() === '1';

function dbg(label: string, meta: Record<string, any>) {
	if (!HOLDINGS_DEBUG) return;
	console.log(`[holdings.debug2] ${label}`, meta);
}

const cache = new Map<string, { expiresAt: number; payload: any }>();
const basisCache = new Map<string, { expiresAt: number; price: number | null }>();
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
	if (chainId !== AVALANCHE_CHAIN_ID) return fetch(url);
	const waitMs = Math.max(0, lastSnowtraceCallAt + SNOWTRACE_MIN_INTERVAL_MS - now);
	if (waitMs) await sleep(waitMs);
	lastSnowtraceCallAt = Date.now();
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

type TokenAgg = {
	symbol: string;
	name: string;
	decimals: number;
	contractAddress: string;
	balance: bigint;
	firstIn?: number;
	firstInHash?: string;
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
	firstSeenAt?: string | null;
};

type ImportTxRow = {
	tx_hash: string | null;
	timestamp_utc: string | null;
	asset_symbol: string | null;
	currency: string | null;
	amount: number | null;
	to_currency: string | null;
	to_amount: number | null;
	native_usd: number | null;
};

type DbRow = Record<string, unknown>;

// Normalize DB rows into typed shapes to avoid unsafe casts at the SQL boundary.
function toImportTxRow(row: unknown): ImportTxRow | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as DbRow;

  return {
    tx_hash: typeof r.tx_hash === 'string' ? r.tx_hash : null,
    timestamp_utc: typeof r.timestamp_utc === 'string' ? r.timestamp_utc : null,
    asset_symbol: typeof r.asset_symbol === 'string' ? r.asset_symbol : null,
    currency: typeof r.currency === 'string' ? r.currency : null,
    amount: typeof r.amount === 'number' ? r.amount : null,
    to_currency: typeof r.to_currency === 'string' ? r.to_currency : null,
    to_amount: typeof r.to_amount === 'number' ? r.to_amount : null,
    native_usd: typeof r.native_usd === 'number' ? r.native_usd : null,
  };
}

function toImportTxRows(rows: unknown): ImportTxRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ImportTxRow[] = [];
  for (const row of rows) {
    const mapped = toImportTxRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

function toWalletRow(row: unknown): { id?: string; address?: string; label?: string } | null {
	if (!row || typeof row !== 'object') return null;
	const r = row as DbRow;
	const id = typeof r.id === 'string' ? r.id : undefined;
	const address = typeof r.address === 'string' ? r.address : undefined;
	const label = typeof r.label === 'string' ? r.label : undefined;
	return { id, address, label };
}

const NATIVE_META: Record<number, { symbol: string; name: string; coingeckoId: string }> = {
	[ETHEREUM_CHAIN_ID]: { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum' },
	[POLYGON_CHAIN_ID]: { symbol: 'POL', name: 'Polygon', coingeckoId: 'polygon-ecosystem-token' },
	[AVALANCHE_CHAIN_ID]: { symbol: 'AVAX', name: 'Avalanche', coingeckoId: 'avalanche-2' },
};

const normalizeSymbol = (value: string | null | undefined) => String(value ?? '').trim().toUpperCase();

const pickImportSymbol = (row: ImportTxRow) =>
	normalizeSymbol(row.asset_symbol) || normalizeSymbol(row.to_currency) || normalizeSymbol(row.currency);

const pickImportAmount = (row: ImportTxRow, symbol: string) => {
	const target = normalizeSymbol(symbol);
	if (row.to_currency && normalizeSymbol(row.to_currency) === target && typeof row.to_amount === 'number') {
		return row.to_amount;
	}
	if (row.currency && normalizeSymbol(row.currency) === target && typeof row.amount === 'number') {
		return row.amount;
	}
	if (typeof row.to_amount === 'number') return row.to_amount;
	if (typeof row.amount === 'number') return row.amount;
	return null;
};

function buildScanUrl(chainId: number, params: Record<string, string | number>) {
	if (chainId !== AVALANCHE_CHAIN_ID) {
		throw new Error('Snowtrace URL builder only (Etherscan centralized).');
	}
	const apiKey = import.meta.env.SNOWTRACE_API_KEY;
	if (!apiKey) throw new Error('Missing SNOWTRACE_API_KEY');
	const query = new URLSearchParams({ apikey: apiKey });
	Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
	return `${SNOWTRACE_BASE_URL}?${query.toString()}`;
}

function normalizeAddress(address: string) {
	return address.trim().toLowerCase();
}

function isSpamToken(symbol: string, name: string, decimals: number) {
	if (!symbol || !name) return true;
	if (symbol.length > 12 || name.length > 40) return true;
	// Name-pattern check delegated to the single source of truth; length + zero-
	// decimal heuristics kept as they're specific to this on-chain holdings path.
	if (isSpamName(symbol, name)) return true;
	if (decimals === 0 && /(claim|airdrop|reward|bonus)/.test(`${symbol} ${name}`.toLowerCase())) return true;
	return false;
}

// Override-aware wrapper: an explicit "include" un-hides a token here (even if the
// heuristic flags it); "junk" always hides it; otherwise fall back to the heuristic.
function shouldFilterSpam(symbol: string, name: string, decimals: number, overrides: OverrideMaps): boolean {
	const ov = lookupOverride(overrides, { symbol });
	if (ov === 'include') return false;
	if (ov === 'junk') return true;
	return isSpamToken(symbol, name, decimals);
}

function isDefiToken(symbol: string, name: string) {
	const sym = normalizeSymbol(symbol);
	const lower = String(name ?? '').toLowerCase();
	if (!sym || !lower) return false;
	if (lower.includes('aave')) return true;
	if (lower.includes('compound')) return true;
	if (lower.includes('yearn')) return true;
	if (sym.startsWith('YV')) return true;
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

async function getCachedSymbolPrices(symbols: string[]) {
	if (!symbols.length) return {} as Record<string, number>;
	const symbolSet = new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean));
	if (!symbolSet.size) return {};
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

async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let index = 0;
	while (index < items.length) {
		const batch = items.slice(index, index + limit);
		const batchResults = await Promise.all(batch.map(mapper));
		results.push(...batchResults);
		index += limit;
	}
	return results;
}

async function fetchAlchemyTokenAggregates(
	chainId: number,
	chain: 'eth-mainnet' | 'polygon-mainnet',
	address: string,
	overrides: OverrideMaps,
	requestId?: string,
) {
	const balancesResult = await getTokenBalances(chain, address);

	dbg('alchemy.raw', {
		requestId,
		alchemyChain: chain,
		rawTotal: Array.isArray(balancesResult?.tokenBalances) ? balancesResult.tokenBalances.length : 0,
	});

	const rawBalances = Array.isArray(balancesResult?.tokenBalances) ? balancesResult.tokenBalances : [];

	dbg('alchemy.balances', {
		requestId,
		chain: 'alchemy',
		rawTotal: rawBalances.length,
	});

	const nonZeroBalances = rawBalances.filter((entry) => {
		try {
			return BigInt(entry.tokenBalance ?? '0') > 0n;
		} catch {
			return false;
		}
	});

	dbg('alchemy.nonZero', {
		requestId,
		alchemyChain: chain,
		nonZero: nonZeroBalances.length,
		sampleContracts: nonZeroBalances.slice(0, 10).map((x) => x.contractAddress),
	});

	const contracts = nonZeroBalances
		.map((entry) => String(entry.contractAddress ?? '').toLowerCase())
		.filter(Boolean);

	dbg('alchemy.contracts', {
		requestId,
		contracts: contracts.length,
	});

	const metadataList = await mapWithConcurrency(contracts, 5, async (contract) => {
		try {
			const metadata = await getTokenMetadata(chain, contract);
			return { contract, metadata };
		} catch (error) {
			console.warn('[holdings] Alchemy metadata failed', {
				requestId,
				chainId: ETHEREUM_CHAIN_ID,
				contract,
				error,
			});
			return { contract, metadata: { decimals: 18, name: null, symbol: null } };
		}
	});

	const metadataByContract = new Map<string, Awaited<ReturnType<typeof getTokenMetadata>>>();
	for (const entry of metadataList) {
		metadataByContract.set(entry.contract, entry.metadata);
	}

	let droppedNoContract = 0;
	let droppedBadDecimals = 0;
	let droppedSpam = 0;
	let droppedDefi = 0;
	let droppedBalanceParse = 0;
	let kept = 0;

	const sampleDrops: Record<string, string[]> = {
		badDecimals: [],
		spam: [],
		defi: [],
		balanceParse: [],
	};

	const aggregates = new Map<string, TokenAgg>();
	for (const entry of nonZeroBalances) {
		const contract = String(entry.contractAddress ?? '').toLowerCase();
		if (!contract) {
			droppedNoContract += 1;
			continue;
		}
		const metadata = metadataByContract.get(contract);
		const decimals = typeof metadata?.decimals === 'number' ? metadata.decimals : 18;
		const symbol = (metadata?.symbol ?? '').trim();
		const name = (metadata?.name ?? '').trim();
		if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) {
			droppedBadDecimals += 1;
			if (sampleDrops.badDecimals.length < 10) sampleDrops.badDecimals.push(contract);
			continue;
		}
		if (shouldFilterSpam(symbol, name, decimals, overrides)) {
			droppedSpam += 1;
			if (sampleDrops.spam.length < 10) sampleDrops.spam.push(`${symbol}:${contract}`);
			continue;
		}
		if (isDefiToken(symbol, name)) {
			droppedDefi += 1;
			if (sampleDrops.defi.length < 10) sampleDrops.defi.push(`${symbol}:${contract}`);
			continue;
		}
		let balance = 0n;
		try {
			balance = BigInt(entry.tokenBalance ?? '0');
		} catch {
			droppedBalanceParse += 1;
			if (sampleDrops.balanceParse.length < 10) sampleDrops.balanceParse.push(contract);
			continue;
		}
		if (balance <= 0n) {
			continue;
		}
		kept += 1;
		aggregates.set(contract, {
			symbol,
			name,
			decimals,
			contractAddress: contract,
			balance,
		});
	}

	dbg('alchemy.aggregate.summary', {
		requestId,
		alchemyChain: chain,
		nonZero: nonZeroBalances.length,
		kept,
		droppedNoContract,
		droppedBadDecimals,
		droppedSpam,
		droppedDefi,
		droppedBalanceParse,
		aggregates: aggregates.size,
		sampleDrops,
	});

	return aggregates;
}

async function fetchTokenTransfers(address: string, chainId: number, requestId?: string): Promise<TokenTx[]> {
	// Avalanche stays on Snowtrace (Etherscan-style but separate key/base URL)
	if (chainId === AVALANCHE_CHAIN_ID) {
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

			if (!response) throw new Error('Snowtrace HTTP 0');
			if (!response.ok) throw new Error(`Snowtrace HTTP ${response.status}`);

			if (payload?.status === '0' && payload.message !== 'No transactions found') {
				const details = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result);
				throw new Error(`Snowtrace error: ${payload.message ?? 'unknown'} | result=${details}`);
			}

			const pageResults = Array.isArray(payload?.result) ? (payload.result as TokenTx[]) : [];
			if (!pageResults.length) break;
			results.push(...pageResults);
			if (pageResults.length < PAGE_SIZE) break;
			await sleep(SCAN_DELAY_MS);
		}
		return results;
	}

	// Ethereum/Polygon: use centralized provider (paging + retries + no-tx handling inside)
	return getTokentxPaged({
		chainId,
		address,
		pageSize: PAGE_SIZE,
		maxPages: MAX_PAGES,
		requestId,
	});
}

async function fetchNativeBalance(address: string, chainId: number, requestId?: string) {
	if (chainId === AVALANCHE_CHAIN_ID) {
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
		if (payload?.status === '0' && payload.message !== 'No transactions found') {
			const details = typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result);
			throw new Error(`Native balance error: ${payload.message ?? 'unknown'} | result=${details}`);
		}
		return BigInt(payload?.result ?? '0');
	}

	// Ethereum/Polygon: centralized provider
	return getNativeBalanceWei({ chainId, address, requestId });
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

export const GET: APIRoute = async ({ params, request, locals }) => {
	const requestId = (locals as Record<string, any>)?.requestId;
	const chainId = Number(new URL(request.url).searchParams.get('chainid') ?? POLYGON_CHAIN_ID);
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const logPerf = (
		status: number,
		meta?: { cached?: boolean; stale?: boolean; count?: number; providerCallsCount?: number },
	) => {
		console.log('[perf] wallet-holdings', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status,
			...(meta ?? {}),
		});
	};

	try {

		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const walletId = params.id ?? '';

		if (!walletId) {
			logPerf(400);
			return new Response(JSON.stringify({ error: true, message: 'Wallet id is required.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		await requireWalletOwnedByTenant(walletId, tenantId);

		// Demo accounts: return mock tokens directly — no API keys, no Alchemy, no chain calls
		if (tenantId === DEMO_TENANT_ID) {
			const walletRow = await db.execute({
				sql: 'SELECT address FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
				args: [walletId, tenantId],
			});
			let demoAddress = String(walletRow.rows[0]?.address ?? '');
			// Normalize stale label addresses ("1 — billetera eth" → "1")
			if (!isDemoWalletAddress(demoAddress)) {
				const m = demoAddress.match(/^([123])/);
				if (m) demoAddress = m[1];
			}
			if (isDemoWalletAddress(demoAddress)) {
				const config = DEMO_WALLET_CONFIGS[demoAddress]!;
				const CHAIN_ID_MAP: Record<string, number> = {
					ethereum: ETHEREUM_CHAIN_ID,
					polygon: POLYGON_CHAIN_ID,
					avalanche: AVALANCHE_CHAIN_ID,
				};
				const primaryChainId = CHAIN_ID_MAP[config.chain] ?? ETHEREUM_CHAIN_ID;
				const tokens = chainId === primaryChainId
					? config.tokens.map((t) => ({
						symbol: t.symbol,
						name: t.symbol,
						contractAddress: t.tokenAddress ?? 'native',
						decimals: 18,
						balance: t.amount,
						priceUsd: t.priceUsd,
						valueUsd: t.valueUsd,
						basisType: 'unknown' as const,
						firstSeenAt: null,
					}))
					: [];
				const totalUsd = tokens.reduce((s, t) => s + t.valueUsd, 0);
				const payload = { tokens, totalUsd, asOf: new Date().toISOString(), cached: false, stale: false };
				logPerf(200, { cached: false, stale: false, count: tokens.length });
				return new Response(JSON.stringify(payload), {
					status: 200,
					headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
				});
			}
		}

		if (![POLYGON_CHAIN_ID, ETHEREUM_CHAIN_ID, AVALANCHE_CHAIN_ID].includes(chainId)) {
			logPerf(400);
			return new Response(
				JSON.stringify({ error: 'Only Polygon (137), Ethereum (1), and Avalanche (43114) are supported.' }),
				{ status: 400 },
			);
		}

		const cacheKey = `${tenantId}:${walletId}:${chainId}`;
		const lockKey = `holdings:${tenantId}:${walletId}:${chainId}`;

		const cached = cache.get(cacheKey);
		if (cached && cached.expiresAt > Date.now()) {
			logPerf(200, {
				cached: true,
				stale: false,
				count: Array.isArray(cached.payload?.tokens) ? cached.payload.tokens.length : undefined,
			});
			return new Response(
				JSON.stringify({ ...cached.payload, cached: true, stale: false, asOf: cached.payload?.asOf }),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
				},
			);
		}

		const snapshotResult = await db.execute({
			sql: `SELECT payload_json, as_of, updated_at
				FROM wallet_holdings_snapshot
				WHERE tenant_id = ? AND wallet_id = ? AND chain_id = ?
				LIMIT 1`,
			args: [tenantId, walletId, chainId],
		});

		const snapshotRow = snapshotResult.rows?.[0] as
			| { payload_json?: string; as_of?: string; updated_at?: string }
			| undefined;

		if (snapshotRow?.payload_json) {
			let snapshotPayload: any = null;
			try {
				snapshotPayload = JSON.parse(String(snapshotRow.payload_json));
			} catch {
				snapshotPayload = null;
			}

			if (snapshotPayload) {
				const updatedAtMs = snapshotRow.updated_at ? Date.parse(snapshotRow.updated_at) : 0;
				const now = Date.now();
				const stale = Number.isFinite(updatedAtMs) ? now - updatedAtMs > SNAPSHOT_TTL_MS : true;
				const overStaleMax = Number.isFinite(updatedAtMs) ? now - updatedAtMs > SNAPSHOT_STALE_MAX_MS : false;

				if (stale && !overStaleMax) {
					(async () => {
						const gotLock = await tryAcquireLock(lockKey, SNAPSHOT_LOCK_SECONDS);
						if (!gotLock) {
							console.log('[cache] holdings refresh skip (lock-busy)', { requestId, walletId, chainId });
							return;
						}
						try {
							const refreshed = await buildHoldingsPayload(tenantId, walletId, chainId, requestId);
							await upsertHoldingsSnapshot(tenantId, walletId, chainId, refreshed);
							cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload: refreshed });
							console.log('[cache] holdings refreshed', { requestId, walletId, chainId });
						} catch (error) {
							console.warn('[cache] holdings refresh failed', { requestId, walletId, chainId, error });
						}
					})();
				}

				logPerf(200, {
					cached: true,
					stale,
					count: Array.isArray(snapshotPayload?.tokens) ? snapshotPayload.tokens.length : undefined,
				});

				return new Response(
					JSON.stringify({
						...snapshotPayload,
						cached: true,
						stale,
						asOf: snapshotRow.as_of ?? snapshotPayload.asOf,
					}),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
					},
				);
			}
		}

		const payload = await buildHoldingsPayload(tenantId, walletId, chainId, requestId);
		await upsertHoldingsSnapshot(tenantId, walletId, chainId, payload);

		cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
		logPerf(200, { cached: false, stale: false, count: payload.tokens.length });

		return new Response(JSON.stringify({ ...payload, cached: false, stale: false, asOf: payload.asOf }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1' },
		});
	} catch (err) {
		if (err instanceof Response) return err;
		const message = String((err as any)?.message ?? err);
		if (message === 'Wallet not found') {
			logPerf(404);
			return new Response(JSON.stringify({ error: true, message: 'Wallet not found.' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		console.error('[holdings] FATAL', {
			requestId,
			walletId: params.id,
			chainId,
			error: message,
			stack: (err as any)?.stack,
		});
		return new Response(
			JSON.stringify({
				error: 'Holdings failed',
				requestId,
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } },
		);
	}
};

async function upsertHoldingsSnapshot(tenantId: string, walletId: string, chainId: number, payload: any) {
	const nowIso = new Date().toISOString();
	const asOf = payload?.asOf ?? nowIso;
	await db.execute({
		sql: `INSERT INTO wallet_holdings_snapshot (tenant_id, wallet_id, chain_id, payload_json, as_of, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(tenant_id, wallet_id, chain_id) DO UPDATE SET
				payload_json = excluded.payload_json,
				as_of = excluded.as_of,
				updated_at = excluded.updated_at`,
		args: [tenantId, walletId, chainId, JSON.stringify(payload), asOf, nowIso],
	});
}

async function buildHoldingsPayload(
	tenantId: string,
	walletId: string,
	chainId: number,
	requestId?: string,
) {
	const walletResult = await db.execute({
		sql: 'SELECT id, address, label FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [walletId, tenantId],
	});
	const wallet = toWalletRow(walletResult.rows[0]) ?? undefined;

	if (!wallet?.address) throw new Error('Wallet not found');

	const overrides = await getTokenOverrides(tenantId); // override-aware spam filter
	const address = normalizeAddress(wallet.address);
	const chainLabel =
		chainId === POLYGON_CHAIN_ID ? 'Polygon' : chainId === ETHEREUM_CHAIN_ID ? 'Ethereum' : 'Avalanche';
	const pricePlatform =
		chainId === POLYGON_CHAIN_ID ? 'polygon-pos' : chainId === ETHEREUM_CHAIN_ID ? 'ethereum' : 'avalanche';

	const aggregates = new Map<string, TokenAgg>();
	if (chainId === ETHEREUM_CHAIN_ID || chainId === POLYGON_CHAIN_ID) {
		const alchemyChain = chainId === ETHEREUM_CHAIN_ID ? 'eth-mainnet' : 'polygon-mainnet';
		try {
			const alchemyAggregates = await fetchAlchemyTokenAggregates(
				chainId,
				alchemyChain,
				address,
				overrides,
				requestId,
			);
			alchemyAggregates.forEach((value, key) => aggregates.set(key, value));
			if (chainId === ETHEREUM_CHAIN_ID) {
				dbg('alchemy.used', {
					requestId,
					chainId,
					alchemyChain: 'eth-mainnet',
					alchemyTokenCount: aggregates.size,
				});
			}
			if (chainId === POLYGON_CHAIN_ID) {
				dbg('alchemy.used', {
					requestId,
					chainId,
					alchemyChain: 'polygon-mainnet',
					alchemyTokenCount: aggregates.size,
				});
			}
		} catch (error) {
			console.warn('[holdings] Alchemy token balances failed', {
				requestId,
				chainId,
				alchemyChain,
				error,
			});
		}
	} else {
		let transfers: TokenTx[] = [];
		try {
			transfers = await fetchTokenTransfers(address, chainId, requestId);
		} catch (err: any) {
			throw new Error(err?.message ?? 'Failed to fetch token transfers');
		}

		dbg('tokentx.count', { requestId, chainId, tokentxCount: transfers.length });

		for (const tx of transfers) {
			const contract = (tx.contractAddress ?? '').toLowerCase();
			if (!contract) continue;

			const symbol = (tx.tokenSymbol ?? '').trim();
			const name = (tx.tokenName ?? '').trim();
			const decimals = Number(tx.tokenDecimal ?? 0);

			if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) continue;
			if (shouldFilterSpam(symbol, name, decimals, overrides)) continue;
			if (isDefiToken(symbol, name)) continue;

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
				if (!existing.firstIn || timestamp < existing.firstIn) {
					existing.firstIn = timestamp;
					existing.firstInHash = tx.hash;
				}
			}

			aggregates.set(contract, existing);
		}
	}

	dbg('aggregates.uniqueContracts', { requestId, chainId, uniqueContracts: aggregates.size });

	const contracts = Array.from(aggregates.values())
		.filter((entry) => entry.balance > 0n)
		.map((entry) => entry.contractAddress);

	const currentPrices = await fetchCurrentPrices(contracts, pricePlatform);
	const cachedPrices = await getCachedSymbolPrices([
		...new Set(Array.from(aggregates.values()).map((entry) => entry.symbol)),
	]);

	const tokens: HoldingsToken[] = [];
	let totalUsd = 0;

	const importTxByHash = new Map<string, ImportTxRow>();
	const firstInHashes = Array.from(aggregates.values())
		.map((entry) => entry.firstInHash)
		.filter((hash): hash is string => typeof hash === 'string' && hash.trim().length > 0);

	if (firstInHashes.length) {
		const placeholders = firstInHashes.map(() => '?').join(',');
		try {
			const importResult = await db.execute({
				sql: `SELECT tx_hash, timestamp_utc, asset_symbol, currency, amount, to_currency, to_amount, native_usd
					FROM import_transactions
					WHERE tenant_id = ? AND tx_hash IN (${placeholders}) AND native_usd IS NOT NULL`,
				args: [tenantId, ...firstInHashes],
			});
			for (const row of toImportTxRows(importResult.rows)) {
				if (row.tx_hash) importTxByHash.set(row.tx_hash, row);
			}
		} catch {
			// ignore
		}
	}

	const nativeMeta = NATIVE_META[chainId];
	if (nativeMeta) {
		try {
			const rawBalance = await fetchNativeBalance(address, chainId, requestId);
			const balance = toDecimal(rawBalance, 18);
			if (balance > 0) {
				const priceUsd = await fetchNativePrice(chainId);
				const cachedNative = cachedPrices[nativeMeta.symbol.toUpperCase()];
				const finalPriceUsd = priceUsd > 0 ? priceUsd : cachedNative ?? 0;
				const valueUsd = balance * finalPriceUsd;
				totalUsd += valueUsd;
				tokens.push({
					symbol: nativeMeta.symbol,
					name: nativeMeta.name,
					contractAddress: 'native',
					decimals: 18,
					balance,
					priceUsd: finalPriceUsd,
					valueUsd,
					basisType: 'unknown',
					firstSeenAt: null,
				});
			}
		} catch {
			// ignore
		}
	}

	let loopTotal = 0;
	let droppedNonFiniteOrZero = 0;
	let droppedDustNoPrice = 0;
	let keptTokens = 0;

	const sampleDust: string[] = [];
	const sampleZero: string[] = [];

	for (const entry of aggregates.values()) {
		loopTotal += 1;
		if (entry.balance <= 0n) continue;

		const balance = toDecimal(entry.balance, entry.decimals);
		if (!Number.isFinite(balance) || balance <= 0) {
			droppedNonFiniteOrZero += 1;
			if (sampleZero.length < 10) sampleZero.push(`${entry.symbol}:${entry.contractAddress}`);
			continue;
		}

		const cached = cachedPrices[entry.symbol.toUpperCase()];
		const priceUsd = currentPrices[entry.contractAddress] ?? cached ?? 0;
		const valueUsd = balance * priceUsd;
		totalUsd += valueUsd;

		if (balance <= 0 || (!priceUsd && balance < 1e-12)) {
			droppedDustNoPrice += 1;
			if (sampleDust.length < 10) sampleDust.push(`${entry.symbol}:${entry.contractAddress} bal=${balance}`);
			continue;
		}

		keptTokens += 1;

		let basisType: HoldingsToken['basisType'] = 'unknown';
		let basisPrice: number | null = null;
		let basisDate: string | null = null;
		let firstSeenAt: string | null = null;

		const entrySymbol = normalizeSymbol(entry.symbol);

		if (entry.firstIn) {
			firstSeenAt = new Date(entry.firstIn * 1000).toISOString();
			const importMatch = entry.firstInHash ? importTxByHash.get(entry.firstInHash) : undefined;

			if (importMatch) {
				const importSymbol = pickImportSymbol(importMatch);
				const importAmount = pickImportAmount(importMatch, entrySymbol);
				const importUsd = typeof importMatch.native_usd === 'number' ? Math.abs(importMatch.native_usd) : null;

				if (importSymbol && importSymbol === entrySymbol && importUsd && importAmount) {
					const computed = importUsd / Math.abs(importAmount);
					if (Number.isFinite(computed) && computed > 0) {
						basisPrice = computed;
						basisType = 'purchase';
						basisDate = importMatch.timestamp_utc ?? firstSeenAt;
					}
				}
			}

			if (basisPrice === null) {
				try {
					const nearestResult = await db.execute({
						sql: `SELECT tx_hash, timestamp_utc, asset_symbol, currency, amount, to_currency, to_amount, native_usd
							FROM import_transactions
							WHERE tenant_id = ? AND native_usd IS NOT NULL
								AND (upper(asset_symbol) = ? OR upper(to_currency) = ? OR upper(currency) = ?)
							ORDER BY ABS(julianday(timestamp_utc) - julianday(?)) ASC
							LIMIT 1`,
						args: [tenantId, entrySymbol, entrySymbol, entrySymbol, firstSeenAt],
					});
					const nearest = toImportTxRow(nearestResult.rows?.[0]) ?? null;
					if (nearest) {
						const importAmount = pickImportAmount(nearest, entrySymbol);
						const importUsd = typeof nearest.native_usd === 'number' ? Math.abs(nearest.native_usd) : null;
						if (importAmount && importUsd) {
							const computed = importUsd / Math.abs(importAmount);
							if (Number.isFinite(computed) && computed > 0) {
								basisPrice = computed;
								basisType = 'purchase';
								basisDate = nearest.timestamp_utc ?? firstSeenAt;
							}
						}
					}
				} catch {
					// ignore
				}
			}

			if (basisPrice === null) {
				const historical = await fetchHistoricalPrice(entry.contractAddress, entry.firstIn, pricePlatform);
				if (typeof historical === 'number' && historical > 0) {
					basisPrice = historical;
					basisType = 'firstTransferIn';
					basisDate = firstSeenAt;
				}
			}
		}

		const profitUsd = basisPrice !== null && priceUsd > 0 ? (priceUsd - basisPrice) * balance : undefined;
		const profitPct = basisPrice !== null && priceUsd > 0 ? ((priceUsd - basisPrice) / basisPrice) * 100 : undefined;

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
			firstSeenAt,
		});
	}

	// ✅ Fix: don't hide tokens just because price is missing.
	const filteredTokens = tokens.filter((token) => token.contractAddress === 'native' || token.balance > 0);

	dbg('final.filter.summary', {
		requestId,
		chainId,
		keptTokens,
		loopTotal,
		droppedNonFiniteOrZero,
		droppedDustNoPrice,
		sampleZero,
		sampleDust,
	});

	filteredTokens.sort((a, b) => b.valueUsd - a.valueUsd);

	return {
		chain: chainLabel,
		wallet: wallet.label ?? walletId,
		address: wallet.address,
		asOf: new Date().toISOString(),
		totalUsd,
		tokens: filteredTokens,
	};
}
