import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: real tokens went missing from a wallet's Ethereum and Polygon snapshots.
 *
 * - Sync Tins wrote the snapshot from a short hand-kept contract list (no AAVE, BAND or WPOL,
 *   and Polygon WBTC's address was one character short), while the wallet card's refresh read
 *   only the first page of Alchemy's ERC-20 list and no native coin. Both now share
 *   discoverEvmBalances, which reads every page.
 * - The reader dropped any symbol off its own short list (BAND, WPOL) even when the contract
 *   is the known-good one.
 *
 * All addresses are public token contracts or invented; all amounts are invented.
 */

const WALLET = '0x000000000000000000000000000000000000a11c';

const AAVE = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';
const BAND = '0xba11d00c5f74255f56a5e366f4f77f5a186d7f55';
const LINK = '0x514910771af9ca656af840dff83e8264ecf986ca';
const ETH_WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const FAKE_AAVE = '0x00000000000000000000000000000000000fa4e1';
const POLY_WBTC = '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6';
const WPOL = '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270';

const hex = (n: bigint) => '0x' + n.toString(16);
const spamContract = (i: number) => '0x' + (0xdead0000 + i).toString(16).padStart(40, '0');

type Page = { tokenBalances: Array<{ contractAddress: string; tokenBalance: string }>; pageKey?: string };
type Meta = { decimals: number; symbol: string | null; name: string | null };

const alchemy = vi.hoisted(() => ({
	pages: new Map<string, Page[]>(),
	metadata: new Map<string, Meta>(),
	failMetadata: new Set<string>(),
	native: new Map<string, bigint>(),
	pageCalls: [] as Array<string | undefined>,
}));

// The real src/lib/alchemy.ts runs, so its pageKey loop is what is under test; only the
// network is stubbed. The key is a dummy so alchemyRpc builds a URL.
process.env.ALCHEMY_API_KEY = 'test-key';
vi.stubGlobal(
	'fetch',
	vi.fn(async (url: string, init: { body: string }) => {
		const chain = String(url).includes('polygon-mainnet') ? 'polygon-mainnet' : 'eth-mainnet';
		const { method, params } = JSON.parse(init.body);
		const ok = (result: unknown) => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
		if (method === 'alchemy_getTokenBalances') {
			const pageKey: string | undefined = params[2]?.pageKey;
			alchemy.pageCalls.push(pageKey);
			const index = pageKey ? Number(pageKey.replace('page-', '')) : 0;
			return ok((alchemy.pages.get(chain) ?? [])[index] ?? { tokenBalances: [] });
		}
		if (method === 'alchemy_getTokenMetadata') {
			const contract = String(params[0]);
			if (alchemy.failMetadata.has(contract)) return { ok: false, status: 429, json: async () => ({}) };
			return ok(alchemy.metadata.get(contract) ?? { decimals: 18, symbol: null, name: null });
		}
		if (method === 'eth_getBalance') return ok(hex(alchemy.native.get(chain) ?? 0n));
		throw new Error(`unexpected RPC ${method}`);
	}),
);

vi.mock('@/lib/phishingDomains', () => ({
	extractSpamDomains: () => [],
	savePhishingDomains: vi.fn(async () => undefined),
}));

vi.mock('@/lib/coinpaprikaProvider', () => ({
	getTickersUSD: vi.fn(async () => [
		{ id: 'eth-ethereum', symbol: 'ETH', rank: 2, quotes: { USD: { price: 2000 } } },
		{ id: 'aave-new', symbol: 'AAVE', rank: 40, quotes: { USD: { price: 100 } } },
		{ id: 'band-band-protocol', symbol: 'BAND', rank: 400, quotes: { USD: { price: 1 } } },
		{ id: 'link-chainlink', symbol: 'LINK', rank: 15, quotes: { USD: { price: 10 } } },
	]),
}));

const dbState = vi.hoisted(() => ({ snapshotRows: [] as any[] }));

vi.mock('@/lib/db', () => ({
	db: {
		execute: vi.fn(async (query: any) => {
			const sql = typeof query === 'string' ? query : String(query?.sql ?? '');
			if (/FROM wallets WHERE id/.test(sql)) {
				return { rows: [{ id: 'w1', address: WALLET, label: 'Test wallet' }] };
			}
			if (/FROM wallet_snapshots ws/.test(sql)) return { rows: dbState.snapshotRows };
			return { rows: [] };
		}),
	},
}));

vi.mock('@/lib/aave/client', () => ({ getAaveTotalsForWallet: vi.fn() }));
vi.mock('@/lib/repriceMissingWalletTokens', () => ({ repriceMissingWalletTokens: vi.fn(async () => undefined) }));

import { discoverEvmBalances } from '@/lib/evmTokenDiscovery';
import { computeWalletValue } from '@/lib/sync/syncWalletValue';
import { getWalletTokenBreakdown } from '@/lib/networth';
import { isSpamToken } from '@/lib/knownContracts';

/** 100 spam airdrops fill Alchemy's first page; the real tokens arrive on page two. */
function seedEthereumWithSpamFirstPage() {
	const spam = Array.from({ length: 100 }, (_, i) => {
		const contract = spamContract(i);
		alchemy.metadata.set(contract, { decimals: 18, symbol: `CLAIM${i}`, name: `Visit claim-${i}.xyz to claim` });
		return { contractAddress: contract, tokenBalance: hex(10n ** 21n) };
	});
	alchemy.pages.set('eth-mainnet', [
		{ tokenBalances: spam, pageKey: 'page-1' },
		{
			tokenBalances: [
				{ contractAddress: AAVE, tokenBalance: hex(25n * 10n ** 16n) }, // 0.25 AAVE
				{ contractAddress: BAND, tokenBalance: hex(12n * 10n ** 18n) }, // 12 BAND
				{ contractAddress: LINK, tokenBalance: hex(3n * 10n ** 18n) }, // 3 LINK
				{ contractAddress: ETH_WBTC, tokenBalance: hex(50n) }, // 0.0000005 WBTC
				{ contractAddress: FAKE_AAVE, tokenBalance: hex(10n ** 22n) }, // a fake AAVE copy
				{ contractAddress: spamContract(999), tokenBalance: '0x0' }, // zero balance
			],
		},
	]);
	alchemy.metadata.set(AAVE, { decimals: 18, symbol: 'AAVE', name: 'Aave Token' });
	alchemy.metadata.set(BAND, { decimals: 18, symbol: 'BAND', name: 'BandToken' });
	alchemy.metadata.set(LINK, { decimals: 18, symbol: 'LINK', name: 'ChainLink Token' });
	alchemy.metadata.set(ETH_WBTC, { decimals: 8, symbol: 'WBTC', name: 'Wrapped BTC' });
	alchemy.metadata.set(FAKE_AAVE, { decimals: 18, symbol: 'AAVE', name: 'Aave Token' });
	alchemy.native.set('eth-mainnet', 5n * 10n ** 15n); // 0.005 ETH
}

beforeEach(() => {
	alchemy.pages.clear();
	alchemy.metadata.clear();
	alchemy.failMetadata.clear();
	alchemy.native.clear();
	alchemy.pageCalls.length = 0;
	dbState.snapshotRows = [];
});

describe('isSpamToken', () => {
	it('does not call a real token spam because its name has two or more words', () => {
		expect(isSpamToken('AAVE', 'Aave Token')).toBe(false);
		expect(isSpamToken('WBTC', 'Wrapped BTC')).toBe(false);
		expect(isSpamToken('WBTC', '(PoS) Wrapped BTC')).toBe(false);
		expect(isSpamToken('WPOL', 'Wrapped Polygon Ecosystem Token')).toBe(false);
		expect(isSpamToken('USDC', 'USD Coin')).toBe(false);
	});

	it('still catches phishing airdrops and sentence symbols', () => {
		expect(isSpamToken('CLAIM', 'Visit claim-rewards.xyz')).toBe(true);
		expect(isSpamToken('USDC', 't.me/example')).toBe(true);
		expect(isSpamToken('YOU WON REWARD', null)).toBe(true);
	});
});

describe('discoverEvmBalances', () => {
	it('keeps real tokens that Alchemy returns past the first page of spam', async () => {
		seedEthereumWithSpamFirstPage();

		const balances = await discoverEvmBalances('ethereum', WALLET);
		const symbols = balances.map((b) => b.tokenSymbol).sort();

		expect(alchemy.pageCalls).toEqual([undefined, 'page-1']);
		expect(symbols).toEqual(['AAVE', 'BAND', 'ETH', 'LINK', 'WBTC']);
		expect(balances.find((b) => b.tokenSymbol === 'AAVE')?.tokenAddress).toBe(AAVE);
		expect(balances.find((b) => b.tokenSymbol === 'ETH')?.tokenAddress).toBeNull();
	});

	it('keeps a tracked token whose metadata lookup failed, with its own decimals', async () => {
		alchemy.pages.set('polygon-mainnet', [
			{
				tokenBalances: [
					{ contractAddress: POLY_WBTC, tokenBalance: hex(1234n) }, // 0.00001234 WBTC
					{ contractAddress: WPOL, tokenBalance: hex(7n * 10n ** 18n) }, // 7 WPOL
				],
			},
		]);
		alchemy.failMetadata.add(POLY_WBTC);
		alchemy.metadata.set(WPOL, { decimals: 18, symbol: 'WPOL', name: 'Wrapped Polygon Ecosystem Token' });
		alchemy.native.set('polygon-mainnet', 40n * 10n ** 18n);

		const balances = await discoverEvmBalances('polygon', WALLET);
		const wbtc = balances.find((b) => b.tokenAddress === POLY_WBTC);

		expect(wbtc).toMatchObject({ tokenSymbol: 'WBTC', decimals: 8, rawBalance: 1234n });
		expect(balances.map((b) => b.tokenSymbol).sort()).toEqual(['POL', 'WBTC', 'WPOL']);
	});
});

describe('Sync Tins (computeWalletValue)', () => {
	it('stores the same full token list the wallet card refresh sees', async () => {
		seedEthereumWithSpamFirstPage();

		const [breakdown] = await computeWalletValue('t1', 'w1', WALLET, ['ethereum']);
		const bySymbol = Object.fromEntries(breakdown.tokens.map((t) => [t.symbol, t]));

		expect(Object.keys(bySymbol).sort()).toEqual(['AAVE', 'BAND', 'ETH', 'LINK', 'WBTC']);
		expect(bySymbol.AAVE.amount).toBeCloseTo(0.25);
		expect(bySymbol.AAVE.valueUsd).toBeCloseTo(25);
		expect(bySymbol.BAND.valueUsd).toBeCloseTo(12);
		expect(bySymbol.ETH.valueUsd).toBeCloseTo(10);
	});
});

describe('getWalletTokenBreakdown', () => {
	it('shows a known-good token that is not on the short symbol list, and hides a copy of it', async () => {
		dbState.snapshotRows = [
			{
				id: 's1',
				chain: 'ethereum',
				capturedAt: '2026-01-02 03:04:05',
				totalsUsd: 0,
				payloadJson: JSON.stringify([
					{ symbol: 'BAND', amount: 12, priceUsd: 1, valueUsd: 12, tokenAddress: BAND },
					{ symbol: 'BAND', amount: 9000, priceUsd: 1, valueUsd: 9000, tokenAddress: FAKE_AAVE },
				]),
			},
			{
				id: 's2',
				chain: 'polygon',
				capturedAt: '2026-01-02 03:04:05',
				totalsUsd: 0,
				payloadJson: JSON.stringify([
					{ symbol: 'WPOL', amount: 7, priceUsd: 0.2, valueUsd: 1.4, tokenAddress: WPOL },
					{ symbol: 'MATIC', amount: 40, priceUsd: 0.2, valueUsd: 8, tokenAddress: 'native' },
				]),
			},
		];

		const result = await getWalletTokenBreakdown('t1', 'w1');
		const rows = result.tokens.map((t) => `${t.chain}:${t.tokenSymbol}:${t.amount}`).sort();

		expect(rows).toEqual(['ethereum:BAND:12', 'polygon:POL:40', 'polygon:WPOL:7']);
	});
});
