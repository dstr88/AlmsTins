import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installFakeAaveApi, type FakeAave, type FakeAaveHandle } from '../helpers/fakeAaveApi';

/**
 * The Vault's headline numbers: getLatestNetWorthSummary (src/lib/networth.ts) and GET /api/networth/summary,
 * which feed the Vault tile and the net worth page. They had no tests.
 *
 * The first block runs the REAL Aave client against a fake Aave API, so it covers the regression end to end:
 * an account whose collateral priced at $0 used to read as deeply negative, because those supplies were
 * dropped while the debt was counted in full.
 *
 * Hermetic: the session, the database, the cache, the price feed and Aave are stubs. Every symbol, amount,
 * address and price is invented.
 */
const state = vi.hoisted(() => ({
	session: { tenantId: 'tenant-0' } as null | { tenantId: string },
	snapshotRows: [] as Array<Record<string, unknown>>,
	capturedRows: [] as Array<Record<string, unknown>>,
	walletCount: 0,
	exchangeCount: 0,
	written: [] as Array<{ key: string; payload: any }>,
	feed: [] as unknown[],
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: async () => state.session }));
vi.mock('@/lib/db', () => ({
	db: {
		// getLatestNetWorthSummary passes (sql, args); the other callers pass { sql, args }.
		execute: async (stmt: string | { sql: string }) => {
			const sql = typeof stmt === 'string' ? stmt : stmt.sql;
			if (/totals_usd AS "totalsUsd"/.test(sql)) return { rows: state.snapshotRows };
			if (/SELECT chain, MAX\(captured_at\)/.test(sql)) return { rows: state.capturedRows };
			if (/COUNT\(\*\) as count FROM wallets/.test(sql)) return { rows: [{ count: state.walletCount }] };
			if (/COUNT\(\*\) as count FROM exchange_accounts/.test(sql)) return { rows: [{ count: state.exchangeCount }] };
			throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
		},
	},
}));
vi.mock('@/lib/tursoCache', () => ({
	getCache: async () => ({ value: null, isStale: false }),
	setCache: async (key: string, payload: unknown) => {
		state.written.push({ key, payload });
	},
}));
vi.mock('@/lib/cacheLock', () => ({ tryAcquireLock: async () => true }));
vi.mock('@/lib/repriceMissingWalletTokens', () => ({ repriceMissingWalletTokens: async () => ({}) }));
vi.mock('@/lib/coinpaprikaProvider', () => ({ getTickersUSD: async () => state.feed }));

import { getLatestNetWorthSummary } from '../../src/lib/networth';
import { normalizeNetWorthSummary } from '../../src/lib/networth/summaryContract';
import { GET } from '../../src/pages/api/networth/summary';

const WALLET_A = `0x${'a'.repeat(40)}`;
const WALLET_B = `0x${'b'.repeat(40)}`;
const AVALANCHE = 43114;
const POLYGON = 137;

const snapshot = (walletId: string, label: string, address: string, chain: string, totalsUsd: number) => ({
	walletId,
	walletLabel: label,
	walletAddress: address,
	chain,
	totalsUsd,
	capturedAt: '2026-01-01T00:00:00.000Z',
});

// Wallet A: collateral in several assets plus one supply that is not collateral, against a stablecoin loan.
const healthyA = {
	supplies: [
		{ symbol: 'WBTC', amount: '0.1', usd: '6100', usdPerToken: '61000', isCollateral: true },
		{ symbol: 'BTC.b', amount: '0.05', usd: '3050', usdPerToken: '61000', isCollateral: true },
		{ symbol: 'sAVAX', amount: '40', usd: '1100', usdPerToken: '27.5', isCollateral: false },
	],
	borrows: [{ symbol: 'USDt', amount: '4000', usd: '4000', usdPerToken: '1' }],
	state: { totalCollateralBase: '9150', totalDebtBase: '4000' } as const,
};
const healthyB = {
	supplies: [{ symbol: 'ZED', amount: '1', usd: '2600', usdPerToken: '2600', isCollateral: true }],
	borrows: [{ symbol: 'USDC', amount: '900', usd: '900', usdPerToken: '1' }],
	state: { totalCollateralBase: '2600', totalDebtBase: '900' } as const,
};

