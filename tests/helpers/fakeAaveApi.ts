import { vi } from 'vitest';

/**
 * A stand-in for Aave's GraphQL API, installed over the global fetch, so tests can run the real Aave client
 * (src/lib/aave/client.ts) with no network. It answers the three queries the client sends: the markets list,
 * a user's positions in one market, and the user's state in every market (Aave's own collateral and debt totals).
 *
 * Every symbol, amount and price a test hands it is invented.
 */
export type FakeSupply = {
	symbol: string;
	amount: string;
	/** Aave's own USD figure for the position. Leave out to model a position Aave did not value. */
	usd?: string;
	usdPerToken?: string;
	isCollateral?: boolean;
};

export type FakeBorrow = { symbol: string; amount: string; usd?: string; usdPerToken?: string };

export type FakeChain = {
	supplies?: FakeSupply[];
	borrows?: FakeBorrow[];
	/**
	 * Aave's own totals for the user in this market. 'fail' makes the user's state lookup return an error (it is
	 * one request for every market, so the whole lookup fails).
	 */
	state?: { totalCollateralBase: string; totalDebtBase: string } | 'fail';
	/** Answer every positions request for this chain with this HTTP status (a chain outage). */
	positionsHttpStatus?: number;
};

export type FakeAave = {
	/** Keyed by chain id: 1 Ethereum, 137 Polygon, 43114 Avalanche. A missing chain has no positions. */
	chains: Record<number, FakeChain>;
	/** Positions for particular wallets (lowercase address), each keyed by chain id. Any other wallet gets `chains`. */
	users?: Record<string, Record<number, FakeChain>>;
	/** Answer a positions query that asks for the USD fields (usd, usdPerToken, isCollateral) with HTTP 400. */
	rejectUsdFields?: boolean;
};

export type FakeAaveHandle = {
	/** Every GraphQL query text sent, in order. */
	queries: string[];
	positionQueries: () => string[];
	stateQueries: () => number;
	restore: () => void;
};

const CHAIN_IDS = [1, 137, 43114];
const marketOf = (chainId: number) => `0x${chainId.toString(16).padStart(40, '0')}`;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function installFakeAaveApi(fake: FakeAave): FakeAaveHandle {
	const queries: string[] = [];

	const handler = async (_url: unknown, init?: { body?: unknown }) => {
		const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: any };
		const query = String(body.query ?? '');
		queries.push(query);

		if (/query\s+Markets/.test(query)) {
			return json({
				data: { markets: CHAIN_IDS.map((chainId) => ({ address: marketOf(chainId), chain: { chainId } })) },
			});
		}

		const chainsOf = (user: unknown) => fake.users?.[String(user ?? '').toLowerCase()] ?? fake.chains;

		if (query.includes('userState')) {
			const chains = chainsOf(body.variables?.user);
			if (Object.values(chains).some((c) => c.state === 'fail')) {
				return json({ errors: [{ message: 'state lookup failed' }] });
			}
			return json({
				data: {
					markets: CHAIN_IDS.map((chainId) => {
						const state = chains[chainId]?.state;
						return {
							address: marketOf(chainId),
							userState: state && state !== 'fail' ? state : { totalCollateralBase: '0', totalDebtBase: '0' },
						};
					}),
				},
			});
		}

		if (query.includes('userSupplies')) {
			const chainId = Number(/chainId:\s*(\d+)/.exec(query)?.[1]);
			const chain = chainsOf(body.variables?.user)[chainId] ?? {};
			const asksForUsd = query.includes('usdPerToken');
			if (asksForUsd && fake.rejectUsdFields) {
				return json({ errors: [{ message: 'Cannot query field "usd" on type "TokenAmount".' }] }, 400);
			}
			if (chain.positionsHttpStatus) return json({ errors: [{ message: 'upstream error' }] }, chain.positionsHttpStatus);
			return json({
				data: {
					userSupplies: (chain.supplies ?? []).map((s) => ({
						market: { name: 'FakeMarket' },
						currency: { symbol: s.symbol },
						balance: {
							amount: { value: s.amount },
							...(asksForUsd && s.usd !== undefined ? { usd: s.usd } : {}),
							...(asksForUsd && s.usdPerToken !== undefined ? { usdPerToken: s.usdPerToken } : {}),
						},
						...(asksForUsd && s.isCollateral !== undefined ? { isCollateral: s.isCollateral } : {}),
						apy: { value: '0.02' },
					})),
					userBorrows: (chain.borrows ?? []).map((b) => ({
						market: { name: 'FakeMarket' },
						currency: { symbol: b.symbol },
						debt: {
							amount: { value: b.amount },
							...(asksForUsd && b.usd !== undefined ? { usd: b.usd } : {}),
							...(asksForUsd && b.usdPerToken !== undefined ? { usdPerToken: b.usdPerToken } : {}),
						},
						apy: { value: '0.04' },
					})),
				},
			});
		}

		return json({ errors: [{ message: 'unexpected query in the fake Aave API' }] }, 400);
	};

	vi.stubGlobal('fetch', vi.fn(handler));

	return {
		queries,
		positionQueries: () => queries.filter((q) => q.includes('userSupplies')),
		stateQueries: () => queries.filter((q) => q.includes('userState')).length,
		restore: () => vi.unstubAllGlobals(),
	};
}
