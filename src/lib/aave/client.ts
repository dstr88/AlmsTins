// src/lib/aave/client.ts

import { AaveV3Avalanche, AaveV3Ethereum, AaveV3Polygon } from '@bgd-labs/aave-address-book';

// ── Aave v3 ───────────────────────────────────────────────────────────────────
const AAVE_V3_GRAPHQL_ENDPOINT = 'https://api.v3.aave.com/graphql';

// Keep the old name as an alias so nothing else in the file breaks
const AAVE_GRAPHQL_ENDPOINT = AAVE_V3_GRAPHQL_ENDPOINT;

// Pool addresses sourced from @bgd-labs/aave-address-book — always up to date.
// No more hardcoded addresses to manually track.
const ETHEREUM_MARKET_ADDRESS = AaveV3Ethereum.POOL;
// Ethereum runs 4 separate Aave V3 markets. The API's market-discovery query is
// broken (it needs a `chainIds` arg it doesn't send), so we query all known ETH
// markets explicitly. Without this, positions in EtherFi/Lido/Horizon (e.g. wstETH
// supplied to the Lido market) are silently missed while Core-only wallets look fine.
const ETHEREUM_MARKET_ADDRESSES: string[] = [
	AaveV3Ethereum.POOL,                            // Core (proto_mainnet_v3)
	'0x0AA97c284e98396202b6A04024F5E2c65026F3c0',   // EtherFi (proto_etherfi_v3)
	'0x4e033931ad43597d96D6bcc25c280717730B58B1',   // Lido (proto_lido_v3)
	'0xAe05Cd22df81871bc7cC2a04BeCfb516bFe332C8',   // Horizon (proto_horizon_v3)
];
const ETHEREUM_CHAIN_ID = 1;
const POLYGON_MARKET_ADDRESS = AaveV3Polygon.POOL;
const POLYGON_CHAIN_ID = 137;
const AVALANCHE_MARKET_ADDRESS = AaveV3Avalanche.POOL;
const AVALANCHE_CHAIN_ID = 43114;

// ── Aave v4 ───────────────────────────────────────────────────────────────────
// AaveV4Ethereum is not yet in @bgd-labs/aave-address-book — v4 has not been
// deployed to mainnet with a stable address as of the current package version.
// Once it appears in the address book, replace the env var with:
//   import { AaveV4Ethereum } from '@bgd-labs/aave-address-book';
//   const ETHEREUM_V4_MARKET_ADDRESS = AaveV4Ethereum.POOL;
//
// Until then, set AAVE_V4_ETHEREUM_MARKET in Render env vars and it will
// automatically activate. Track address book releases at:
//   https://github.com/bgd-labs/aave-address-book/releases
const ETHEREUM_V4_MARKET_ADDRESS: string | null =
	process.env.AAVE_V4_ETHEREUM_MARKET ?? null;

// Aave v4 may ship its own GraphQL endpoint. Falls back to v3 until then.
const AAVE_V4_GRAPHQL_ENDPOINT: string =
	process.env.AAVE_V4_GRAPHQL_ENDPOINT ?? AAVE_V3_GRAPHQL_ENDPOINT;

// --- Public types your API/UI can rely on ---

export type AaveSide = 'supply' | 'borrow';

export type AavePosition = {
	side: AaveSide;
	marketName: string;
	assetSymbol: string;
	amount: number;   // raw token amount
	apy: number;      // decimal, e.g. 0.05 = 5%
	usdValue: number; // computed by getAaveTotalsForWallet (0 until priced)
};

export type AaveChainSummary = {
	chain: 'ethereum' | 'polygon' | 'avalanche' | 'ethereum_v4';
	suppliedUsd: number;
	debtUsd: number;
	suppliedUsdTotal: number;
	debtUsdTotal: number;
	positions: AavePosition[];
	ok: boolean;
	market?: string | null;
	status?: string;
	message?: string;
	reason?: string;
	warning?: string;
	error?: string;
};

export type AavePositionsResponse = {
	ok: boolean;
	address: string;
	chains: AaveChainSummary[];
	error?: string;
};

// --- GraphQL query we already proved works in the playground ---