let api: FakeAaveHandle;
const serve = (fake: FakeAave) => {
	api = installFakeAaveApi(fake);
};

let tenantCounter = 0;
const fetchSummary = async () => {
	tenantCounter += 1; // the route keeps a per-tenant in-memory cache
	state.session = { tenantId: `tenant-${tenantCounter}` };
	const res = await (GET as any)({ request: new Request('https://almstins.test/api/networth/summary'), locals: {} });
	return { status: res.status, body: await res.json() };
};

beforeEach(() => {
	state.session = { tenantId: 'tenant-0' };
	state.snapshotRows = [
		snapshot('w-a', 'Tin A', WALLET_A, 'avalanche', 800),
		snapshot('w-b', 'Tin B', WALLET_B, 'polygon', 450),
	];
	state.capturedRows = [{ chain: 'avalanche', captured_at: '2026-01-01T00:00:00.000Z' }];
	state.walletCount = 2;
	state.exchangeCount = 0;
	state.written = [];
	state.feed = [];
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	api?.restore();
	vi.restoreAllMocks();
});

describe('getLatestNetWorthSummary: unpriced collateral, end to end', () => {
	it('counts every valued supply as an asset, so collateral nets against the loan', async () => {
		serve({
			chains: {},
			users: {
				[WALLET_A]: { [AVALANCHE]: healthyA },
				[WALLET_B]: { [POLYGON]: healthyB },
			},
		});
		const summary = await getLatestNetWorthSummary('tenant-x');
		const [a, b] = summary.tins!;
		expect(a).toMatchObject({ tinId: 'w-a', assetsUsd: 800 + 10250, debtUsd: 4000, netUsd: 7050 });
		expect(b).toMatchObject({ tinId: 'w-b', assetsUsd: 450 + 2600, debtUsd: 900, netUsd: 2150 });
		expect(summary.totalAssetsUsd).toBe(14100);
		expect(summary.totalDebtUsd).toBe(4900);
		expect(summary.totalAssetsUsd - summary.totalDebtUsd).toBeGreaterThan(0);
		expect(summary.aaveIncluded).toBe(true);
	});

	it('does not mark a fully priced total as partial', async () => {
		serve({ chains: {}, users: { [WALLET_A]: { [AVALANCHE]: healthyA }, [WALLET_B]: { [POLYGON]: healthyB } } });
		const summary = await getLatestNetWorthSummary('tenant-x');
		expect(summary.partial).toBe(false);
		expect(summary.unpricedCount).toBe(0);
		expect(summary.tins!.every((t) => t.partial === false && t.unpricedCount === 0)).toBe(true);
	});

	it('marks the total and the tin partial when a position cannot be priced, instead of counting it as $0', async () => {
		serve({
			chains: {},
			users: {
				[WALLET_A]: {
					[AVALANCHE]: {
						// No USD figure from Aave and no ticker in the feed: nothing can value the staking token.
						supplies: [
							{ symbol: 'WBTC', amount: '0.1', usd: '6100', usdPerToken: '61000', isCollateral: true },
							{ symbol: 'sAVAX', amount: '40' },
						],
						state: 'fail',
					},
				},
				[WALLET_B]: { [POLYGON]: healthyB },
			},
		});
		const summary = await getLatestNetWorthSummary('tenant-x');
		const [a, b] = summary.tins!;
		expect(a).toMatchObject({ assetsUsd: 6900, partial: true, unpricedCount: 1 });
		expect(b).toMatchObject({ partial: false, unpricedCount: 0 });
		expect(summary.partial).toBe(true);
		expect(summary.unpricedCount).toBe(1);
	});

	it('marks the total partial when a chain\'s Aave lookup failed', async () => {
		serve({
			chains: {},
			users: { [WALLET_A]: { [AVALANCHE]: { positionsHttpStatus: 500 } }, [WALLET_B]: { [POLYGON]: healthyB } },
		});
		const summary = await getLatestNetWorthSummary('tenant-x');
		expect(summary.partial).toBe(true);
		expect(summary.unpricedCount).toBe(0);
		expect(summary.tins![0]).toMatchObject({ partial: true });
		expect(summary.tins![1]).toMatchObject({ partial: false });
	});
});

