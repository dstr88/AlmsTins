/**
 * A wallet's Aave positions and health factors across every Aave V3 market, for GET /api/aave/health
 * (which the DeFi tin and the liquidation-alert cron both read).
 *
 * Each Aave market computes its own health factor, and a wallet can hold positions in several at once,
 * e.g. Polygon plus the Ethereum Lido market. The endpoint used to check only the main market on Ethereum,
 * Polygon and Avalanche, one call after another (7 calls); a Lido position never showed and never alerted.
 * Now:
 *
 *   1. the live market list from Aave (every chain except testnets), kept in memory for a few hours, and
 *      the three main markets if Aave cannot list them;
 *   2. one call for the wallet's supplies and borrows in every market at once;
 *   3. health and totals (`userMarketState`) only for the markets with a position, in parallel.
 *
 * Aave's `markets(user:)` field would give health in one call, but asked about every chain at once it
 * dropped a live Polygon position, so health comes from `userMarketState` per market. If the bulk call
 * in step 2 fails, each market is asked on its own, in parallel.
 *
 * `chains` holds only the markets with a position, keyed by `marketKey` ('polygon', 'ethereum_lido').
 * The GraphQL poster is a parameter so tests can stand in for Aave.
 */

import { AAVE_MARKETS } from '@/lib/chains';
import { marketKey, marketLabel } from '@/lib/aave/markets';

export const AAVE_GRAPHQL_ENDPOINT = 'https://api.v3.aave.com/graphql';

const MARKET_LIST_TTL_MS = 6 * 60 * 60 * 1000;

export type GraphQLPost = (query: string, variables: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json: any }>;

export type AaveMarketRef = { name: string; address: string; chainId: number };

type SupplyRow = { currency: { symbol?: string }; balance: { amount: { value?: string } }; balanceUsd: number | null };
type BorrowRow = { currency: { symbol?: string }; debt: { amount: { value?: string } }; debtUsd: number | null };

export type MarketHealth = {
	chainId: number;
	market: string;
	marketName: string;
	label: string;
	healthFactor: string | null;
	totalCollateralBase: string | null;
	totalDebtBase: string | null;
	userSupplies: SupplyRow[];
	userBorrows: BorrowRow[];
	error?: string;
};

const CHAINS_QUERY = `
  query Chains {
    chains { chainId isTestnet }
  }
`;

const MARKETS_QUERY = `
  query Markets($chainIds: [ChainId!]!) {
    markets(request: { chainIds: $chainIds }) {
      name
      address
      chain { chainId }
    }
  }
`;

const USER_MARKET_STATE_QUERY = `
  query UserMarketState($request: UserMarketStateRequest!) {
    userMarketState(request: $request) {
      healthFactor
      totalCollateralBase
      totalDebtBase
      availableBorrowsBase
    }
  }
`;

const USER_POSITIONS_QUERY = `
  query UserPositions($user: EvmAddress!, $markets: [MarketInput!]!) {
    userSupplies(
      request: {
        markets: $markets
        user: $user
        collateralsOnly: false
        orderBy: { name: ASC }
      }
    ) {
      market { address chain { chainId } }
      currency { symbol }
      balance { amount { value } usd }
    }

    userBorrows(
      request: {
        markets: $markets
        user: $user
        orderBy: { name: ASC }
      }
    ) {
      market { address chain { chainId } }
      currency { symbol }
      debt { amount { value } usd }
    }
  }
`;

export const postAaveGraphQL: GraphQLPost = async (query, variables) => {
	const response = await fetch(AAVE_GRAPHQL_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	});
	const json = await response.json().catch(() => ({}));
	return { ok: response.ok, status: response.status, json };
};

const failed = (r: { ok: boolean; json: any }) => !r.ok || Boolean(r.json?.errors);

/** The three main markets, named as Aave names them; used when Aave cannot list its markets. */
const MAIN_MARKETS: AaveMarketRef[] = AAVE_MARKETS.map((m) => ({
	name: `AaveV3${m.chain.charAt(0).toUpperCase()}${m.chain.slice(1)}`,
	address: m.pool,
	chainId: m.chainId,
}));

let marketListCache: { at: number; markets: AaveMarketRef[] } | null = null;

/** For tests: forget the in-memory market list. */
export function resetMarketListCache() {
	marketListCache = null;
}

/** Every live Aave V3 market (no testnets), from Aave's API; the three main markets if that fails. */
export async function listAaveMarkets(post: GraphQLPost = postAaveGraphQL, now = Date.now()): Promise<AaveMarketRef[]> {
	if (marketListCache && now - marketListCache.at < MARKET_LIST_TTL_MS) return marketListCache.markets;
	try {
		const chains = await post(CHAINS_QUERY, {});
		if (failed(chains)) throw new Error(`chains lookup failed (${chains.status})`);
		const chainIds = (Array.isArray(chains.json?.data?.chains) ? chains.json.data.chains : [])
			.filter((c: any) => c && c.isTestnet !== true && Number.isFinite(Number(c.chainId)))
			.map((c: any) => Number(c.chainId));
		if (!chainIds.length) throw new Error('no chains');

		const markets = await post(MARKETS_QUERY, { chainIds });
		if (failed(markets)) throw new Error(`markets lookup failed (${markets.status})`);
		const list: AaveMarketRef[] = (Array.isArray(markets.json?.data?.markets) ? markets.json.data.markets : [])
			.filter((m: any) => m?.name && m?.address && Number.isFinite(Number(m?.chain?.chainId)))
			.map((m: any) => ({ name: String(m.name), address: String(m.address), chainId: Number(m.chain.chainId) }));
		if (!list.length) throw new Error('no markets');

		marketListCache = { at: now, markets: list };
		return list;
	} catch (err) {
		console.error('[aave/health] market list unavailable, checking the main markets only', err);
		return MAIN_MARKETS;
	}
}

