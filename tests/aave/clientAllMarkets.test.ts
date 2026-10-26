import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { installFakeAaveApi, type FakeAave, type FakeAaveHandle } from '../helpers/fakeAaveApi';

/**
 * The portfolio total counts every Aave market, not just the main market on Ethereum, Polygon and Avalanche. A wallet
 * with a position in the Ethereum Lido market was short that position in its portfolio total even after the DeFi tin
 * showed it, because the total reads Aave through src/lib/aave/client.ts. The client now finds the wallet's other
 * markets from the same list the tin uses. The real client runs against a fake Aave API; every symbol, amount and
 * address here is invented.
 */
vi.mock('@/lib/db', () => ({
	db: {
		execute: async () => {
			throw new Error('the Aave client must not touch the database');
		},
	},
}));
vi.mock('@/lib/coinpaprikaProvider', () => ({ getTickersUSD: async () => [] }));

import { getAaveTotalsForWallet } from '../../src/lib/aave/client';
import { resetMarketListCache } from '../../src/lib/aave/accountHealth';

const ADDR = `0x${'2'.repeat(40)}`;
const LIDO = `0x${'c'.repeat(40)}`;

const polygon: FakeAave['chains'][number] = {
	supplies: [{ symbol: 'WBTC', amount: '0.3', usd: '20000', usdPerToken: '66666', isCollateral: true }],
	borrows: [{ symbol: 'USDC', amount: '10000', usd: '10000', usdPerToken: '1' }],
	state: { totalCollateralBase: '20000', totalDebtBase: '10000' },
};
const lido: FakeAave['extraMarkets'] = [{
	name: 'AaveV3EthereumLido',
	chainId: 1,
	address: LIDO,
	supplies: [{ symbol: 'wstETH', amount: '0.3', usd: '900', usdPerToken: '3000', isCollateral: true }],
	borrows: [{ symbol: 'USDC', amount: '400', usd: '400', usdPerToken: '1' }],
	state: { totalCollateralBase: '900', totalDebtBase: '400' },
}];

let api: FakeAaveHandle;
const serve = (fake: FakeAave) => {
	api = installFakeAaveApi(fake);
};

beforeEach(() => {
	resetMarketListCache();
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	api?.restore();
	vi.restoreAllMocks();
});

describe('the portfolio total counts every Aave market', () => {
	it('adds an Ethereum Lido position to the totals, next to Polygon', async () => {
		serve({ chains: { 137: polygon }, extraMarkets: lido });
		const totals = await getAaveTotalsForWallet(ADDR);
		expect(totals.suppliedUsdTotal).toBeCloseTo(20900, 6);
		expect(totals.debtUsdTotal).toBeCloseTo(10400, 6);
		const lidoSummary = totals.chains.find((c) => c.chain === 'ethereum_lido');
		expect(lidoSummary).toMatchObject({ ok: true, label: 'Ethereum Lido', network: 'ethereum', market: LIDO });
		expect(lidoSummary?.reported).toEqual({ totalCollateralUsd: 900, totalDebtUsd: 400 });
		expect(totals.coverage.partial).toBe(false);
		expect(totals.coverage.gaps).toEqual([]);
	});

	it('reads only the other markets with a position, after one bulk call', async () => {
		serve({ chains: { 137: polygon }, extraMarkets: [...lido!, { name: 'AaveV3Arbitrum', chainId: 42161, address: `0x${'d'.repeat(40)}` }] });
		const totals = await getAaveTotalsForWallet(ADDR);
		expect(totals.chains.map((c) => c.chain)).not.toContain('arbitrum');
		const bulk = api.positionQueries().filter((q) => q.includes('$markets'));
		expect(bulk).toHaveLength(1);
		// The Lido market is read in full like a main market (its own positions query with its address inline).
		expect(api.positionQueries().some((q) => q.includes(LIDO))).toBe(true);
	});

	it('adds nothing, and stays complete, for a wallet with positions only in the main markets', async () => {
		serve({ chains: { 137: polygon }, extraMarkets: [{ ...lido![0], supplies: [], borrows: [], state: undefined }] });
		const totals = await getAaveTotalsForWallet(ADDR);
		expect(totals.chains.map((c) => c.chain)).toEqual(['ethereum', 'polygon', 'avalanche', 'ethereum_v4']);
		expect(totals.suppliedUsdTotal).toBeCloseTo(20000, 6);
		expect(totals.coverage.partial).toBe(false);
	});

	it('asks each other market on its own when the bulk call fails', async () => {
		serve({ chains: { 137: polygon }, extraMarkets: lido, bulkPositionsFail: true });
		const totals = await getAaveTotalsForWallet(ADDR);
		expect(totals.suppliedUsdTotal).toBeCloseTo(20900, 6);
		expect(totals.coverage.partial).toBe(false);
	});

	it('says the total is partial when Aave cannot list its markets, and still counts the main ones', async () => {
		serve({ chains: { 137: polygon }, extraMarkets: lido, marketListFails: true });
		const totals = await getAaveTotalsForWallet(ADDR);
		expect(totals.suppliedUsdTotal).toBeCloseTo(20000, 6);
		expect(totals.coverage.partial).toBe(true);
		expect(totals.coverage.unavailableChains).toContain('other_markets');
	});

	it('says the total is partial when another market cannot be asked at all', async () => {
		serve({ chains: { 137: polygon }, extraMarkets: [{ ...lido![0], positionsHttpStatus: 502 }], bulkPositionsFail: true });
		const totals = await getAaveTotalsForWallet(ADDR);
		expect(totals.coverage.partial).toBe(true);
		expect(totals.coverage.unavailableChains).toContain('ethereum_lido');
	});
});

describe('net worth groups an extra market under its blockchain', () => {
	it('uses the summary\'s network (ethereum for Ethereum Lido) for the by-chain breakdown', () => {
		const src = readFileSync(path.resolve(__dirname, '../../src/lib/networth.ts'), 'utf8');
		expect(src).toMatch(/chain: chain\.network \?\? chain\.chain,/);
		expect(src).toMatch(/const chainKey = chain\.network \?\? chain\.chain;/);
	});
});
