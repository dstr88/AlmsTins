import { db } from '@/lib/db';
import { DEFAULT_ERC20_CHAINS } from '@/lib/constants';

// Cache config (seconds) -> ms.
const DEFAULT_CACHE_TTL_MS = 180_000;
const SNAPSHOT_CACHE_TTL_MS = 120_000;
const FULL_CACHE_TTL_MS = 180_000;
const DEV_LOGGING = Boolean(import.meta.env?.DEV);

type CacheEntry<T> = { expiresAt: number; value: T };
const memoryCache = new Map<string, CacheEntry<unknown>>();

const getCacheKey = (walletId: string, tenantId: string, kind: 'full' | 'snapshot') =>
	`wallet:${walletId}:${tenantId}:${kind}`;

const nowMs = () => Date.now();

const logCache = (message: string, detail?: Record<string, unknown>) => {
	if (!DEV_LOGGING) return;
	console.log(`[puller.cache] ${message}`, detail ?? {});
};

const getFromCache = <T>(key: string): T | null => {
	const entry = memoryCache.get(key);
	if (!entry) {
		logCache('miss', { key });
		return null;
	}
	if (entry.expiresAt <= nowMs()) {
		memoryCache.delete(key);
		logCache('expired', { key });
		return null;
	}
	logCache('hit', { key });
	return entry.value as T;
};

const setCache = <T>(key: string, value: T, ttlMs: number) => {
	memoryCache.set(key, { expiresAt: nowMs() + ttlMs, value });
};

/**
 * Clear cached data for a wallet.
 */
export function invalidateWalletCache(walletId: string, tenantId: string) {
	const prefix = `wallet:${walletId}:${tenantId}:`;
	for (const key of memoryCache.keys()) {
		if (key.startsWith(prefix)) memoryCache.delete(key);
	}
	logCache('invalidate', { walletId, tenantId });
}

export interface WalletMetadata {
	id: string;
	tenantId: string;
	address: string;
	label: string | null;
	chains: string[];
	isDefault: boolean;
	createdAt: string;
}

export interface AaveLatest {
	asOf: string;
	healthFactor?: number | string | null;
	totalCollateralUsd?: number | null;
	totalDebtUsd?: number | null;
	netWorthUsd?: number | null;
	positions?: unknown;
	rawResponse?: unknown;
}

export interface FullWalletData {
	metadata: WalletMetadata;
	sync: { status: string; lastSyncedAt: string | null; error?: string | null };
	snapshot: {
		asOf: string | null;
		netWorthUsd?: number;
		byChain: Array<{
			chain: string;
			tokens: Array<{
				symbol: string;
				daysHeld: number;
				amountFormatted: string;
				usdValue: number;
				profitLoss?: { percent?: number; absolute?: number } | 'N/A';
			}>;
		}>;
	};
	aave: AaveLatest | null;
	nfts: Array<{
		contractAddress: string;
		tokenId: string;
		name?: string | null;
		collection?: string | null;
		imageUrl?: string | null;
		hidden: boolean;
	}>;
	interactedDapps: Array<{ name: string; domain?: string; lastSeen: string; count: number }>;
}

type SnapshotRow = {
	chain: string;
	capturedAt: string;
	totalsUsd: number | null;
	payloadJson: string | null;
};

type RawToken = {
	chain?: string;
	symbol?: string;
	tokenSymbol?: string;
	tokenAddress?: string | null;
	amount?: number | string;
	balance?: string | number;
	usdValue?: number;
	valueUsd?: number;
	priceUsd?: number;
	decimals?: number;
	source?: string;
	firstSeen?: string;
	acquiredAt?: string;
	purchaseAt?: string;
	purchasePriceUsd?: number;
	costBasisUsd?: number;
	averageCostUsd?: number;
};

const safeParseJson = <T>(value: string | null, fallback: T): T => {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
};

