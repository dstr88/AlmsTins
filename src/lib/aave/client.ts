// src/lib/aave/client.ts

import { AaveV3Avalanche, AaveV3Ethereum, AaveV3Polygon } from '@bgd-labs/aave-address-book';
import {
	buildTickerPriceMap,
	completeAaveTotals,
	readAaveUsd,
	type AavePriceSource,
	type AaveTotals,
} from './pricing';

// ── Aave v3 ───────────────────────────────────────────────────────────────────
const AAVE_V3_GRAPHQL_ENDPOINT = 'https://api.v3.aave.com/graphql';

// Keep the old name as an alias so nothing else in the file breaks
const AAVE_GRAPHQL_ENDPOINT = AAVE_V3_GRAPHQL_ENDPOINT;

// Pool addresses sourced from @bgd-labs/aave-address-book — always up to date.
// No more hardcoded addresses to manually track.
const ETHEREUM_MARKET_ADDRESS = AaveV3Ethereum.POOL;
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
	/**
	 * USD value of the position. Aave's own figure when it gave one; otherwise 0 until
	 * getAaveTotalsForWallet prices it (and still 0, with priceSource 'none', when nothing can).
	 */
	usdValue: number;
	/** Supply only: whether Aave counts the supply as collateral. Absent when the API did not say. */
	isCollateral?: boolean;
	/** Aave's own USD valuation of the position; null when the API gave none we can use. */
	aaveUsd?: number | null;
	/** Where usdValue came from. Set by getAaveTotalsForWallet. 'none' means no price source could value it. */
	priceSource?: AavePriceSource;
};

/** The totals Aave itself reports for the user in one market (userMarketState), in USD. */
export type AaveReported = {
	totalCollateralUsd: number | null;
	totalDebtUsd: number | null;
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
	/** Aave's own collateral and debt totals for this market; null when that lookup failed. */
	reported?: AaveReported | null;
	status?: string;
	message?: string;
	reason?: string;
	warning?: string;
	error?: string;
};

export type AavePositionsResponse = {
	ok: boolean;
	/** Absent when the input is not an EVM address (nothing to look up). */
	address?: string;
	chains: AaveChainSummary[];
	error?: string;
};

// --- GraphQL query we already proved works in the playground ---

function buildUserPositionsQuery(marketAddress: string, chainId: number, withUsd: boolean = true) {
	// NOTE: This matches the query that returned WBTC, USDC, WETH, WPOL supplies and USDC/USDT0 borrows.
	// withUsd adds Aave's own USD valuation of each position (and whether a supply is collateral). The plain
	// form is the fallback for an API that rejects those fields: positions must never be lost over them.
	const supplyBalance = withUsd
		? 'balance { amount { value } usd usdPerToken }\n      isCollateral'
		: 'balance { amount { value } }';
	const borrowDebt = withUsd ? 'debt { amount { value } usd usdPerToken }' : 'debt { amount { value } }';
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
      ${supplyBalance}
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
      ${borrowDebt}
      apy { value }
    }
  }
`;
}

// Aave's own collateral and debt totals for the user in every market, in one request. Asked separately from the
// positions, so a failure here can only switch off the sanity check, never cost the positions themselves.
const USER_MARKET_STATES_QUERY = /* GraphQL */ `
  query UserMarketStates($chainIds: [ChainId!]!, $user: EvmAddress) {
    markets(request: { chainIds: $chainIds, user: $user }) {
      address
      chain { chainId }
      userState {
        totalCollateralBase
        totalDebtBase
      }
    }
  }
