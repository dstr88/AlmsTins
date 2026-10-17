import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AaveCoverage } from '../../src/lib/aave/pricing';
import { emptyCoverage } from '../../src/lib/aave/pricing';

/**
 * GET /api/portfolio/reconciliation, the panel that compares what the transaction history says you hold with
 * what the wallets (and Aave) report. It had no tests.
 *
 * The threshold hides small holdings. It must never hide a holding whose value is UNKNOWN: Aave supply no
 * price source could value used to come back as $0 and vanish under the default $50 threshold.
 *
 * Hermetic: the session, the database, the cache and the Aave client are stubs. Every symbol, amount and
 * price is invented.
 */
const state = vi.hoisted(() => ({
	session: { tenantId: 'tenant-1' } as null | { tenantId: string },
	lifecycle: [] as Array<{ asset_symbol: string; net_qty: number }>,
	snapshots: [] as Array<{ payload_json: string }>,
	wallets: [] as Array<{ address: string }>,
	aave: vi.fn(),
	cached: null as null | { value: unknown; isStale: boolean },
	written: [] as Array<{ key: string; payload: any }>,
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/db', () => ({
	db: {
		execute: async (stmt: { sql: string }) => {
			if (/FROM asset_lifecycle_groups/.test(stmt.sql)) return { rows: state.lifecycle };
			if (/FROM wallet_snapshots ws/.test(stmt.sql)) return { rows: state.snapshots };
			if (/FROM wallets/.test(stmt.sql)) return { rows: state.wallets };
			throw new Error(`unexpected query: ${stmt.sql.slice(0, 60)}`);
		},
	},
}));
vi.mock('@/lib/tursoCache', () => ({
	getCache: async () => state.cached ?? { value: null, isStale: false },
	setCache: async (key: string, payload: unknown) => {
		state.written.push({ key, payload });
	},
}));
vi.mock('@/lib/aave/client', () => ({ getAaveTotalsForWallet: state.aave }));

import { GET } from '../../src/pages/api/portfolio/reconciliation';

const call = async (query = '') => {
	const res = await (GET as any)({ request: new Request(`https://almstins.test/api/portfolio/reconciliation${query}`) });
	return { status: res.status, body: res.status === 200 ? await res.json() : null };
};

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
const unpricedCoverage = (symbol: string): AaveCoverage => ({
	...emptyCoverage(),
	partial: true,
	unpricedCount: 1,
	unpriced: [{ chain: 'ethereum', side: 'supply', symbol, amount: 1 }],
});

