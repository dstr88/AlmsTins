import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Arbitrum was offered on the Add asset form and stored on the wallet, but no balance read
 * covered it, so its funds were never valued. Arbitrum now reads the way Ethereum and Polygon do:
 * Alchemy's full token list on arb-mainnet, with the native coin from src/lib/chains.ts. When
 * Alchemy is down, the Etherscan V2 native read (chain 42161) is the fallback.
 *
 * The address is invented; amounts and prices are invented.
 */

const WALLET = '0x000000000000000000000000000000000000a1a1';
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';

const net = vi.hoisted(() => ({ alchemyDown: false, hits: [] as string[] }));

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

vi.stubGlobal(
	'fetch',
	vi.fn(async (url: string, init?: { body?: string }) => {
		const u = String(url);
		net.hits.push(u);
		if (u.includes('api.etherscan.io')) {
			const params = new URL(u).searchParams;
			const result = params.get('action') === 'balance' ? String(2n * 10n ** 18n) : '0';
			return json({ status: '1', message: 'OK', result });
		}
		if (new URL(u).host !== 'arb-mainnet.g.alchemy.com') throw new Error(`unexpected ${u}`);
		if (net.alchemyDown) return json({}, 503);
		const { method, params } = JSON.parse(init?.body ?? '{}');
		if (method === 'eth_getBalance') {
			return json({ jsonrpc: '2.0', id: 1, result: '0x' + (2n * 10n ** 18n).toString(16) });
		}
		if (method === 'alchemy_getTokenBalances') {
			const tokenBalances = [{ contractAddress: USDC_ARB, tokenBalance: '0x' + (1500000n).toString(16) }];
			return json({ jsonrpc: '2.0', id: 1, result: { address: params[0], tokenBalances } });
		}
		if (method === 'alchemy_getTokenMetadata') {
			return json({ jsonrpc: '2.0', id: 1, result: { symbol: 'USDC', decimals: 6, name: 'USD Coin' } });
		}
		throw new Error(`unexpected method ${method}`);
	}),
);

vi.mock('@/lib/coinpaprikaProvider', () => ({
	getTickersUSD: vi.fn(async () => [
		{ id: 'eth-ethereum', symbol: 'ETH', rank: 2, quotes: { USD: { price: 3000 } } },
		{ id: 'usdc-usd-coin', symbol: 'USDC', rank: 6, quotes: { USD: { price: 1 } } },
	]),
}));
vi.mock('@/lib/db', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }));

import { buildScanUrl } from '@/lib/scanSync';
import { computeWalletValue } from '@/lib/sync/syncWalletValue';

beforeAll(() => {
	vi.stubEnv('ALCHEMY_API_KEY', 'test-key');
	vi.stubEnv('ETHERSCAN_API_KEY', 'test-key');
});

beforeEach(() => {
	net.alchemyDown = false;
	net.hits.length = 0;
});

describe('Sync Tins Arbitrum read', () => {
	it('reads the native coin and the token list from Alchemy on arb-mainnet', async () => {
		const [breakdown] = await computeWalletValue('t1', 'w1', WALLET, ['arbitrum']);

		expect(breakdown?.chain).toBe('arbitrum');
		expect(breakdown.tokens.find((t) => t.symbol === 'ETH')).toMatchObject({ amount: 2, priceUsd: 3000, valueUsd: 6000 });
		expect(breakdown.tokens.find((t) => t.symbol === 'USDC')).toMatchObject({ amount: 1.5, priceUsd: 1 });
		expect(net.hits.some((u) => new URL(u).host === 'arb-mainnet.g.alchemy.com')).toBe(true);
		expect(net.hits.some((u) => u.includes('api.etherscan.io'))).toBe(false);
	});

	it('falls back to the Etherscan native read when Alchemy is down', async () => {
		net.alchemyDown = true;

		const [breakdown] = await computeWalletValue('t1', 'w1', WALLET, ['arbitrum']);

		expect(breakdown.tokens.find((t) => t.symbol === 'ETH')?.amount).toBe(2);
		expect(net.hits.some((u) => u.includes('api.etherscan.io') && u.includes('chainid=42161'))).toBe(true);
	});

	it('addresses Arbitrum as chain 42161 on the Etherscan V2 API', () => {
		expect(buildScanUrl('arbitrum', { module: 'account', action: 'balance', address: WALLET, tag: 'latest' })).toContain(
			'chainid=42161',
		);
	});
});
