import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeAccountHealth, listAaveMarkets, resetMarketListCache, type GraphQLPost } from '../../src/lib/aave/accountHealth';
import { marketKey, marketLabel } from '../../src/lib/aave/markets';

/**
 * GET /api/aave/health checks every Aave V3 market, not just the main market on Ethereum, Polygon and
 * Avalanche. The case that found it: a wallet with a Polygon position and an Ethereum Lido position;
 * the tin showed only Polygon and the liquidation email never watched Lido. Aave's API is a
 * stand-in here, answering by query name, so nothing touches the network.
 */

const USER = '0x' + 'ab'.repeat(20);
const POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'; // the same address on Polygon, Avalanche, Arbitrum, Optimism
const LIDO = '0x4e033931ad43597d96D6bcc25c280717730B58B1';
const MAIN = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';

const MARKETS = [
	{ name: 'AaveV3Ethereum', address: MAIN, chain: { chainId: 1 } },
	{ name: 'AaveV3EthereumLido', address: LIDO, chain: { chainId: 1 } },
	{ name: 'AaveV3Polygon', address: POOL, chain: { chainId: 137 } },
	{ name: 'AaveV3Avalanche', address: POOL, chain: { chainId: 43114 } },
];

const at = (address: string, chainId: number) => ({ address, chain: { chainId } });
const SUPPLIES = [
	{ market: at(POOL, 137), currency: { symbol: 'WBTC' }, balance: { amount: { value: '0.3494' }, usd: '27943.22' } },
	{ market: at(LIDO, 1), currency: { symbol: 'wstETH' }, balance: { amount: { value: '0.3211' }, usd: '922.25' } },
];
const BORROWS = [
	{ market: at(POOL, 137), currency: { symbol: 'USDC' }, debt: { amount: { value: '14920.42' }, usd: '14920.42' } },
	{ market: at(LIDO, 1), currency: { symbol: 'USDC' }, debt: { amount: { value: '401.38' }, usd: '401.38' } },
];
const STATE: Record<string, { healthFactor: string; totalCollateralBase: string; totalDebtBase: string }> = {
	[`137:${POOL}`]: { healthFactor: '1.5098', totalCollateralBase: '28824.33', totalDebtBase: '14920.42' },
	[`1:${LIDO}`]: { healthFactor: '1.9070', totalCollateralBase: '922.25', totalDebtBase: '401.38' },
};

type Options = { bulkFails?: boolean; chainsFail?: boolean };

function fakeAave(opts: Options = {}) {
	const calls: Array<{ name: string; variables: any }> = [];
	const post: GraphQLPost = async (query, vars) => {
		const variables = vars as any;
		const name = /query (\w+)/.exec(query)?.[1] ?? '?';
		calls.push({ name, variables });
		const ok = (data: unknown) => ({ ok: true, status: 200, json: { data } });
		if (name === 'Chains') {
			if (opts.chainsFail) return { ok: false, status: 503, json: {} };
			return ok({ chains: [{ chainId: 1, isTestnet: false }, { chainId: 137, isTestnet: false }, { chainId: 43114, isTestnet: false }, { chainId: 84532, isTestnet: true }] });
		}
		if (name === 'Markets') return ok({ markets: MARKETS.filter((m) => variables.chainIds.includes(m.chain.chainId)) });
		if (name === 'UserPositions') {
			const asked: Array<{ address: string; chainId: number }> = variables.markets;
			if (opts.bulkFails && asked.length > 1) return { ok: true, status: 200, json: { errors: [{ message: 'too many markets' }] } };
			const inAsked = (r: any) => asked.some((m) => m.address === r.market.address && m.chainId === r.market.chain.chainId);
			return ok({ userSupplies: SUPPLIES.filter(inAsked), userBorrows: BORROWS.filter(inAsked) });
		}
		if (name === 'UserMarketState') {
			const { chainId, market } = variables.request;
			return ok({ userMarketState: STATE[`${chainId}:${market}`] ?? { healthFactor: null, totalCollateralBase: '0', totalDebtBase: '0' } });
		}
		throw new Error(`unexpected query ${name}`);
	};
	return { post, calls };
}

