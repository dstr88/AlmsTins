import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression: a wallet's Avalanche snapshot sat at a months-old row with no tokens while the wallet
 * held AVAX, and nothing said it was out of date.
 *
 * - The wallet card's refresh (tokens?refreshMissing=1) rebuilt Ethereum and Polygon only, never
 *   Avalanche, even for a wallet that lists it.
 * - A chain whose read failed kept its old snapshot (right), but the reader served it exactly like
 *   a fresh one, with no stale marker.
 * - The card refresh wrote an EMPTY snapshot when a chain read failed, which would show the chain
 *   as holding nothing.
 *
 * All addresses and amounts are invented; prices are invented.
 */

const WALLET = '0x000000000000000000000000000000000000ca5e';

const readState = vi.hoisted(() => ({ failing: new Set<string>(), calls: [] as string[] }));

vi.mock('@/lib/evmTokenDiscovery', () => ({
	discoverEvmBalances: vi.fn(async (chain: string, address: string) => {
		readState.calls.push(chain);
		if (readState.failing.has(chain)) throw new Error(`${chain} read failed`);
		return [{ chain, address, tokenSymbol: chain === 'ethereum' ? 'ETH' : 'MATIC', tokenAddress: null, decimals: 18, rawBalance: 10n ** 18n }];
	}),
}));

vi.mock('@/lib/balances', () => ({
	getAllBalancesForWallet: vi.fn(async ([chain]: string[], address: string) => {
		readState.calls.push(`${chain}:balances`);
		if (readState.failing.has(chain)) throw new Error(`${chain} read failed`);
		return [{ chain, address, tokenSymbol: 'AVAX', tokenAddress: null, decimals: 18, rawBalance: 3n * 10n ** 18n }];
	}),
}));

vi.mock('@/lib/coinpaprikaProvider', () => ({
	getTickersUSD: vi.fn(async () => [
		{ id: 'eth-ethereum', symbol: 'ETH', rank: 2, quotes: { USD: { price: 2000 } } },
		{ id: 'avax-avalanche', symbol: 'AVAX', rank: 12, quotes: { USD: { price: 20 } } },
		{ id: 'pol-polygon-ecosystem-token', symbol: 'POL', rank: 30, quotes: { USD: { price: 0.2 } } },
	]),
}));

const dbState = vi.hoisted(() => ({ snapshotRows: [] as any[], inserts: [] as any[], chains: '' as unknown }));
vi.mock('@/lib/db', () => ({
	db: {
		execute: vi.fn(async (query: any) => {
			const sql = typeof query === 'string' ? query : String(query?.sql ?? '');
			if (/INSERT INTO wallet_snapshots/.test(sql)) {
				dbState.inserts.push(query.args);
				return { rows: [] };
			}
			if (/SELECT id, address, chains, label FROM wallets/.test(sql)) {
				return {
					rows: [{ id: 'w1', address: WALLET, chains: dbState.chains, label: 'Test wallet' }],
				};
			}
			if (/FROM wallets WHERE id/.test(sql)) return { rows: [{ id: 'w1', address: WALLET, label: 'Test wallet' }] };
			if (/FROM wallet_snapshots ws/.test(sql)) return { rows: dbState.snapshotRows };
			return { rows: [] };
		}),
	},
}));

vi.mock('@/lib/requireTenantSession', () => ({ requireTenantSession: vi.fn(async () => ({ tenantId: 't1' })) }));
vi.mock('@/lib/walletOwnership', () => ({ requireWalletOwnedByTenant: vi.fn(async () => undefined) }));
vi.mock('@/lib/aave/client', () => ({ getAaveTotalsForWallet: vi.fn() }));
vi.mock('@/lib/repriceMissingWalletTokens', () => ({ repriceMissingWalletTokens: vi.fn(async () => undefined) }));

import { GET } from '@/pages/api/wallets/[id]/tokens';
import { getWalletTokenBreakdown, staleSnapshotFlags } from '@/lib/networth';

const refresh = () =>
	GET({ params: { id: 'w1' }, request: new Request('https://example.test/api/wallets/w1/tokens?refreshMissing=1') } as any);

const insertedChains = () => dbState.inserts.map((args) => args[2]);

beforeEach(() => {
	readState.failing.clear();
	readState.calls.length = 0;
	dbState.snapshotRows = [];
	dbState.inserts = [];
	dbState.chains = '["ethereum","polygon","avalanche"]';
});

describe('wallet card refresh', () => {
	it('refreshes Avalanche for a wallet that lists it, with native AVAX priced as AVAX', async () => {
		await refresh();

		expect(insertedChains()).toEqual(['ethereum', 'polygon', 'avalanche']);
		const avalanche = dbState.inserts.find((args) => args[2] === 'avalanche');
		const [avax] = JSON.parse(avalanche[4]);
		expect(avax).toMatchObject({ symbol: 'AVAX', amount: 3, priceUsd: 20, valueUsd: 60 });
	});

	it('reads the wallet chains whether the driver returns JSON text or an already-parsed array', async () => {
		dbState.chains = ['ethereum', 'polygon', 'avalanche'];

		await refresh();

		expect(insertedChains()).toEqual(['ethereum', 'polygon', 'avalanche']);
	});

	it('keeps the last good snapshot when a chain read fails, instead of writing an empty one', async () => {
		readState.failing.add('avalanche');

		await refresh();

		expect(insertedChains()).toEqual(['ethereum', 'polygon']);
	});
});

describe('stale snapshots', () => {
	it('flags a chain more than a day behind the wallet newest snapshot', () => {
		expect(
			staleSnapshotFlags(['2026-03-10 12:00:00', '2026-03-10 11:59:00', '2025-12-01 03:00:00', '2026-03-09 13:00:00']),
		).toEqual([false, false, true, false]);
		expect(staleSnapshotFlags(['2026-03-10 12:00:00'])).toEqual([false]);
		expect(staleSnapshotFlags([null, '2026-03-10 12:00:00'])).toEqual([false, false]);
	});

	it('marks the left-behind chain stale in the tokens a card reads', async () => {
		const row = (id: string, chain: string, capturedAt: string, payload: unknown[]) => ({
			id,
			chain,
			capturedAt,
			totalsUsd: 0,
			payloadJson: JSON.stringify(payload),
		});
		dbState.snapshotRows = [
			row('s1', 'ethereum', '2026-03-10 12:00:00', [{ symbol: 'ETH', amount: 1, priceUsd: 2000, valueUsd: 2000, tokenAddress: 'native' }]),
			row('s2', 'polygon', '2026-03-10 12:00:08', [{ symbol: 'MATIC', amount: 5, priceUsd: 0.2, valueUsd: 1, tokenAddress: 'native' }]),
			row('s3', 'avalanche', '2025-12-01 03:00:00', []),
		];

		const result = await getWalletTokenBreakdown('t1', 'w1');
		const stale = Object.fromEntries(result.snapshots.map((s) => [s.chain, s.stale]));

		expect(stale).toEqual({ ethereum: false, polygon: false, avalanche: true });
	});
});