function buildUserPositionsQuery(marketAddress: string, chainId: number) {
	// NOTE: This matches the query that returned WBTC, USDC, WETH, WPOL supplies and USDC/USDT0 borrows.
	return /* GraphQL */ `
  query UserPositions($user: EvmAddress!) {
    userSupplies(
      request: {
        markets: [
          {
            address: "${marketAddress}"
            chainId: ${chainId}
          }
        ]
        user: $user
        collateralsOnly: false
        orderBy: { name: ASC }
      }
    ) {
      market { name }
      currency { symbol }
      balance { amount { value } }
      apy { value }
    }

    userBorrows(
      request: {
        markets: [
          {
            address: "${marketAddress}"
            chainId: ${chainId}
          }
        ]
        user: $user
        orderBy: { name: ASC }
      }
    ) {
      market { name }
      currency { symbol }
      debt { amount { value } }
      apy { value }
    }
  }
`;
}

const MARKETS_QUERY = /* GraphQL */ `
	query Markets {
		markets {
			address
			chain {
				chainId
			}
		}
	}
`;

type MarketResult = { address?: string; chain?: { chainId?: number } };

let marketsCache: { expiresAt: number; items: MarketResult[] } | null = null;
const MARKETS_CACHE_TTL_MS = 10 * 60 * 1000;

async function fetchMarkets(): Promise<MarketResult[]> {
	const now = Date.now();
	if (marketsCache && marketsCache.expiresAt > now) {
		return marketsCache.items;
	}
	const response = await fetch(AAVE_GRAPHQL_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query: MARKETS_QUERY }),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => '');
		console.warn('[AAVE markets] HTTP error', response.status, text);
		return [];
	}
	const payload = await response.json();
	const items = Array.isArray(payload?.data?.markets) ? (payload.data.markets as MarketResult[]) : [];
	marketsCache = { expiresAt: now + MARKETS_CACHE_TTL_MS, items };
	return items;
}

async function resolveMarketAddress(
	chainId: number,
	options?: { fallback?: string; warning?: string },
): Promise<{ address: string | null; warning?: string }> {
	try {
		const markets = await fetchMarkets();
		const found = markets.find((market) => Number(market?.chain?.chainId) === chainId);
		const address = found?.address ? String(found.address) : null;
		if (address) {
			console.log('[aave] market-resolved', { chainId, market: address });
			return { address };
		}
	} catch (error) {
		console.warn('[aave] market lookup failed', { chainId, error });
	}

	console.log('[aave] market-missing', { chainId, reason: 'MARKET_NOT_FOUND' });
	if (options?.fallback) {
		console.log('[aave] market-resolved', { chainId, market: options.fallback });
		return { address: options.fallback };
	}
	return { address: null, warning: options?.warning };
}

// --- Helper: safe numeric conversion ---

function toNumber(value: unknown): number {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : 0;
	}
	if (typeof value === 'string') {
		const n = Number(value);
		return Number.isFinite(n) ? n : 0;
	}
	return 0;
}

// --- Core: fetch polygon user positions from Aave v3 ---

async function fetchUserPositionsForMarket(
	userAddress: string,
	marketAddress: string,
	chainId: number,
	chain: AaveChainSummary['chain'],
	apiEndpoint: string = AAVE_V3_GRAPHQL_ENDPOINT,
): Promise<AaveChainSummary> {
	const user = userAddress.toLowerCase();

	try {
		const response = await fetch(apiEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: buildUserPositionsQuery(marketAddress, chainId),
				variables: { user },
			}),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			console.error(`[AAVE ${chain}] HTTP error`, response.status, text);
			return {
				chain,
				suppliedUsd: 0,
				debtUsd: 0,
				suppliedUsdTotal: 0,
				debtUsdTotal: 0,
				positions: [],
				ok: false,
				error: `HTTP ${response.status}`,
			};
		}

		const json = await response.json();
		console.log(`[AAVE ${chain} raw]`, JSON.stringify(json));

		if (json.errors && json.errors.length) {
			console.error(`[AAVE ${chain}] GraphQL errors`, json.errors);
			return {
				chain,
				suppliedUsd: 0,
				debtUsd: 0,
				suppliedUsdTotal: 0,
				debtUsdTotal: 0,
				positions: [],
				ok: false,
				error: json.errors[0]?.message ?? 'GraphQL error',
			};
		}

		const data = json.data ?? {};
		const rawSupplies = (data.userSupplies ?? []) as any[];
		const rawBorrows = (data.userBorrows ?? []) as any[];

		const positions: AavePosition[] = [];

		// Supplies
		for (const s of rawSupplies) {
			const marketName = s.market?.name ?? 'Unknown';
			const symbol = s.currency?.symbol ?? 'UNKNOWN';
			const amount = toNumber(s.balance?.amount?.value);
			const apy = toNumber(s.apy?.value);

			positions.push({
				side: 'supply',
				marketName,
				assetSymbol: symbol,
				amount: Number.isFinite(amount) ? amount : 0,
				apy: Number.isFinite(apy) ? apy : 0,
				usdValue: 0, // priced in getAaveTotalsForWallet
			});
		}

		// Borrows
		for (const b of rawBorrows) {
			const marketName = b.market?.name ?? 'Unknown';
			const symbol = b.currency?.symbol ?? 'UNKNOWN';
			const amount = toNumber(b.debt?.amount?.value);
			const apy = toNumber(b.apy?.value);

			positions.push({
				side: 'borrow',
				marketName,
				assetSymbol: symbol,
				amount: Number.isFinite(amount) ? amount : 0,
				apy: Number.isFinite(apy) ? apy : 0,
				usdValue: 0, // priced in getAaveTotalsForWallet
			});
		}

		// Right now we are *not* computing USD from Aave; keep USD fields at 0.
		return {
			chain,
			suppliedUsd: 0,
			debtUsd: 0,
			suppliedUsdTotal: 0,
			debtUsdTotal: 0,
			positions,
			ok: true,
			market: marketAddress,
		};
	} catch (err: any) {
		console.error(`[AAVE ${chain}] fetch failed`, err);
		return {
			chain,
			suppliedUsd: 0,
			debtUsd: 0,
			suppliedUsdTotal: 0,
			debtUsdTotal: 0,
			positions: [],
			ok: false,
			market: marketAddress,
			error: err?.message ?? 'Unknown error',
		};
	}
}

