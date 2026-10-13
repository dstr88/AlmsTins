import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getAllActiveWallets } from '@/lib/wallets';

export const prerender = false;

const AAVE_GRAPHQL_ENDPOINT = 'https://api.v3.aave.com/graphql';
const CHAIN_IDS = [1, 137, 43114];
const CHAIN_KEYS: Record<number, string> = {
	1: 'ethereum',
	137: 'polygon',
	43114: 'avalanche',
};

const MARKET_ADDRESSES: Record<number, string> = {
	1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
	137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
	43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
};

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
      market { name }
      currency { symbol }
      balance { amount { value } }
      apy { value }
    }

    userBorrows(
      request: {
        markets: [{ address: $market, chainId: $chainId }]
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

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; health: any; positions: any }>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isZeroLike(value: unknown) {
	if (value === null || value === undefined) return true;
	const num = Number(value);
	return !Number.isFinite(num) || num <= 0;
}

function toNumber(value: unknown): number {
	if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
	if (typeof value === 'string') {
		const num = Number(value);
		return Number.isFinite(num) ? num : 0;
	}
	return 0;
}

async function postGraphQL(query: string, variables: Record<string, any>, timeoutMs = 15_000) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(AAVE_GRAPHQL_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, variables }),
			signal: controller.signal,
		});
		const json = await response.json().catch(() => ({}));
		return { response, json };
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchChainHealth(address: string, chainId: number) {
	const market = MARKET_ADDRESSES[chainId];
	if (!market) {
		console.log('[aave] market-missing', { chainId, reason: 'MARKET_NOT_FOUND' });
		return {
			chain: CHAIN_KEYS[chainId] ?? String(chainId),
			chainId,
			market: null,
			healthFactor: null,
			totalCollateralBase: null,
			totalDebtBase: null,
			status: 'UNAVAILABLE',
			message: 'Unavailable on Avalanche (market not resolved)',
			reason: 'MARKET_NOT_FOUND',
		};
	}

	const requestPayload = { chainId, market, user: address.toLowerCase() };
	const { response: stateResponse, json: stateJson } = await postGraphQL(USER_MARKET_STATE_QUERY, {
		request: requestPayload,
	});

	if (!stateResponse.ok || stateJson.errors) {
		return {
			chainId,
			market,
			healthFactor: null,
			totalCollateralBase: null,
			totalDebtBase: null,
			error: stateJson.errors?.[0]?.message ?? 'User market state failed',
		};
	}

	const state = stateJson.data?.userMarketState ?? null;
	const healthFactor = state?.healthFactor ?? null;
	const totalCollateralBase = state?.totalCollateralBase ?? null;
	const totalDebtBase = state?.totalDebtBase ?? null;

	if (healthFactor === null || (isZeroLike(totalCollateralBase) && isZeroLike(totalDebtBase))) {
		return {
			chainId,
			market,
			healthFactor: null,
			totalCollateralBase: null,
			totalDebtBase: null,
		};
	}

	return {
		chainId,
		market,
		healthFactor,
		totalCollateralBase,
		totalDebtBase,
	};
}

async function fetchChainPositions(address: string, chainId: number) {
	const market = MARKET_ADDRESSES[chainId];
	if (!market) {
		return {
			chain: CHAIN_KEYS[chainId] ?? String(chainId),
			chainId,
			market: null,
			positions: [],
			status: 'UNAVAILABLE',
			message: 'Unavailable on Avalanche (market not resolved)',
			reason: 'MARKET_NOT_FOUND',
		};
	}

	const positionsVars = {
		user: address.toLowerCase(),
		chainId,
		market,
	};

	const { response: positionsResponse, json: positionsJson } = await postGraphQL(
		USER_POSITIONS_QUERY,
		positionsVars,
	);

	if (!positionsResponse.ok || positionsJson.errors) {
		return {
			chainId,
			market,
			positions: [],
			error: positionsJson.errors?.[0]?.message ?? 'Positions lookup failed',
		};
	}

	const userSupplies = Array.isArray(positionsJson.data?.userSupplies)
		? positionsJson.data.userSupplies
		: [];
	const userBorrows = Array.isArray(positionsJson.data?.userBorrows)
		? positionsJson.data.userBorrows
		: [];

	const positions = [
		...userSupplies.map((s: any) => ({
			side: 'supply',
			marketName: s.market?.name ?? 'Unknown',
			assetSymbol: s.currency?.symbol ?? 'UNKNOWN',
			amount: toNumber(s.balance?.amount?.value),
			apy: toNumber(s.apy?.value),
		})),
		...userBorrows.map((b: any) => ({
			side: 'borrow',
			marketName: b.market?.name ?? 'Unknown',
			assetSymbol: b.currency?.symbol ?? 'UNKNOWN',
			amount: toNumber(b.debt?.amount?.value),
			apy: toNumber(b.apy?.value),
		})),
	];

	return { chainId, market, positions };
}

async function fetchDefiData(address: string, force: boolean) {
	const cacheKey = address.toLowerCase();
	const now = Date.now();
	const cached = cache.get(cacheKey);

	if (cached && cached.expiresAt > now && !force) {
		return { health: cached.health, positions: cached.positions };
	}

	const healthByChain: Record<string, any> = {};
	const positionsByChain: Record<string, any> = {};

	for (let i = 0; i < CHAIN_IDS.length; i += 1) {
		const chainId = CHAIN_IDS[i];
		const chainKey = CHAIN_KEYS[chainId] ?? String(chainId);
		healthByChain[chainKey] = await fetchChainHealth(address, chainId);
		positionsByChain[chainKey] = await fetchChainPositions(address, chainId);
		if (i < CHAIN_IDS.length - 1) {
			await sleep(5000);
		}
	}

	const result = {
		health: { ok: true, address: address.toLowerCase(), chains: healthByChain },
		positions: { ok: true, address: address.toLowerCase(), chains: positionsByChain },
	};
	cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, ...result });
	return result;
}

async function syncWalletDefi(tenantId: string, wallet: { id: string; address: string }, force: boolean) {
	const { health, positions } = await fetchDefiData(wallet.address, force);
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

	return { walletId: wallet.id, lastSyncedAt: syncAt };
}

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const body = (await request.json().catch(() => null)) as { mode?: 'fast' | 'standard' | 'full' } | null;
		const mode = body?.mode ?? null;
		if (!mode || !['fast', 'standard', 'full'].includes(mode)) {
			return new Response(JSON.stringify({ ok: false, message: 'Invalid mode' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const force = mode === 'full';
		const wallets = await getAllActiveWallets(tenantId);
		const results: Array<{ ok: boolean; walletId: string; lastSyncedAt?: string; message?: string }> = [];

		for (const wallet of wallets) {
			try {
				const result = await syncWalletDefi(tenantId, wallet, force);
				results.push({ ok: true, ...result });
			} catch (error: any) {
				results.push({
					ok: false,
					walletId: wallet.id,
					message: error?.message ?? 'sync_failed',
				});
			}
		}

		const lastSyncedAt = results
			.map((entry) => (entry.ok ? entry.lastSyncedAt : null))
			.filter(Boolean)
			.pop() as string | undefined;

		return new Response(
			JSON.stringify({
				ok: true,
				message: 'Sync complete',
				lastSyncedAt: lastSyncedAt ?? null,
				results,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (error: any) {
		return new Response(JSON.stringify({ ok: false, message: error?.message ?? 'sync_failed' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