`;

// The sanity check is a bonus: it never holds up the positions for longer than this.
const REPORTED_TOTALS_TIMEOUT_MS = 8000;

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

/** A finite number from whatever the payload carried, else null (toNumber turns "missing" into 0). */
function toNumberOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * The collateral and debt totals Aave itself reports for the user, keyed by lowercase market address, or null
 * when that lookup fails. It never rejects and never waits long: the figures only feed the sanity check in
 * completeAaveTotals, so a failure here switches the check off and nothing else.
 */
/**
 * The key under which a market's reported totals are kept. The Aave v3 pool has ONE address on Polygon and on
 * Avalanche (and on other chains), so an address alone cannot tell two markets apart.
 */
function reportedKey(chainId: number, marketAddress: string): string {
	return `${chainId}:${marketAddress.toLowerCase()}`;
}

async function fetchReportedTotals(user: string): Promise<Map<string, AaveReported> | null> {
	try {
		const response = await fetch(AAVE_V3_GRAPHQL_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: USER_MARKET_STATES_QUERY,
				variables: { chainIds: [ETHEREUM_CHAIN_ID, POLYGON_CHAIN_ID, AVALANCHE_CHAIN_ID], user },
			}),
			signal: AbortSignal.timeout(REPORTED_TOTALS_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		const json = await response.json();
		if (json?.errors?.length) return null;
		const out = new Map<string, AaveReported>();
		for (const market of Array.isArray(json?.data?.markets) ? json.data.markets : []) {
			const address = String(market?.address ?? '').toLowerCase();
			const chainId = Number(market?.chain?.chainId);
			const totalCollateralUsd = toNumberOrNull(market?.userState?.totalCollateralBase);
			const totalDebtUsd = toNumberOrNull(market?.userState?.totalDebtBase);
			// A market whose chain is unknown is left out: the check is skipped for it, never run against another chain's totals.
			if (!address || !Number.isFinite(chainId) || (totalCollateralUsd === null && totalDebtUsd === null)) continue;
			out.set(reportedKey(chainId, address), { totalCollateralUsd, totalDebtUsd });
		}
		return out;
	} catch (err) {
		console.warn('[aave] market-state lookup failed; sanity check skipped', err);
		return null;
	}
}

/** One positions request. The caller decides what a rejection means. */
async function requestPositions(
	apiEndpoint: string,
	user: string,
	marketAddress: string,
	chainId: number,
	withUsd: boolean,
): Promise<{ ok: true; json: any } | { ok: false; status: number; text: string }> {
	const response = await fetch(apiEndpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			query: buildUserPositionsQuery(marketAddress, chainId, withUsd),
			variables: { user },
		}),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => '');
		return { ok: false, status: response.status, text };
	}
	return { ok: true, json: await response.json() };
}

async function fetchUserPositionsForMarket(
	userAddress: string,
	marketAddress: string,
	chainId: number,
	chain: AaveChainSummary['chain'],
	apiEndpoint: string = AAVE_V3_GRAPHQL_ENDPOINT,
): Promise<AaveChainSummary> {
	const user = userAddress.toLowerCase();

	try {
		let reply = await requestPositions(apiEndpoint, user, marketAddress, chainId, true);
		// A 400 or GraphQL errors can mean the API rejects the USD fields: ask again for the plain positions.
		const rejected =
			(!reply.ok && reply.status === 400) || (reply.ok && Array.isArray(reply.json?.errors) && reply.json.errors.length > 0);
		if (rejected) {
			console.warn(`[AAVE ${chain}] position query with USD fields was rejected; retrying without them`);
			reply = await requestPositions(apiEndpoint, user, marketAddress, chainId, false);
		}

		if (!reply.ok) {
			console.error(`[AAVE ${chain}] HTTP error`, reply.status, reply.text);
			return {
				chain,
				suppliedUsd: 0,
				debtUsd: 0,
				suppliedUsdTotal: 0,
				debtUsdTotal: 0,
				positions: [],
				ok: false,
				error: `HTTP ${reply.status}`,
			};
		}

		const json = reply.json;
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
			const safeAmount = Number.isFinite(amount) ? amount : 0;
			const aaveUsd = readAaveUsd(s.balance, safeAmount);

			positions.push({
				side: 'supply',
				marketName,
				assetSymbol: symbol,
				amount: safeAmount,
				apy: Number.isFinite(apy) ? apy : 0,
				usdValue: aaveUsd ?? 0, // Aave's own figure; getAaveTotalsForWallet prices any position without one
				aaveUsd,
				...(typeof s.isCollateral === 'boolean' ? { isCollateral: s.isCollateral } : {}),
			});
		}

		// Borrows
		for (const b of rawBorrows) {
			const marketName = b.market?.name ?? 'Unknown';
			const symbol = b.currency?.symbol ?? 'UNKNOWN';
			const amount = toNumber(b.debt?.amount?.value);
			const apy = toNumber(b.apy?.value);
			const safeAmount = Number.isFinite(amount) ? amount : 0;
			const aaveUsd = readAaveUsd(b.debt, safeAmount);

			positions.push({
				side: 'borrow',
				marketName,
				assetSymbol: symbol,
				amount: safeAmount,
				apy: Number.isFinite(apy) ? apy : 0,
				usdValue: aaveUsd ?? 0, // Aave's own figure; getAaveTotalsForWallet prices any position without one
				aaveUsd,
			});
		}

		// What Aave itself valued. getAaveTotalsForWallet completes any position Aave did not value.
		const suppliedUsd = positions.reduce((sum, p) => (p.side === 'supply' ? sum + p.usdValue : sum), 0);
		const debtUsd = positions.reduce((sum, p) => (p.side === 'borrow' ? sum + p.usdValue : sum), 0);
		return {
			chain,
			suppliedUsd,
			debtUsd,
			suppliedUsdTotal: suppliedUsd,
			debtUsdTotal: debtUsd,
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

/**
 * Every Aave v3 position the wallet has on Ethereum, Polygon and Avalanche (and v4 when configured), each with
 * Aave's own USD figure when the API gave one. withReported also asks Aave for its own collateral and debt
 * totals (one extra request), which getAaveTotalsForWallet checks its sums against.
 */
export async function getAavePositionsForWallet(
	address: string,
	options: { withReported?: boolean } = {},
): Promise<AavePositionsResponse> {
	if (!EVM_ADDRESS_RE.test(address)) {
		return { chains: [], ok: true };
	}

	const normalized = address.toLowerCase();

	// Aave's own collateral and debt totals, for the sanity check. One extra request, started now so it runs while
	// the chains are read, and only when asked for: callers that just need amounts (Memory Lane) do not pay for it.
	const reportedLookup = options.withReported ? fetchReportedTotals(normalized) : null;

	try {
		const ethereumMarket = await resolveMarketAddress(ETHEREUM_CHAIN_ID, {
			fallback: ETHEREUM_MARKET_ADDRESS,
		});
		const polygonMarket = await resolveMarketAddress(POLYGON_CHAIN_ID, {
			fallback: POLYGON_MARKET_ADDRESS,
		});
		const avalancheMarket = await resolveMarketAddress(AVALANCHE_CHAIN_ID, {
			fallback: AVALANCHE_MARKET_ADDRESS,
		});

		const ethereum = ethereumMarket.address
			? await fetchUserPositionsForMarket(
					normalized,
					ethereumMarket.address,
					ETHEREUM_CHAIN_ID,
					'ethereum',
				)
			: buildMissingMarketSummary('ethereum', 'Ethereum market not available');
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

		const reported = reportedLookup ? await reportedLookup : null;
		// Aave v4 is not covered by the v3 totals, so it carries none and is not checked.
		const chainIdOf: Record<string, number> = { ethereum: ETHEREUM_CHAIN_ID, polygon: POLYGON_CHAIN_ID, avalanche: AVALANCHE_CHAIN_ID };
		const withReported = (summary: AaveChainSummary): AaveChainSummary =>
			reportedLookup && summary.market && summary.chain !== 'ethereum_v4'
				? { ...summary, reported: reported?.get(reportedKey(chainIdOf[summary.chain], summary.market)) ?? null }
				: summary;

		return {
			ok: true,
			address: normalized,
			chains: [ethereum, polygon, avalanche, ethereumV4].map(withReported),
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

/**
 * Every position of the wallet, priced, with totals per chain and overall, and a coverage report of what the
 * totals leave out. Aave's own USD figure prices a position when it gave one; market tickers price the rest
 * (see src/lib/aave/pricing.ts); a position neither can price is counted as unpriced and the totals are
 * marked partial, never silently worth $0. A price feed outage cannot make this throw: it only leaves the
 * positions Aave did not value unpriced.
 */
export async function getAaveTotalsForWallet(address: string): Promise<AaveTotals> {
	const result = await getAavePositionsForWallet(address, { withReported: true });

	// Market tickers are needed only for a position Aave did not value itself.
	const needsMarketPrices = result.chains.some((chain) =>
		chain.positions.some((pos) => pos.amount > 0 && pos.aaveUsd == null),
	);
	let tickerPrices = new Map<string, number>();
	if (needsMarketPrices) {
		try {
			const { getTickersUSD } = await import('@/lib/coinpaprikaProvider');
			tickerPrices = buildTickerPriceMap(await getTickersUSD());
		} catch (err) {
			console.warn('[aave] market prices unavailable; positions Aave did not value stay unpriced', err);
		}
	}

	const totals = completeAaveTotals(result, tickerPrices);
	logCoverage(totals);
	return totals;
}

function logCoverage(totals: AaveTotals) {
	const { coverage } = totals;
	const bySource = { aave: 0, market: 0, none: 0 };
	for (const chain of totals.chains) {
		for (const pos of chain.positions) bySource[pos.priceSource ?? 'none'] += 1;
	}
	console.log('[aave] pricing', { fromAave: bySource.aave, fromMarket: bySource.market, unpriced: coverage.unpricedCount });
	if (coverage.unpricedCount > 0) {
		console.warn('[aave] unpriced positions are left out of the totals', {
			count: coverage.unpricedCount,
			symbols: [...new Set(coverage.unpriced.map((p) => p.symbol))],
		});
	}
	for (const gap of coverage.gaps) {
		console.warn('[aave] priced figures disagree with the totals Aave itself reports', gap);
	}
	if (coverage.unavailableChains.length > 0) {
		console.warn('[aave] lookup failed for', coverage.unavailableChains);
	}
}
