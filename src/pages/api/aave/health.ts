import type { APIRoute } from 'astro';
import { getCache, setCache } from '@/lib/tursoCache';
import { tryAcquireLock } from '@/lib/cacheLock';

export const prerender = false;

const AAVE_GRAPHQL_ENDPOINT = 'https://api.v3.aave.com/graphql';
const CHAIN_IDS = [1, 137, 43114];
const CHAIN_KEYS: Record<number, string> = {
	1: 'ethereum',
	137: 'polygon',
	43114: 'avalanche',
};
const HEALTH_TTL_SECONDS = 120;
const HEALTH_STALE_MAX_SECONDS = 600;
const REFRESH_LOCK_SECONDS = 20;

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

const USER_POSITIONS_FALLBACK_QUERY = `
  query UserPositionsFallback($user: EvmAddress!, $chainId: ChainId!, $market: EvmAddress!) {
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

async function computeHealth(address: string) {
	const marketRequest = { chainIds: CHAIN_IDS, user: address.toLowerCase() };
	const { response: marketsResponse, json: marketsJson } = await postGraphQL(MARKETS_QUERY, marketRequest);

	if (!marketsResponse.ok || marketsJson.errors) {
		console.error('[aave/health] markets error', {
			status: marketsResponse.status,
			errors: marketsJson.errors ?? null,
		});
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

		console.log('[aave/health] market', { chainId, market: market.address });

		const requestPayload = { chainId, market: market.address, user: address.toLowerCase() };
		const { response: stateResponse, json: stateJson } = await postGraphQL(USER_MARKET_STATE_QUERY, {
			request: requestPayload,
		});

		if (!stateResponse.ok || stateJson.errors) {
			console.error('[aave/health] state error', {
				chainId,
				market: market.address,
				status: stateResponse.status,
				errors: stateJson.errors ?? null,
			});
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
			console.error('[aave/health] positions error', {
				chainId,
				market: market.address,
				status: positionsResponse.status,
				errors: positionsJson.errors ?? null,
			});
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

export const GET: APIRoute = async ({ request, locals }) => {
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const requestId = (locals as Record<string, any>)?.requestId;
	const logPerf = (status: number, meta?: { count?: number; cached?: boolean; stale?: boolean }) => {
		console.log('[perf] aave-health', {
			requestId,
			durationMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start),
			status,
			...(meta ?? {}),
		});
	};
	const url = new URL(request.url);
	const address = url.searchParams.get('address') ?? '';

	if (!address) {
		logPerf(400);
		return new Response(JSON.stringify({ ok: false, error: 'Missing address' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const normalized = address.toLowerCase();
		const cacheKey = `aave:health:${normalized}`;
		const lockKey = `lock:${cacheKey}`;
		const cached = await getCache<{ ok: boolean; address: string; chains: Record<string, any>; asOf?: string }>(
			cacheKey,
			{ allowStale: true, staleMaxAgeSeconds: HEALTH_STALE_MAX_SECONDS },
		);

		if (cached.value?.chains) {
			if (cached.isStale) {
				(async () => {
					const gotLock = await tryAcquireLock(lockKey, REFRESH_LOCK_SECONDS);
					if (!gotLock) {
						console.log('[cache] aave-health refresh skip (lock-busy)', { requestId });
						return;
					}
					try {
						const fresh = await computeHealth(normalized);
						const payload = { ...fresh, asOf: new Date().toISOString() };
						await setCache(cacheKey, payload, HEALTH_TTL_SECONDS);
						console.log('[cache] aave-health refreshed', { requestId });
					} catch (error) {
						console.warn('[cache] aave-health refresh failed', { requestId, error });
					}
				})();
			}

			logPerf(200, {
				count: Object.keys(cached.value.chains ?? {}).length,
				cached: true,
				stale: cached.isStale,
			});
			return new Response(
				JSON.stringify({
					...cached.value,
					cached: true,
					stale: cached.isStale,
					asOf:
						cached.value.asOf ??
						(cached.updatedAt ? new Date(cached.updatedAt).toISOString() : null),
				}),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				},
			);
		}

		const fresh = await computeHealth(normalized);
		const payload = { ...fresh, asOf: new Date().toISOString() };
		await setCache(cacheKey, payload, HEALTH_TTL_SECONDS);

		logPerf(200, { count: Object.keys(fresh.chains ?? {}).length, cached: false, stale: false });
		return new Response(
			JSON.stringify({ ...payload, cached: false, stale: false }),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err) {
		console.error('[api/aave/health] error', err);
		logPerf(500);
		return new Response(JSON.stringify({ ok: false, error: 'Aave lookup failed' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