describe('GET /api/networth/summary', () => {
	it('passes partial and the unpriced count through to the page, per tin and overall', async () => {
		serve({
			chains: {},
			users: {
				[WALLET_A]: { [AVALANCHE]: { supplies: [{ symbol: 'sAVAX', amount: '40' }], state: 'fail' } },
				[WALLET_B]: { [POLYGON]: healthyB },
			},
		});
		const { status, body } = await fetchSummary();
		expect(status).toBe(200);
		expect(body.summary.partial).toBe(true);
		expect(body.summary.unpricedCount).toBe(1);
		const byId = Object.fromEntries(body.summary.tins.map((t: any) => [t.tinId, t]));
		expect(byId['w-a']).toMatchObject({ partial: true, unpricedCount: 1 });
		expect(byId['w-b']).toMatchObject({ partial: false, unpricedCount: 0 });
	});

	it('says a complete total is complete', async () => {
		serve({ chains: {}, users: { [WALLET_A]: { [AVALANCHE]: healthyA }, [WALLET_B]: { [POLYGON]: healthyB } } });
		const { body } = await fetchSummary();
		expect(body.summary).toMatchObject({ partial: false, unpricedCount: 0, totalAssetsUsd: 14100, totalDebtUsd: 4900 });
	});

	it('caches under a key that cannot return a summary from before partial totals existed', async () => {
		serve({ chains: {} });
		await fetchSummary();
		expect(state.written).toHaveLength(1);
		expect(state.written[0].key).toMatch(/:networth:summary:v5$/);
		expect(state.written[0].payload.summary.partial).toBe(false);
	});

	it('refuses an anonymous request', async () => {
		state.session = null;
		const res = await (GET as any)({ request: new Request('https://almstins.test/api/networth/summary'), locals: {} });
		expect(res.status).toBe(401);
	});
});

describe('normalizeNetWorthSummary: the partial fields', () => {
	it('carries partial and the unpriced count, per tin and overall', () => {
		const out = normalizeNetWorthSummary({
			summary: {
				totalAssetsUsd: 10,
				partial: true,
				unpricedCount: 3,
				tins: [{ tinId: 't1', tinName: 'Tin', assetsUsd: 10, debtUsd: 0, partial: true, unpricedCount: 2 }],
			},
		});
		expect(out.partial).toBe(true);
		expect(out.unpricedCount).toBe(3);
		expect(out.tins[0]).toMatchObject({ partial: true, unpricedCount: 2 });
	});

	it('reads a summary from before these fields existed as complete', () => {
		const out = normalizeNetWorthSummary({ summary: { totalAssetsUsd: 10, tins: [{ tinId: 't1', tinName: 'Tin', assetsUsd: 10 }] } });
		expect(out.partial).toBe(false);
		expect(out.unpricedCount).toBe(0);
		expect(out.tins[0]).toMatchObject({ partial: false, unpricedCount: 0 });
	});

	it('only ever says partial for an actual true, and never produces a negative, fractional or NaN count', () => {
		for (const bad of ['true', 1, 'yes', null, undefined, {}]) {
			expect(normalizeNetWorthSummary({ summary: { partial: bad } }).partial, String(bad)).toBe(false);
		}
		expect(normalizeNetWorthSummary({ summary: { unpricedCount: -4 } }).unpricedCount).toBe(0);
		expect(normalizeNetWorthSummary({ summary: { unpricedCount: 'abc' } }).unpricedCount).toBe(0);
		expect(normalizeNetWorthSummary({ summary: { unpricedCount: 2.9 } }).unpricedCount).toBe(2);
		expect(normalizeNetWorthSummary({ summary: { unpricedCount: '5' } }).unpricedCount).toBe(5);
	});
});