function buildMissingMarketSummary(
	chain: AaveChainSummary['chain'],
	warning: string,
): AaveChainSummary {
	return {
		chain,
		suppliedUsd: 0,
		debtUsd: 0,
		suppliedUsdTotal: 0,
		debtUsdTotal: 0,
		positions: [],
		ok: true,
		market: null,
		status: 'UNAVAILABLE',
		message: warning,
		reason: 'MARKET_NOT_FOUND',
		warning,
	};
}

// --- Public function used by /api/aave/positions ---

const EVM_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

// Merge several per-market summaries for the same chain into one chain summary
// (used to combine Ethereum's Core/EtherFi/Lido/Horizon markets).
function mergeChainSummaries(
	chain: AaveChainSummary['chain'],
	summaries: AaveChainSummary[],
): AaveChainSummary {
	return {
		chain,
		positions: summaries.flatMap((s) => s.positions),
		suppliedUsd: 0,
		debtUsd: 0,
		suppliedUsdTotal: 0,
		debtUsdTotal: 0,
		ok: summaries.some((s) => s.ok),
		error: summaries.every((s) => s.ok) ? undefined : summaries.find((s) => s.error)?.error,
	};
}

export async function getAavePositionsForWallet(address: string): Promise<AavePositionsResponse> {
	if (!EVM_ADDRESS_RE.test(address)) {
		return { chains: [], ok: true };
	}

	const normalized = address.toLowerCase();

	try {
		const polygonMarket = await resolveMarketAddress(POLYGON_CHAIN_ID, {
			fallback: POLYGON_MARKET_ADDRESS,
		});
		const avalancheMarket = await resolveMarketAddress(AVALANCHE_CHAIN_ID, {
			fallback: AVALANCHE_MARKET_ADDRESS,
		});

		// Query ALL known Ethereum Aave markets (Core/EtherFi/Lido/Horizon) and merge,
		// so a position in a non-Core market (e.g. wstETH supplied to Lido) is not missed.
		const ethereumSummaries = await Promise.all(
			ETHEREUM_MARKET_ADDRESSES.map((mkt) =>
				fetchUserPositionsForMarket(normalized, mkt, ETHEREUM_CHAIN_ID, 'ethereum'),
			),
		);
		const ethereum = mergeChainSummaries('ethereum', ethereumSummaries);
		const polygon = polygonMarket.address
			? await fetchUserPositionsForMarket(
					normalized,
					polygonMarket.address,
					POLYGON_CHAIN_ID,
					'polygon',
				)
			: buildMissingMarketSummary('polygon', 'Polygon market not available');
		const avalanche = avalancheMarket.address
			? await fetchUserPositionsForMarket(
					normalized,
					avalancheMarket.address,
					AVALANCHE_CHAIN_ID,
					'avalanche',
				)
			: buildMissingMarketSummary('avalanche', 'Avalanche market not available');

		// ── Aave v4 (Ethereum mainnet) ─────────────────────────────────────────
		// Only queried when AAVE_V4_ETHEREUM_MARKET is set in env.
		// v4 uses the same chain ID (1) as v3 but a different pool contract.
		let ethereumV4: AaveChainSummary;
		if (ETHEREUM_V4_MARKET_ADDRESS) {
			ethereumV4 = await fetchUserPositionsForMarket(
				normalized,
				ETHEREUM_V4_MARKET_ADDRESS,
				ETHEREUM_CHAIN_ID,
				'ethereum_v4',
				AAVE_V4_GRAPHQL_ENDPOINT,
			);
		} else {
			console.warn(
				'[aave] ethereum_v4 skipped — AAVE_V4_ETHEREUM_MARKET env var is not set. ' +
				'Find the pool address at https://docs.aave.com/developers/deployed-contracts/deployed-contracts ' +
				'then add it to your Render environment variables.',
			);
			ethereumV4 = buildMissingMarketSummary(
				'ethereum_v4',
				'Aave v4 market not configured — set AAVE_V4_ETHEREUM_MARKET in env.',
			);
		}

		return {
			ok: true,
			address: normalized,
			chains: [ethereum, polygon, avalanche, ethereumV4],
		};
	} catch (err: any) {
		console.error('[AAVE] getAavePositionsForWallet failed', err);
		return {
			ok: false,
			address: normalized,
			chains: [],
			error: err?.message ?? 'Unknown error',
		};
	}
}