const sameMarket = (m: AaveMarketRef, row: any) =>
	String(row?.market?.address ?? '').toLowerCase() === m.address.toLowerCase() &&
	Number(row?.market?.chain?.chainId) === m.chainId;

const usdOf = (value: unknown): number | null => {
	const n = Number(value);
	return value != null && Number.isFinite(n) ? n : null;
};

const toSupply = (row: any): SupplyRow => ({
	currency: { symbol: row?.currency?.symbol },
	balance: { amount: { value: row?.balance?.amount?.value } },
	balanceUsd: usdOf(row?.balance?.usd),
});

const toBorrow = (row: any): BorrowRow => ({
	currency: { symbol: row?.currency?.symbol },
	debt: { amount: { value: row?.debt?.amount?.value } },
	debtUsd: usdOf(row?.debt?.usd),
});

/** Supplies and borrows per market: one call for every market, else one call per market in parallel. */
async function positionsByMarket(post: GraphQLPost, user: string, markets: AaveMarketRef[]) {
	const out = new Map<AaveMarketRef, { supplies: any[]; borrows: any[] }>();
	const asInput = (m: AaveMarketRef) => ({ address: m.address, chainId: m.chainId });

	const bulk = await post(USER_POSITIONS_QUERY, { user, markets: markets.map(asInput) });
	if (!failed(bulk)) {
		const supplies: any[] = Array.isArray(bulk.json?.data?.userSupplies) ? bulk.json.data.userSupplies : [];
		const borrows: any[] = Array.isArray(bulk.json?.data?.userBorrows) ? bulk.json.data.userBorrows : [];
		for (const m of markets) {
			out.set(m, { supplies: supplies.filter((r) => sameMarket(m, r)), borrows: borrows.filter((r) => sameMarket(m, r)) });
		}
		return out;
	}

	console.error('[aave/health] bulk positions failed, asking each market', { status: bulk.status, errors: bulk.json?.errors ?? null });
	await Promise.all(markets.map(async (m) => {
		const one = await post(USER_POSITIONS_QUERY, { user, markets: [asInput(m)] });
		if (failed(one)) {
			console.error('[aave/health] positions error', { chainId: m.chainId, market: m.address, status: one.status });
			return;
		}
		out.set(m, {
			supplies: Array.isArray(one.json?.data?.userSupplies) ? one.json.data.userSupplies : [],
			borrows: Array.isArray(one.json?.data?.userBorrows) ? one.json.data.userBorrows : [],
		});
	}));
	return out;
}

function isZeroLike(value: unknown) {
	if (value === null || value === undefined) return true;
	const num = Number(value);
	return !Number.isFinite(num) || num <= 0;
}

export async function computeAccountHealth(address: string, post: GraphQLPost = postAaveGraphQL) {
	const user = address.toLowerCase();
	const markets = await listAaveMarkets(post);
	const positions = await positionsByMarket(post, user, markets);

	const active = markets.filter((m) => {
		const p = positions.get(m);
		return p && (p.supplies.length > 0 || p.borrows.length > 0);
	});

	const entries = await Promise.all(active.map(async (m): Promise<[string, MarketHealth]> => {
		const p = positions.get(m)!;
		const base = {
			chainId: m.chainId,
			market: m.address,
			marketName: m.name,
			label: marketLabel(m.name),
			userSupplies: p.supplies.map(toSupply),
			userBorrows: p.borrows.map(toBorrow),
		};
		const key = marketKey(m.name);

		const state = await post(USER_MARKET_STATE_QUERY, { request: { chainId: m.chainId, market: m.address, user } });
		if (failed(state)) {
			console.error('[aave/health] state error', { chainId: m.chainId, market: m.address, status: state.status, errors: state.json?.errors ?? null });
			return [key, {
				...base,
				healthFactor: null,
				totalCollateralBase: null,
				totalDebtBase: null,
				error: state.json?.errors?.[0]?.message ?? 'User market state failed',
			}];
		}

		const s = state.json?.data?.userMarketState ?? null;
		const healthFactor = s?.healthFactor ?? null;
		if (healthFactor === null || (isZeroLike(s?.totalCollateralBase) && isZeroLike(s?.totalDebtBase))) {
			return [key, { ...base, healthFactor: null, totalCollateralBase: null, totalDebtBase: null }];
		}
		return [key, {
			...base,
			healthFactor: String(healthFactor),
			totalCollateralBase: s?.totalCollateralBase ?? null,
			totalDebtBase: s?.totalDebtBase ?? null,
		}];
	}));

	return { ok: true as const, address: user, chains: Object.fromEntries(entries) as Record<string, MarketHealth> };
}
