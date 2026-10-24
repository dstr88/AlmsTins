import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: Sync Tins never refreshed a wallet's Avalanche snapshot. In production,
 * computeWalletValue returned Ethereum and Polygon and no Avalanche entry at all: the Avalanche
 * read went only through Routescan's explorer API, that read failed there, and the chain loop
 * dropped the chain without a trace. Avalanche balances now come from public C-Chain JSON-RPC
 * first, with Routescan only as the fallback.
 *
 * The address is invented; amounts and prices are invented.
 */

const WALLET = '0x000000000000000000000000000000000000a7a7';
const USDC_AVAX = '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e';

const net = vi.hoisted(() => ({
	rpcDown: new Set<string>(),
	routescanBlocked: true,
	hits: [] as string[],
}));

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

vi.stubGlobal(
	'fetch',
	vi.fn(async (url: string, init?: { body?: string }) => {
		const u = String(url);
		if (u.includes('routescan.io')) {
			net.hits.push('routescan');
			if (net.routescanBlocked) {
				// What a bot challenge looks like to fetchScan: an HTML page, not JSON.
				return { ok: false, status: 403, json: async () => JSON.parse('<!DOCTYPE html>') };
			}
			const params = new URL(u).searchParams;
			const result = params.get('action') === 'balance' ? String(2n * 10n ** 18n) : '0';
			return json({ status: '1', message: 'OK', result });
		}
		const host = new URL(u).host;
		net.hits.push(host);
		if (net.rpcDown.has(host)) return json({}, 503);
		const { method, params } = JSON.parse(init?.body ?? '{}');
		if (method === 'eth_getBalance') return json({ jsonrpc: '2.0', id: 1, result: '0x' + (3n * 10n ** 18n).toString(16) });
		if (method === 'eth_call') {
			const isUsdc = String(params[0].to).toLowerCase() === USDC_AVAX;
			return json({ jsonrpc: '2.0', id: 1, result: '0x' + (isUsdc ? 1500000n : 0n).toString(16).padStart(64, '0') });
		}
		throw new Error(`unexpected ${u}`);
	}),
);

vi.mock('@/lib/coinpaprikaProvider', () => ({
	getTickersUSD: vi.fn(async () => [{ id: 'avax-avalanche', symbol: 'AVAX', rank: 12, quotes: { USD: { price: 20 } } }]),
}));
vi.mock('@/lib/db', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }));

import { computeWalletValue } from '@/lib/sync/syncWalletValue';
import { AVALANCHE_RPC_URLS } from '@/lib/balances';

const [PRIMARY, SECONDARY] = AVALANCHE_RPC_URLS.map((u) => new URL(u).host);

beforeEach(() => {
	net.rpcDown.clear();
	net.routescanBlocked = true;
	net.hits.length = 0;
});

describe('Sync Tins Avalanche read', () => {
	it('reads native AVAX and tracked ERC-20s from C-Chain RPC while Routescan is unreachable', async () => {
		const [breakdown] = await computeWalletValue('t1', 'w1', WALLET, ['avalanche']);

		expect(breakdown?.chain).toBe('avalanche');
		const avax = breakdown.tokens.find((t) => t.symbol === 'AVAX');
		const usdc = breakdown.tokens.find((t) => t.symbol === 'USDC');
		expect(avax).toMatchObject({ amount: 3, priceUsd: 20, valueUsd: 60 });
		expect(usdc).toMatchObject({ amount: 1.5, priceUsd: 1 });
		expect(net.hits).not.toContain('routescan');
	});

	it('tries the next RPC endpoint when the first is down', async () => {
		net.rpcDown.add(PRIMARY);

		const [breakdown] = await computeWalletValue('t1', 'w1', WALLET, ['avalanche']);

		expect(breakdown.tokens.find((t) => t.symbol === 'AVAX')?.amount).toBe(3);
		expect(net.hits).toContain(SECONDARY);
	});

	it('falls back to Routescan when no RPC endpoint answers', async () => {
		net.rpcDown.add(PRIMARY);
		net.rpcDown.add(SECONDARY);
		net.routescanBlocked = false;

		const [breakdown] = await computeWalletValue('t1', 'w1', WALLET, ['avalanche']);

		expect(breakdown.tokens.find((t) => t.symbol === 'AVAX')?.amount).toBe(2);
	}, 20000);

	it('returns no Avalanche breakdown, so the last snapshot stands, when every source fails', async () => {
		net.rpcDown.add(PRIMARY);
		net.rpcDown.add(SECONDARY);

		expect(await computeWalletValue('t1', 'w1', WALLET, ['avalanche'])).toEqual([]);
	});
});