const safeParseChains = (value: unknown) => {
	if (typeof value !== 'string') return [...DEFAULT_ERC20_CHAINS];
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [...DEFAULT_ERC20_CHAINS];
		return parsed.length ? parsed : [...DEFAULT_ERC20_CHAINS];
	} catch {
		return [...DEFAULT_ERC20_CHAINS];
	}
};

const formatAmount = (value: number) => {
	if (!Number.isFinite(value)) return '0';
	return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
};

const computeDaysHeld = (from: string | null) => {
	if (!from) return 0;
	const stamp = Date.parse(from);
	if (!Number.isFinite(stamp)) return 0;
	const diffMs = nowMs() - stamp;
	return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

const addressShort = (address: string) => {
	if (!address) return 'Unknown';
	const trimmed = address.toLowerCase();
	return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
};

const chainOrder = new Map(DEFAULT_ERC20_CHAINS.map((chain, index) => [chain, index]));

const sortChains = (chains: string[]) =>
	[...chains].sort((a, b) => {
		const aOrder = chainOrder.get(a) ?? 999;
		const bOrder = chainOrder.get(b) ?? 999;
		if (aOrder !== bOrder) return aOrder - bOrder;
		return a.localeCompare(b);
	});

const KNOWN_DAPPS: Record<string, { name: string; domain?: string }> = {
	'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': { name: 'Aave', domain: 'aave.com' },
	'0x794a61358d6845594f94dc1db02a252b5b4814ad': { name: 'Aave', domain: 'aave.com' },
};

const AAVE_TOKEN_ADDRESSES = new Set<string>([
	// Add known aToken / debt token addresses here as needed.
]);

const AAVE_SYMBOL_UNDERLYINGS = new Set([
	'ETH',
	'USDC',
	'USDT',
	'DAI',
	'WBTC',
	'LINK',
	'WETH',
	'POL',
	'MATIC',
	'AVAX',
]);

const isAaveToken = (token: RawToken) => {
	const source = (token.source ?? '').toLowerCase();
	if (source === 'aave') return true;
	const symbol = (token.symbol ?? token.tokenSymbol ?? '').trim().toUpperCase();
	if (!symbol) return false;
	if (symbol.includes('DEBT') || symbol.includes('ATOKEN')) return true;
	if (symbol.startsWith('A') && AAVE_SYMBOL_UNDERLYINGS.has(symbol.slice(1))) return true;
	if (symbol.startsWith('V') && AAVE_SYMBOL_UNDERLYINGS.has(symbol.slice(1))) return true;
	const address = (token.tokenAddress ?? '').toLowerCase();
	if (address && AAVE_TOKEN_ADDRESSES.has(address)) return true;
	return false;
};

/**
 * Fetch wallet metadata by id.
 */
export async function getWalletById(tenantId: string, walletId: string): Promise<WalletMetadata | null> {
	const result = await db.execute({
		sql: `SELECT id, tenant_id, address, label, chains, is_default, created_at
      FROM wallets
      WHERE id = ? AND tenant_id = ?
      LIMIT 1`,
		args: [walletId, tenantId],
	});
	const row = result.rows[0] as Record<string, any> | undefined;
	if (!row) return null;
	return {
		id: String(row.id),
		tenantId: String(row.tenant_id),
		address: String(row.address),
		label: row.label ?? null,
		chains: safeParseChains(row.chains),
		isDefault: Boolean(row.is_default),
		createdAt: String(row.created_at),
	};
}

/**
 * Fetch the latest snapshots for each chain and return grouped tokens.
 */
export async function getLatestWalletSnapshot(
	tenantId: string,
	walletId: string,
	options?: { cacheTtlMs?: number },
) {
	const cacheKey = getCacheKey(walletId, tenantId, 'snapshot');
	const cached = getFromCache<FullWalletData['snapshot']>(cacheKey);
	if (cached) return cached;

	const result = await db.execute({
		sql: `WITH latest AS (
        SELECT chain, MAX(captured_at) AS captured_at
        FROM wallet_snapshots
        WHERE tenant_id = ? AND wallet_id = ?
        GROUP BY chain
      )
      SELECT ws.chain AS chain,
             ws.captured_at AS capturedAt,
             ws.totals_usd AS totalsUsd,
             ws.payload_json AS payloadJson
      FROM wallet_snapshots ws
      JOIN latest l
        ON l.chain = ws.chain
       AND l.captured_at = ws.captured_at
      WHERE ws.tenant_id = ? AND ws.wallet_id = ?
      ORDER BY ws.chain`,
		args: [tenantId, walletId, tenantId, walletId],
	});

	const rows = result.rows as unknown as SnapshotRow[];
	const byChainMap = new Map<string, FullWalletData['snapshot']['byChain'][number]>();
	let latestAsOf: string | null = null;
	let totalUsd = 0;

	for (const row of rows) {
		const chain = String(row.chain);
		const capturedAt = row.capturedAt ? String(row.capturedAt) : null;
		if (capturedAt) {
			if (!latestAsOf || Date.parse(capturedAt) > Date.parse(latestAsOf)) {
				latestAsOf = capturedAt;
			}
		}

		const tokensRaw = safeParseJson<RawToken[]>(row.payloadJson, []);
		const tokens = tokensRaw
			.filter((token) => !isAaveToken(token))
			.map((token) => {
				const symbol = (token.symbol ?? token.tokenSymbol ?? '').toUpperCase();
				const amountRaw = token.amount ?? token.balance ?? 0;
				const amount = Number(amountRaw ?? 0);
				const priceUsd = Number(token.priceUsd ?? 0);
				const usdValue = Number(token.usdValue ?? token.valueUsd ?? amount * priceUsd ?? 0);
				const acquired =
					token.firstSeen ?? token.acquiredAt ?? token.purchaseAt ?? capturedAt ?? null;
				const daysHeld = computeDaysHeld(acquired);

				let profitLoss: { percent?: number; absolute?: number } | 'N/A' = 'N/A';
				const costPrice =
					token.purchasePriceUsd ??
					token.averageCostUsd ??
					(token.costBasisUsd ? Number(token.costBasisUsd) / Math.max(amount, 1) : undefined);
				if (Number.isFinite(costPrice) && Number.isFinite(amount) && amount > 0) {
					const costUsd = Number(costPrice) * amount;
					if (Number.isFinite(costUsd) && costUsd > 0) {
						const absolute = usdValue - costUsd;
						const percent = (absolute / costUsd) * 100;
						profitLoss = { absolute, percent };
					}
				}

				return {
					symbol,
					daysHeld,
					amountFormatted: formatAmount(amount),
					usdValue: Number.isFinite(usdValue) ? usdValue : 0,
					profitLoss,
				};
			})
			.filter((token) => token.symbol);

		tokens.sort((a, b) => b.usdValue - a.usdValue);
		byChainMap.set(chain, { chain, tokens });
		totalUsd += Number(row.totalsUsd ?? 0);
	}

	const byChain = sortChains(Array.from(byChainMap.keys())).map((chain) => byChainMap.get(chain)!);
	const snapshot = {
		asOf: latestAsOf,
		netWorthUsd: totalUsd,
		byChain,
	};

	setCache(cacheKey, snapshot, options?.cacheTtlMs ?? SNAPSHOT_CACHE_TTL_MS);
	return snapshot;
}

/**
 * Alias for legacy usage.
 */
export async function getLatestSnapshot(tenantId: string, walletId: string) {
	return getLatestWalletSnapshot(tenantId, walletId);
}

/**
 * Return visible NFTs for a wallet.
 */
export async function getWalletNfts(tenantId: string, walletId: string) {
	const result = await db.execute({
		sql: `SELECT contract_address AS contractAddress,
             token_id AS tokenId,
             name,
             symbol,
             image_url AS imageUrl,
             collection_name AS collectionName,
             floor_price_usd AS floorPriceUsd,
             acquired_at AS acquiredAt,
             hidden,
             hidden_at AS hiddenAt
      FROM nft_holdings
      WHERE tenant_id = ? AND wallet_id = ?
        AND (hidden IS NULL OR hidden = 0)
        AND hidden_at IS NULL
      ORDER BY acquired_at IS NULL, acquired_at DESC`,
		args: [tenantId, walletId],
	});
	return (result.rows as Array<Record<string, any>>).map((row) => ({
		contractAddress: String(row.contractAddress ?? ''),
		tokenId: String(row.tokenId ?? ''),
		name: row.name ?? null,
		symbol: row.symbol ?? null,
		imageUrl: row.imageUrl ?? null,
		collectionName: row.collectionName ?? null,
		floorPriceUsd: row.floorPriceUsd ?? null,
		acquiredAt: row.acquiredAt ?? null,
		hidden: Boolean(row.hidden),
	}));
}

/**
 * Return hidden NFTs for a wallet.
 */
export async function getHiddenNfts(tenantId: string, walletId: string) {
	const result = await db.execute({
		sql: `SELECT contract_address AS contractAddress,
             token_id AS tokenId,
             name,
             symbol,
             image_url AS imageUrl,
             collection_name AS collectionName,
             floor_price_usd AS floorPriceUsd,
             acquired_at AS acquiredAt,
             hidden,
             hidden_at AS hiddenAt
      FROM nft_holdings
      WHERE tenant_id = ? AND wallet_id = ?
        AND (hidden = 1 OR hidden_at IS NOT NULL)
      ORDER BY acquired_at IS NULL, acquired_at DESC`,
		args: [tenantId, walletId],
	});
	return (result.rows as Array<Record<string, any>>).map((row) => ({
		contractAddress: String(row.contractAddress ?? ''),
		tokenId: String(row.tokenId ?? ''),
		name: row.name ?? null,
		symbol: row.symbol ?? null,
		imageUrl: row.imageUrl ?? null,
		collectionName: row.collectionName ?? null,
		floorPriceUsd: row.floorPriceUsd ?? null,
		acquiredAt: row.acquiredAt ?? null,
		hidden: Boolean(row.hidden),
	}));
}

/**
 * Fetch latest Aave protocol snapshot for a wallet.
 */
export async function getLatestAaveSnapshot(tenantId: string, walletId: string): Promise<AaveLatest | null> {
	const result = await db.execute({
		sql: `SELECT as_of AS asOf,
             health_factor AS healthFactor,
             total_collateral_usd AS totalCollateralUsd,
             total_debt_usd AS totalDebtUsd,
             net_worth_usd AS netWorthUsd,
             positions_json AS positionsJson,
             raw_response AS rawResponse
      FROM protocol_positions
      WHERE tenant_id = ? AND wallet_id = ? AND protocol = 'aave'
      ORDER BY as_of DESC
      LIMIT 1`,
		args: [tenantId, walletId],
	});

	const row = result.rows[0] as Record<string, any> | undefined;
	if (!row) return null;

	return {
		asOf: String(row.asOf),
		healthFactor: row.healthFactor ?? null,
		totalCollateralUsd: row.totalCollateralUsd ?? null,
		totalDebtUsd: row.totalDebtUsd ?? null,
		netWorthUsd: row.netWorthUsd ?? null,
		positions: safeParseJson(row.positionsJson ?? null, null),
		rawResponse: safeParseJson(row.rawResponse ?? null, null),
	};
}

/**
 * Resolve top dApps / contracts interacted with for a wallet.
 */
export async function getWalletInteractions(
	tenantId: string,
	walletId: string,
	walletAddress: string,
	limit = 10,
) {
	const normalizedAddress = walletAddress.toLowerCase();
	const result = await db.execute({
		sql: `WITH interactions AS (
        SELECT LOWER(to_address) AS address, timestamp
        FROM transactions
        WHERE wallet_id = ? AND tenant_id = ? AND to_address IS NOT NULL AND LOWER(to_address) != ?
        UNION ALL
        SELECT LOWER(from_address) AS address, timestamp
        FROM transactions
        WHERE wallet_id = ? AND tenant_id = ? AND from_address IS NOT NULL AND LOWER(from_address) != ?
      )
      SELECT address, COUNT(*) AS count, MAX(timestamp) AS lastSeen
      FROM interactions
      GROUP BY address
      ORDER BY lastSeen DESC, count DESC
      LIMIT ?`,
		args: [
			walletId,
			tenantId,
			normalizedAddress,
			walletId,
			tenantId,
			normalizedAddress,
			limit,
		],
	});

	return (result.rows as Array<Record<string, any>>).map((row) => {
		const address = String(row.address ?? '').toLowerCase();
		const known = KNOWN_DAPPS[address];
		return {
			name: known?.name ?? addressShort(address),
			domain: known?.domain,
			lastSeen: String(row.lastSeen ?? ''),
			count: Number(row.count ?? 0),
		};
	});
}

/**
 * Fetch full wallet data (metadata + snapshots + protocol + NFTs + interactions).
 */
export async function getWalletWithLatestData(
	tenantId: string,
	walletId: string,
	options?: { cacheTtlMs?: number },
): Promise<FullWalletData | null> {
	const cacheKey = getCacheKey(walletId, tenantId, 'full');
	const cached = getFromCache<FullWalletData>(cacheKey);
	if (cached) return cached;

	const walletResult = await db.execute({
		sql: `SELECT id, tenant_id, address, label, chains, is_default, created_at,
             sync_status, last_synced_at, sync_error
      FROM wallets
      WHERE id = ? AND tenant_id = ?
      LIMIT 1`,
		args: [walletId, tenantId],
	});

	const walletRow = walletResult.rows[0] as Record<string, any> | undefined;
	if (!walletRow) return null;

	const metadata: WalletMetadata = {
		id: String(walletRow.id),
		tenantId: String(walletRow.tenant_id),
		address: String(walletRow.address),
		label: walletRow.label ?? null,
		chains: safeParseChains(walletRow.chains),
		isDefault: Boolean(walletRow.is_default),
		createdAt: String(walletRow.created_at),
	};

	const snapshot = await getLatestWalletSnapshot(tenantId, walletId, {
		cacheTtlMs: options?.cacheTtlMs ?? SNAPSHOT_CACHE_TTL_MS,
	});
	const [aave, nfts, interactions] = await Promise.all([
		getLatestAaveSnapshot(tenantId, walletId),
		getWalletNfts(tenantId, walletId),
		getWalletInteractions(tenantId, walletId, metadata.address, 10),
	]);

	const full: FullWalletData = {
		metadata,
		sync: {
			status: String(walletRow.sync_status ?? 'unknown'),
			lastSyncedAt: walletRow.last_synced_at ? String(walletRow.last_synced_at) : null,
			error: walletRow.sync_error ?? null,
		},
		snapshot,
		aave,
		nfts: nfts.map((nft) => ({
			contractAddress: nft.contractAddress,
			tokenId: nft.tokenId,
			name: nft.name ?? null,
			collection: nft.collectionName ?? null,
			imageUrl: nft.imageUrl ?? null,
			hidden: Boolean(nft.hidden),
		})),
		interactedDapps: interactions,
	};

	setCache(cacheKey, full, options?.cacheTtlMs ?? FULL_CACHE_TTL_MS);
	return full;
}

/**
 * Example usage:
 *
 * const wallet = await getWalletWithLatestData(tenantId, walletId);
 * if (wallet) console.log(wallet.snapshot.netWorthUsd);
 */
