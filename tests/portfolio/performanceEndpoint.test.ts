import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AaveCoverage } from '../../src/lib/aave/pricing';
import { emptyCoverage } from '../../src/lib/aave/pricing';

/**
 * GET /api/portfolio/performance, the Portfolio page's data. It had no tests.
 *
 * The Aave client is a stub that hands back priced positions, so these tests are about what the endpoint
 * does with them: Aave supply joins the wallet holdings, genuine dust stays hidden, and a position no price
 * source could value is reported (and the figures marked partial), never dropped as if it were dust.
 *
 * Hermetic: the session, the database, the cache and the Aave client are stubs. Every symbol, amount and
 * price is invented.
 */
const state = vi.hoisted(() => ({
	session: { tenantId: 'tenant-0' } as null | { tenantId: string },
	snapshots: [] as Array<{ payload_json: string }>,
	wallets: [] as Array<{ address: string }>,
	lifecycle: [] as Array<{ asset_symbol: string; weighted_avg_cost_usd: number; latest_acquired_at: string | null }>,
	aave: vi.fn(),
	cachedKeys: [] as string[],
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string }) => {
			if (/FROM wallet_snapshots ws/.test(stmt.sql)) return { rows: state.snapshots };
			if (/FROM wallets/.test(stmt.sql)) return { rows: state.wallets };
			if (/FROM asset_lifecycle_groups/.test(stmt.sql)) return { rows: state.lifecycle };
			throw new Error(`unexpected query: ${stmt.sql.slice(0, 60)}`);
		},
	},
}));
vi.mock('@/lib/tursoCache', () => ({
	getCache: async () => ({ value: null, isStale: false }),
	setCache: async (key: string) => {
		state.cachedKeys.push(key);
	},
}));
vi.mock('@/lib/aave/client', () => ({ getAaveTotalsForWallet: state.aave }));

import { GET } from '../../src/pages/api/portfolio/performance';

let tenantCounter = 0;
const call = async () => {
	// A fresh tenant per call: the endpoint keeps a per-tenant in-memory cache.
	tenantCounter += 1;
	state.session = { tenantId: `tenant-${tenantCounter}` };
	const res = await (GET as any)({ request: new Request('https://almstins.test/api/portfolio/performance') });
	return { status: res.status, body: await res.json() };
};

const snapshot = (tokens: Array<Record<string, unknown>>) => ({ payload_json: JSON.stringify(tokens) });
const supply = (assetSymbol: string, amount: number, usdValue: number, priceSource: 'aave' | 'market' | 'none' = 'aave') => ({
	side: 'supply' as const,
	marketName: 'FakeMarket',
	assetSymbol,
	amount,
	apy: 0.02,
	usdValue,
	priceSource,
});
const totalsWith = (positions: ReturnType<typeof supply>[], coverage: AaveCoverage = emptyCoverage()) => ({
	ok: true,
	chains: [{ chain: 'ethereum', ok: true, positions, suppliedUsd: 0, debtUsd: 0, suppliedUsdTotal: 0, debtUsdTotal: 0 }],
	suppliedUsdTotal: 0,
	debtUsdTotal: 0,
	suppliedUsd: 0,
	debtUsd: 0,
	coverage,
});