// Optional: keep this if something else imports it.
// For now, we don’t have price data from Aave, so totals stay 0.
export async function getAaveTotalsForWallet(address: string) {
	const { getTickersUSD } = await import('@/lib/coinpaprikaProvider');
	const { allowlistSymbols } = await import('@/lib/prices/sanitizeSymbols');

	const result = await getAavePositionsForWallet(address);
	const allPositions = result.chains.flatMap((chain) => chain.positions);

	const NORMALIZE_MAP: Record<string, string> = {
		WETH: 'ETH',
		WBTC: 'WBTC',
		WPOL: 'POL',
		WMATIC: 'POL',
		WAVAX: 'AVAX',
	};
	const STABLES = new Set(['USDC', 'USDT', 'USDT0', 'USDC.E', 'USDT.E']);

	const normalizeSymbol = (symbol: string) => {
		const upper = symbol.trim().toUpperCase();
		return NORMALIZE_MAP[upper] ?? upper;
	};

	const uniqueSymbols = allowlistSymbols(allPositions.map((pos) => normalizeSymbol(pos.assetSymbol)));
	let priceMap: Record<string, number> = {};
	let pricedCount = 0;
	let missingCount = 0;

	if (uniqueSymbols.length) {
		const tickers = (await getTickersUSD()) as Array<{
			symbol?: string;
			quotes?: { USD?: { price?: number } };
		}>;
		for (const ticker of tickers) {
			const symbol = String(ticker.symbol ?? '').trim().toUpperCase();
			if (!symbol || !uniqueSymbols.includes(symbol)) continue;
			const price = ticker.quotes?.USD?.price;
			if (typeof price === 'number') {
				priceMap[symbol] = price;
			}
		}
	}

	const chains = result.chains.map((chain) => {
		let suppliedUsdTotal = 0;
		let debtUsdTotal = 0;
		const pricedPositions = chain.positions.map((pos) => {
			const normalized = normalizeSymbol(pos.assetSymbol);
			const price =
				STABLES.has(normalized) || normalized.startsWith('USDC') || normalized.startsWith('USDT')
					? 1
					: priceMap[normalized] ?? 0;
			if (price > 0) {
				pricedCount += 1;
			} else {
				missingCount += 1;
			}
			const usdValue = Number.isFinite(pos.amount) ? pos.amount * price : 0;
			if (pos.side === 'supply') {
				suppliedUsdTotal += usdValue;
			} else {
				debtUsdTotal += usdValue;
			}
			return { ...pos, usdValue };
		});
		return {
			...chain,
			positions: pricedPositions,
			suppliedUsdTotal,
			debtUsdTotal,
			suppliedUsd: suppliedUsdTotal,
			debtUsd: debtUsdTotal,
		};
	});

	const suppliedUsdTotal = chains.reduce((sum, chain) => sum + (chain.suppliedUsdTotal ?? 0), 0);
	const debtUsdTotal = chains.reduce((sum, chain) => sum + (chain.debtUsdTotal ?? 0), 0);

	console.log('[aave] pricing', { pricedCount, missingCount });

	return {
		...result,
		chains,
		suppliedUsdTotal,
		debtUsdTotal,
		suppliedUsd: suppliedUsdTotal,
		debtUsd: debtUsdTotal,
	};
}
