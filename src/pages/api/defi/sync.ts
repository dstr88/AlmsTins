import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { getAavePositionsForWallet } from '@/lib/aave/client';

export const prerender = false;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; health: any; positions: any }>();

const AAVE_GRAPHQL_ENDPOINT = 'https://api.v3.aave.com/graphql';
const CHAIN_IDS = [1, 137, 43114];
const CHAIN_KEYS: Record<number, string> = {
	1: 'ethereum',
	137: 'polygon',
	43114: 'avalanche',
};

const MARKETS_QUERY = `
  query Markets($chainIds: [ChainId!]!, $user: EvmAddress) {
    markets(request: { chainIds: $chainIds, user: $user }) {
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
  query UserPositions($user: EvmAddress!, $chainId: ChainId!, $market: EvmAddress!) {
    userSupplies(
      request: {
        markets: [{ address: $market, chainId: $chainId }]
        user: $user
        collateralsOnly: false
        orderBy: { name: ASC }
      }
    ) {
      currency { symbol }
      balance { amount { value } }
    }

    userBorrows(
      request: {
        markets: [{ address: $market, chainId: $chainId }]
        user: $user
        orderBy: { name: ASC }
      }
    ) {
      currency { symbol }
      debt { amount { value } }
    }
  }
`;

const USER_POSITIONS_FALLBACK_QUERY = USER_POSITIONS_QUERY;

function isZeroLike(value: unknown) {
	if (value === null || value === undefined) return true;
	const num = Number(value);
	return !Number.isFinite(num) || num <= 0;
}

async function postGraphQL(query: string, variables: Record<string, any>) {
	const response = await fetch(AAVE_GRAPHQL_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ query, variables }),
	});
	const json = await response.json().catch(() => ({}));
	return { response, json };
}

async function fetchAaveHealth(address: string) {
	const marketRequest = { chainIds: CHAIN_IDS, user: address.toLowerCase() };
	const { response: marketsResponse, json: marketsJson } = await postGraphQL(MARKETS_QUERY, marketRequest);

	if (!marketsResponse.ok || marketsJson.errors) {
		throw new Error('Markets lookup failed');
	}

	const markets = Array.isArray(marketsJson.data?.markets) ? marketsJson.data.markets : [];
	const chains: Record<string, any> = {};

	for (const chainId of CHAIN_IDS) {
		const chainKey = CHAIN_KEYS[chainId] ?? String(chainId);
		const market = markets.find((entry: any) => Number(entry?.chain?.chainId) === chainId);

		if (!market) {
			console.log('[aave] market-missing', { chainId, reason: 'MARKET_NOT_FOUND' });
			chains[chainKey] = {
				chain: chainKey,
				chainId,
				market: null,
				healthFactor: null,
				totalCollateralBase: null,
				totalDebtBase: null,
				status: 'UNAVAILABLE',
				message: 'Unavailable on Avalanche (market not resolved)',
				reason: 'MARKET_NOT_FOUND',
			};
			continue;
		}

		const requestPayload = { chainId, market: market.address, user: address.toLowerCase() };
		const { response: stateResponse, json: stateJson } = await postGraphQL(USER_MARKET_STATE_QUERY, {
			request: requestPayload,
		});

		if (!stateResponse.ok || stateJson.errors) {
			chains[chainKey] = {
				chainId,
				market: market.address,
				healthFactor: null,
				totalCollateralBase: null,
				totalDebtBase: null,
				error: stateJson.errors?.[0]?.message ?? 'User market state failed',
			};
			continue;
		}

		const state = stateJson.data?.userMarketState ?? null;
		const healthFactor = state?.healthFactor ?? null;
		const totalCollateralBase = state?.totalCollateralBase ?? null;
		const totalDebtBase = state?.totalDebtBase ?? null;

		const positionsVars = {
			user: address.toLowerCase(),
			chainId,
			market: market.address,
		};
		let { response: positionsResponse, json: positionsJson } = await postGraphQL(USER_POSITIONS_QUERY, positionsVars);

		if (!positionsResponse.ok || positionsJson.errors) {
			({ response: positionsResponse, json: positionsJson } = await postGraphQL(
				USER_POSITIONS_FALLBACK_QUERY,
				positionsVars,
			));
		}

		const userSupplies = Array.isArray(positionsJson.data?.userSupplies)
			? positionsJson.data.userSupplies
			: [];
		const userBorrows = Array.isArray(positionsJson.data?.userBorrows) ? positionsJson.data.userBorrows : [];

		if (healthFactor === null || (isZeroLike(totalCollateralBase) && isZeroLike(totalDebtBase))) {
			chains[chainKey] = {
				chainId,
				market: market.address,
				healthFactor: null,
				totalCollateralBase: null,
				totalDebtBase: null,
				userSupplies,
				userBorrows,
			};
			continue;
		}

		chains[chainKey] = {
			chainId,
			market: market.address,
			healthFactor,
			totalCollateralBase,
			totalDebtBase,
			userSupplies,
			userBorrows,
		};
	}

	return { ok: true, address: address.toLowerCase(), chains };
}

async function syncWalletDefi(tenantId: string, wallet: { id: string; address: string }, force: boolean) {
	const cacheKey = wallet.id;
	const now = Date.now();
	const cached = cache.get(cacheKey);
	let health = cached?.health ?? null;
	let positions = cached?.positions ?? null;

	if (!cached || cached.expiresAt <= now || force) {
		health = await fetchAaveHealth(wallet.address);
		positions = await getAavePositionsForWallet(wallet.address);
		cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, health, positions });
	}

	const interestPaid = 0;
	const interestEarned = 0;
	const netInterest = interestPaid - interestEarned;
	const syncAt = new Date().toISOString();

	await db.execute({
		sql: `INSERT INTO wallet_defi_sync (
				tenant_id,
				wallet_id,
				last_defi_sync_at,
				interest_paid_total,
				interest_earned_total,
				net_interest_total,
				health_payload,
				positions_payload,
				updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(tenant_id, wallet_id) DO UPDATE SET
				last_defi_sync_at = excluded.last_defi_sync_at,
				interest_paid_total = excluded.interest_paid_total,
				interest_earned_total = excluded.interest_earned_total,
				net_interest_total = excluded.net_interest_total,
				health_payload = excluded.health_payload,
				positions_payload = excluded.positions_payload,
				updated_at = excluded.updated_at`,
		args: [
			tenantId,
			wallet.id,
			syncAt,
			interestPaid,
			interestEarned,
			netInterest,
			JSON.stringify(health),
			JSON.stringify(positions),
			syncAt,
		],
	});

	return { walletId: wallet.id, ok: true, lastSyncAt: syncAt };
}

export const POST: APIRoute = async () => {
	return new Response(JSON.stringify({ ok: false, error: 'Deprecated endpoint.' }), {
		status: 410,
		headers: { 'Content-Type': 'application/json' },
	});
};