beforeEach(() => {
	state.snapshots = [snapshot([{ symbol: 'ZED', amount: 10, priceUsd: 100, valueUsd: 1000 }])];
	state.wallets = [{ address: `0x${'2'.repeat(40)}` }];
	state.lifecycle = [];
	state.cachedKeys = [];
	state.aave.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('GET /api/portfolio/performance', () => {
	it('says nothing is wrong when every Aave position is priced', async () => {
		state.aave.mockResolvedValue(totalsWith([supply('WBTC', 0.5, 30000)]));
		const { status, body } = await call();
		expect(status).toBe(200);
		expect(body.summary.partial).toBe(false);
		expect(body.summary.unpricedCount).toBe(0);
		expect(body.unpricedAave).toEqual([]);
		const wbtc = body.assets.find((a: any) => a.symbol === 'WBTC');
		expect(wbtc).toMatchObject({ quantity: 0.5, currentValue: 30000, isCollateral: true });
		expect(body.summary.totalCurrentValue).toBe(31000);
	});

	it('adds Aave supply to a wallet holding of the same coin', async () => {
		state.aave.mockResolvedValue(totalsWith([supply('ZED', 4, 400)]));
		const { body } = await call();
		const zed = body.assets.find((a: any) => a.symbol === 'ZED');
		expect(zed).toMatchObject({ quantity: 14, currentValue: 1400, isCollateral: true });
	});

	it('keeps genuine dust (priced under $1) hidden', async () => {
		state.aave.mockResolvedValue(totalsWith([supply('ZEE', 0.0001, 0.4)]));
		const { body } = await call();
		expect(body.assets.map((a: any) => a.symbol)).not.toContain('ZEE');
		expect(body.summary.partial).toBe(false);
	});

	it('reports a position no price source could value, instead of dropping it as dust', async () => {
		const coverage: AaveCoverage = {
			...emptyCoverage(),
			partial: true,
			unpricedCount: 2,
			unpriced: [
				{ chain: 'ethereum', side: 'supply', symbol: 'ZEF', amount: 5 },
				{ chain: 'ethereum', side: 'supply', symbol: 'ZEG', amount: 9 },
			],
		};
		state.aave.mockResolvedValue(totalsWith([supply('ZEF', 5, 0, 'none'), supply('ZEG', 9, 0, 'none')], coverage));
		const { body } = await call();
		expect(body.summary.partial).toBe(true);
		expect(body.summary.unpricedCount).toBe(2);
		expect(body.unpricedAave.map((u: any) => u.symbol)).toEqual(['ZEF', 'ZEG']);
		// Not folded into the table as a $0 row either: the figures are the priced ones.
		expect(body.assets.map((a: any) => a.symbol)).toEqual(['ZED']);
		expect(body.summary.totalCurrentValue).toBe(1000);
	});

	it('still reports an unpriced position when nothing else is held', async () => {
		state.snapshots = [];
		const coverage: AaveCoverage = {
			...emptyCoverage(),
			partial: true,
			unpricedCount: 1,
			unpriced: [{ chain: 'polygon', side: 'supply', symbol: 'ZEF', amount: 5 }],
		};
		state.aave.mockResolvedValue(totalsWith([supply('ZEF', 5, 0, 'none')], coverage));
		const { body } = await call();
		expect(body.assets).toEqual([]);
		expect(body.summary).toMatchObject({ partial: true, unpricedCount: 1, totalCurrentValue: 0 });
		expect(body.unpricedAave).toHaveLength(1);
	});

	it('marks the figures partial when the Aave lookup fails, and still loads the wallet holdings', async () => {
		state.aave.mockRejectedValue(new Error('aave down'));
		const { status, body } = await call();
		expect(status).toBe(200);
		expect(body.summary.partial).toBe(true);
		expect(body.summary.unpricedCount).toBe(0);
		expect(body.assets.map((a: any) => a.symbol)).toEqual(['ZED']);
	});

	it('marks the figures partial when Aave reports a chain it could not look up', async () => {
		state.aave.mockResolvedValue(
			totalsWith([], { ...emptyCoverage(), partial: true, unavailableChains: ['polygon'] }),
		);
		const { body } = await call();
		expect(body.summary.partial).toBe(true);
		expect(body.summary.unpricedCount).toBe(0);
	});

	it('merges the coverage of every wallet', async () => {
		state.wallets = [{ address: `0x${'2'.repeat(40)}` }, { address: `0x${'3'.repeat(40)}` }];
		state.aave
			.mockResolvedValueOnce(totalsWith([]))
			.mockResolvedValueOnce(
				totalsWith([], {
					...emptyCoverage(),
					partial: true,
					unpricedCount: 1,
					unpriced: [{ chain: 'avalanche', side: 'supply', symbol: 'ZEF', amount: 1 }],
				}),
			);
		const { body } = await call();
		expect(state.aave).toHaveBeenCalledTimes(2);
		expect(body.summary).toMatchObject({ partial: true, unpricedCount: 1 });
	});

	it('refuses an anonymous request before it touches Aave', async () => {
		state.session = null;
		const res = await (GET as any)({ request: new Request('https://almstins.test/api/portfolio/performance') });
		expect(res.status).toBe(401);
		expect(state.aave).not.toHaveBeenCalled();
	});

	it('caches under a key that cannot return a payload from before partial totals existed', async () => {
		state.aave.mockResolvedValue(totalsWith([]));
		await call();
		expect(state.cachedKeys).toHaveLength(1);
		expect(state.cachedKeys[0]).toMatch(/:portfolio:performance:v8$/);
	});
});