beforeEach(() => {
	resetMarketListCache();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('every Aave market', () => {
	it('finds both positions of a Polygon + Ethereum Lido wallet', async () => {
		const { post } = fakeAave();
		const r = await computeAccountHealth(USER, post);
		expect(Object.keys(r.chains).sort()).toEqual(['ethereum_lido', 'polygon']);
		expect(r.chains.ethereum_lido).toMatchObject({
			chainId: 1, market: LIDO, marketName: 'AaveV3EthereumLido', label: 'Ethereum Lido',
			healthFactor: '1.9070', totalCollateralBase: '922.25', totalDebtBase: '401.38',
		});
		expect(r.chains.ethereum_lido.userSupplies).toEqual([
			{ currency: { symbol: 'wstETH' }, balance: { amount: { value: '0.3211' } }, balanceUsd: 922.25 },
		]);
		expect(r.chains.polygon).toMatchObject({ label: 'Polygon', healthFactor: '1.5098' });
		expect(r.chains.polygon.userBorrows[0]).toMatchObject({ currency: { symbol: 'USDC' }, debtUsd: 14920.42 });
	});

	it('keeps rows apart when two chains share a pool address', async () => {
		const { post } = fakeAave();
		const r = await computeAccountHealth(USER, post);
		// Avalanche's pool has Polygon's address; Polygon's rows must not land on Avalanche.
		expect(r.chains.avalanche).toBeUndefined();
		expect(r.chains.polygon.userSupplies.map((s) => s.currency.symbol)).toEqual(['WBTC']);
	});

	it('asks for every position in one call and for health only where there is a position', async () => {
		const { post, calls } = fakeAave();
		await computeAccountHealth(USER, post);
		expect(calls.filter((c) => c.name === 'UserPositions')).toHaveLength(1);
		expect(calls.find((c) => c.name === 'UserPositions')!.variables.markets).toHaveLength(MARKETS.length);
		expect(calls.filter((c) => c.name === 'UserMarketState').map((c) => c.variables.request.market).sort()).toEqual([LIDO, POOL].sort());
	});

	it('leaves testnets out of the market list', async () => {
		const { post, calls } = fakeAave();
		await listAaveMarkets(post);
		expect(calls.find((c) => c.name === 'Markets')!.variables.chainIds).toEqual([1, 137, 43114]);
	});

	it('keeps the market list for a while instead of asking every time', async () => {
		const { post, calls } = fakeAave();
		await computeAccountHealth(USER, post);
		await computeAccountHealth(USER, post);
		expect(calls.filter((c) => c.name === 'Markets')).toHaveLength(1);
	});

	it('asks each market on its own when the bulk call fails', async () => {
		const { post, calls } = fakeAave({ bulkFails: true });
		const r = await computeAccountHealth(USER, post);
		expect(Object.keys(r.chains).sort()).toEqual(['ethereum_lido', 'polygon']);
		expect(calls.filter((c) => c.name === 'UserPositions')).toHaveLength(1 + MARKETS.length);
	});

	it('falls back to the three main markets when Aave cannot list its markets', async () => {
		const { post } = fakeAave({ chainsFail: true });
		const markets = await listAaveMarkets(post);
		expect(markets.map((m) => m.name)).toEqual(['AaveV3Ethereum', 'AaveV3Polygon', 'AaveV3Avalanche']);
		const r = await computeAccountHealth(USER, post);
		expect(Object.keys(r.chains)).toEqual(['polygon']);
	});
});

describe('market keys and labels', () => {
	it('the main markets keep the keys they always had', () => {
		expect(['AaveV3Ethereum', 'AaveV3Polygon', 'AaveV3Avalanche'].map(marketKey)).toEqual(['ethereum', 'polygon', 'avalanche']);
	});

	it('names every live market readably', () => {
		expect(marketLabel('AaveV3EthereumLido')).toBe('Ethereum Lido');
		expect(marketKey('AaveV3EthereumLido')).toBe('ethereum_lido');
		expect(marketLabel('AaveV3EthereumEtherFi')).toBe('Ethereum EtherFi');
		expect(marketLabel('AaveV3EthereumHorizon')).toBe('Ethereum Horizon');
		expect(marketLabel('AaveV3BNB')).toBe('BNB Chain');
		expect(marketLabel('AaveV3ZkSync')).toBe('zkSync');
		expect(marketLabel('AaveV3XLayer')).toBe('X Layer');
		expect(marketLabel('AaveV3MegaETH')).toBe('MegaETH');
	});

	it('a market Aave adds later still gets a readable name', () => {
		expect(marketLabel('AaveV3SomeNewChain')).toBe('Some New Chain');
		expect(marketKey('AaveV3SomeNewChain')).toBe('some_new_chain');
	});
});
