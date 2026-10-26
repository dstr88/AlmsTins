import { vi } from 'vitest';

/**
 * A stand-in for Aave's GraphQL API, installed over the global fetch, so tests can run the real Aave client
 * (src/lib/aave/client.ts) with no network. It answers the three queries the client sends: the markets list,
 * a user's positions in one market, and the user's state in one market (Aave's own collateral and debt totals).
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
	 * Aave's own totals for the user in this market. 'fail' makes this market's state lookup return an error, so
	 * the sanity check is skipped for this chain only (it is one request per market).
	 */
	state?: { totalCollateralBase: string; totalDebtBase: string } | 'fail';
	/** Answer every positions request for this chain with this HTTP status (a chain outage). */
	positionsHttpStatus?: number;
};

/** An Aave market beyond the main three (the Ethereum Lido market, say), with the wallet's positions in it. */
export type FakeExtraMarket = { name: string; chainId: number; address: string } & FakeChain;

export type FakeAave = {
	/** Keyed by chain id: 1 Ethereum, 137 Polygon, 43114 Avalanche. A missing chain has no positions. */
	chains: Record<number, FakeChain>;
	/** Further markets, listed after the main three and read like them. */
	extraMarkets?: FakeExtraMarket[];
	/** Make the market list (the `Chains` query) fail, as when Aave cannot list its markets. */
	marketListFails?: boolean;
	/** Make the bulk positions call (several markets at once) fail, so each market is asked on its own. */
	bulkPositionsFail?: boolean;
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
	/** The variables of every market-state request, in the order they arrived. */
	stateRequests: () => Array<{ chainId: number; market: string; user: string }>;
	restore: () => void;
};

const CHAIN_IDS = [1, 137, 43114];
const MAIN_NAMES: Record<number, string> = { 1: 'AaveV3Ethereum', 137: 'AaveV3Polygon', 43114: 'AaveV3Avalanche' };
// The Aave v3 pool has ONE address on Polygon and on Avalanche (and on other chains), so two markets can share an
// address. Ethereum has its own. The fake mirrors that, because keying anything by address alone is a bug.
const SHARED_POOL = `0x${'a'.repeat(40)}`;
const marketOf = (chainId: number) => (chainId === 1 ? `0x${'b'.repeat(40)}` : SHARED_POOL);

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function installFakeAaveApi(fake: FakeAave): FakeAaveHandle {
	const queries: string[] = [];
	const stateRequests: Array<{ chainId: number; market: string; user: string }> = [];

	const handler = async (_url: unknown, init?: { body?: unknown }) => {
		const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: any };
		const query = String(body.query ?? '');
		queries.push(query);

		if (/query\s+Chains/.test(query)) {
			if (fake.marketListFails) return json({ errors: [{ message: 'chains unavailable' }] }, 503);
			const ids = new Set([...CHAIN_IDS, ...(fake.extraMarkets ?? []).map((m) => m.chainId)]);
			return json({ data: { chains: [...ids].map((chainId) => ({ chainId, isTestnet: false })) } });
		}

		if (/query\s+Markets/.test(query)) {
			const markets = [
				...CHAIN_IDS.map((chainId) => ({ name: MAIN_NAMES[chainId], address: marketOf(chainId), chain: { chainId } })),
				...(fake.extraMarkets ?? []).map((m) => ({ name: m.name, address: m.address, chain: { chainId: m.chainId } })),
			];
			const wanted: number[] | undefined = body.variables?.chainIds;
			return json({ data: { markets: wanted ? markets.filter((m) => wanted.includes(m.chain.chainId)) : markets } });
		}

		const chainsOf = (user: unknown) => fake.users?.[String(user ?? '').toLowerCase()] ?? fake.chains;
		// One market's positions: an extra market when the address is one, else the main market on that chain.
		const marketData = (user: unknown, chainId: number, address: string): FakeChain => {
			const extra = (fake.extraMarkets ?? []).find(
				(m) => m.chainId === chainId && m.address.toLowerCase() === address.toLowerCase(),
			);
			if (extra) return extra;
			return address.toLowerCase() === marketOf(chainId).toLowerCase() ? chainsOf(user)[chainId] ?? {} : {};
		};

		if (query.includes('userMarketState')) {
			const request = body.variables?.request ?? {};
			stateRequests.push({ chainId: Number(request.chainId), market: String(request.market), user: String(request.user) });
			const state = marketData(request.user, Number(request.chainId), String(request.market ?? '')).state;
			if (state === 'fail') return json({ errors: [{ message: 'state lookup failed' }] });
			return json({
				data: { userMarketState: state ?? { totalCollateralBase: '0', totalDebtBase: '0' } },
			});
		}

		// The shared lookup's form: markets as a variable, several at once, every row naming its market.
		if (query.includes('userSupplies') && Array.isArray(body.variables?.markets)) {
			const asked: Array<{ address: string; chainId: number }> = body.variables.markets;
			if (fake.bulkPositionsFail && asked.length > 1) return json({ errors: [{ message: 'too many markets' }] });
			const rows = asked.map((m) => ({ m, data: marketData(body.variables?.user, Number(m.chainId), String(m.address)) }));
			if (rows.some((r) => r.data.positionsHttpStatus)) return json({ errors: [{ message: 'upstream error' }] }, 502);
			const at = (m: { address: string; chainId: number }) => ({ address: m.address, chain: { chainId: m.chainId } });
			return json({
				data: {
					userSupplies: rows.flatMap(({ m, data }) => (data.supplies ?? []).map((s) => ({
						market: at(m), currency: { symbol: s.symbol }, balance: { amount: { value: s.amount }, usd: s.usd ?? null },
					}))),
					userBorrows: rows.flatMap(({ m, data }) => (data.borrows ?? []).map((b) => ({
						market: at(m), currency: { symbol: b.symbol }, debt: { amount: { value: b.amount }, usd: b.usd ?? null },
					}))),
				},
			});
		}

		if (query.includes('userSupplies')) {
			const chainId = Number(/chainId:\s*(\d+)/.exec(query)?.[1]);
			const address = /address:\s*"([^"]+)"/.exec(query)?.[1] ?? '';
			const chain = marketData(body.variables?.user, chainId, address);
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
		stateQueries: () => queries.filter((q) => q.includes('userMarketState')).length,
		stateRequests: () => [...stateRequests],
		restore: () => vi.unstubAllGlobals(),
	};
}