beforeEach(() => {
	state.session = { tenantId: 'tenant-1' };
	state.lifecycle = [{ asset_symbol: 'ZED', net_qty: 10 }];
	state.snapshots = [{ payload_json: JSON.stringify([{ symbol: 'ZED', amount: 10, valueUsd: 1000 }]) }];
	state.wallets = [{ address: `0x${'2'.repeat(40)}` }];
	state.cached = null;
	state.written = [];
	state.aave.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('GET /api/portfolio/reconciliation', () => {
	it('keeps Aave supply that could not be priced visible under the default threshold, marked as unpriced', async () => {
		state.aave.mockResolvedValue(totalsWith([supply('ZEF', 5, 0, 'none')], unpricedCoverage('ZEF')));
		const { body } = await call();
		const zef = body.items.find((i: any) => i.symbol === 'ZEF');
		expect(zef).toMatchObject({ snapQty: 5, snapValueUsd: 0, valueUnpriced: true });
		expect(body.partial).toBe(true);
		expect(body.unpricedCount).toBe(1);
		// The priced holding is there as before, not marked.
		expect(body.items.find((i: any) => i.symbol === 'ZED').valueUnpriced).toBeUndefined();
	});

	it('still hides a priced holding below the threshold', async () => {
		state.aave.mockResolvedValue(totalsWith([supply('ZEE', 2, 12.5)]));
		const { body } = await call();
		expect(body.items.map((i: any) => i.symbol)).not.toContain('ZEE');
		expect(body.partial).toBe(false);
		expect(body.unpricedCount).toBe(0);
	});

	it('counts a priced Aave supply toward the threshold, so Aave-only collateral shows up', async () => {
		state.aave.mockResolvedValue(totalsWith([supply('ZEH', 0.5, 30000)]));
		const { body } = await call();
		expect(body.items.find((i: any) => i.symbol === 'ZEH')).toMatchObject({ snapQty: 0.5, snapValueUsd: 30000 });
	});

	it('flags a coin that is part wallet-held (priced) and part unpriced Aave supply', async () => {
		state.aave.mockResolvedValue(totalsWith([supply('ZED', 3, 0, 'none')], unpricedCoverage('ZED')));
		const { body } = await call();
		expect(body.items.find((i: any) => i.symbol === 'ZED')).toMatchObject({
			snapQty: 13,
			snapValueUsd: 1000,
			valueUnpriced: true,
		});
	});

	it('marks the response partial when the Aave lookup fails, and still answers from the wallets', async () => {
		state.aave.mockRejectedValue(new Error('aave down'));
		const { status, body } = await call();
		expect(status).toBe(200);
		expect(body.partial).toBe(true);
		expect(body.unpricedCount).toBe(0);
		expect(body.items.map((i: any) => i.symbol)).toEqual(['ZED']);
	});

	it('stores every row with its flags, and applies the threshold only when answering', async () => {
		state.aave.mockResolvedValue(totalsWith([supply('ZEE', 2, 12.5), supply('ZEF', 5, 0, 'none')], unpricedCoverage('ZEF')));
		const { body } = await call('?threshold=0');
		expect(body.items.map((i: any) => i.symbol).sort()).toEqual(['ZED', 'ZEE', 'ZEF']);
		const stored = state.written[0];
		expect(stored.key).toMatch(/:portfolio:reconciliation:v4$/);
		expect(stored.payload.partial).toBe(true);
		expect(stored.payload.items.find((i: any) => i.symbol === 'ZEF').valueUnpriced).toBe(true);
	});

	it('answers from the cache with the same rule: the threshold is applied again, the unpriced flag survives', async () => {
		state.cached = {
			isStale: false,
			value: {
				updatedAt: '2026-01-01T00:00:00.000Z',
				partial: true,
				unpricedCount: 1,
				items: [
					{ symbol: 'ZED', txQty: 10, snapQty: 10, snapValueUsd: 1000, match: true, delta: 0 },
					{ symbol: 'ZEE', txQty: 0, snapQty: 2, snapValueUsd: 12.5, match: false, delta: 2 },
					{ symbol: 'ZEF', txQty: 0, snapQty: 5, snapValueUsd: 0, match: false, delta: 5, valueUnpriced: true },
				],
			},
		};
		const { body } = await call();
		expect(body.cached).toBe(true);
		expect(body.items.map((i: any) => i.symbol)).toEqual(['ZED', 'ZEF']);
		expect(body.partial).toBe(true);
		expect(body.unpricedCount).toBe(1);
		expect(state.aave).not.toHaveBeenCalled();
	});

	it('reads a cached payload from before partial totals existed as complete, not as an error', async () => {
		state.cached = {
			isStale: false,
			value: {
				updatedAt: '2026-01-01T00:00:00.000Z',
				items: [{ symbol: 'ZED', txQty: 10, snapQty: 10, snapValueUsd: 1000, match: true, delta: 0 }],
			},
		};
		const { status, body } = await call();
		expect(status).toBe(200);
		expect(body.partial).toBe(false);
		expect(body.unpricedCount).toBe(0);
	});

	it('refuses an anonymous request before it touches Aave', async () => {
		state.session = null;
		const { status } = await call();
		expect(status).toBe(401);
		expect(state.aave).not.toHaveBeenCalled();
	});
});
