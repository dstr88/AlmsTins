import { describe, expect, it, vi } from 'vitest';

// historyRows imports the database client; nothing here touches it.
vi.mock('@/lib/db', () => ({ db: {} }));
import {
	AAVE_CHAIN_BY_ID,
	AAVE_CHAIN_IDS,
	AAVE_MARKETS,
	AAVE_POOL_ADDRESSES,
	AAVE_POOL_BY_CHAIN_ID,
	CHAINS,
	CHAIN_IMPORT_SOURCES,
	CREATE_WALLET_FALLBACK_CHAINS,
	DEFAULT_WALLET_CHAINS,
	EVM_DISCOVERY_CHAINS,
	EXPLORER_CHAINS,
	EXPLORER_EVM_CHAINS,
	NETWORTH_CHAINS,
	ON_CHAIN_IMPORT_SOURCES,
	SYNC_CRON_FALLBACK_CHAINS,
	TIN_BADGE_EVM_CHAINS,
	VAULT_CHAINS,
	VERIFY_ADDRESS_RAILS,
	VERIFY_EVM_RAILS,
	WALLET_SYNC_EVM_CHAINS,
	WALLET_TX_CHAINS,
	chainsForSymbol,
	evmChainId,
	evmNativeSymbol,
	nativeSymbol,
	normalizeChain,
} from '@/lib/chains';
import { parseChain } from '@/lib/agentVault/addresses';
import { NATIVE_SYMBOL as VAULT_NATIVE_SYMBOL } from '@/lib/agentVault/transfers';
import { CHAIN_IDS } from '@/lib/etherscan';
import { nativeSymbol as historyNativeSymbol } from '@/lib/historyRows';

/**
 * Proof that moving the chain facts into src/lib/chains.ts kept every feature's chains. The
 * expected values are the literals the features used before (copied here from the old code).
 */

describe('chains: each feature list keeps the members it had', () => {
	it.each([
		['DEFAULT_WALLET_CHAINS (constants.DEFAULT_ERC20_CHAINS, api/wallets, snowtrace importers, demo)', DEFAULT_WALLET_CHAINS, ['ethereum', 'polygon', 'avalanche']],
		['CREATE_WALLET_FALLBACK_CHAINS (wallets.createWallet)', CREATE_WALLET_FALLBACK_CHAINS, ['ethereum', 'avalanche']],
		['SYNC_CRON_FALLBACK_CHAINS (cron/sync-wallets)', SYNC_CRON_FALLBACK_CHAINS, ['ethereum', 'polygon']],
		['WALLET_SYNC_EVM_CHAINS (sync/syncTransactions)', WALLET_SYNC_EVM_CHAINS, ['ethereum', 'polygon', 'avalanche']],
		['EVM_DISCOVERY_CHAINS (wallets/[id]/tokens)', EVM_DISCOVERY_CHAINS, ['ethereum', 'polygon']],
		['WALLET_TX_CHAINS (wallets/[id]/transactions)', WALLET_TX_CHAINS, ['ethereum', 'avalanche', 'polygon']],
		['VAULT_CHAINS (agentVault)', VAULT_CHAINS, ['ethereum', 'polygon', 'avalanche']],
		['VERIFY_ADDRESS_RAILS (verifyRegistry, VerifyDashboard)', VERIFY_ADDRESS_RAILS, ['ethereum', 'polygon', 'avalanche', 'bitcoin', 'solana', 'litecoin']],
		['NETWORTH_CHAINS (networth)', NETWORTH_CHAINS, ['ethereum', 'polygon', 'avalanche', 'solana', 'sui', 'rootstock', 'bitcoin', 'litecoin']],
		['TIN_BADGE_EVM_CHAINS (vault.astro)', TIN_BADGE_EVM_CHAINS, ['ethereum', 'polygon', 'avalanche', 'arbitrum']],
		['EXPLORER_EVM_CHAINS (explorerLinks)', EXPLORER_EVM_CHAINS, ['ethereum', 'polygon', 'avalanche', 'bsc']],
	])('%s', (_name, list, expected) => {
		expect([...list]).toEqual(expected);
	});

	it('sets keep their members', () => {
		expect([...VERIFY_EVM_RAILS].sort()).toEqual(['avalanche', 'ethereum', 'polygon']);
		expect([...CHAIN_IMPORT_SOURCES].sort()).toEqual(['avalanche_cchain', 'bitcoin', 'litecoin', 'solana']);
		expect([...ON_CHAIN_IMPORT_SOURCES].sort()).toEqual(['bitcoin', 'litecoin']);
		expect([...EXPLORER_CHAINS].sort()).toEqual(['avalanche', 'bitcoin', 'bsc', 'ethereum', 'litecoin', 'polygon', 'solana', 'sui']);
	});
});

describe('chains: normalizeChain is the walletKey one', () => {
	// walletKey.ts before October 2026.
	const OLD_ALIASES: Record<string, string> = {
		eth: 'ethereum', mainnet: 'ethereum', 'ethereum-mainnet': 'ethereum', ethereum_mainnet: 'ethereum',
		matic: 'polygon', 'polygon-pos': 'polygon', polygon_pos: 'polygon',
		avax: 'avalanche', avalanche_cchain: 'avalanche', 'avalanche-cchain': 'avalanche', 'avalanche-c': 'avalanche',
		avalanche_c: 'avalanche', cchain: 'avalanche', 'c-chain': 'avalanche',
		btc: 'bitcoin', xbt: 'bitcoin', sol: 'solana', ltc: 'litecoin', rsk: 'rootstock', trx: 'tron',
	};
	function oldNormalize(chain: unknown): string {
		const c = String(chain ?? '').trim().toLowerCase().replace(/^onchain_/, '');
		if (!c) return 'unknown';
		return Object.prototype.hasOwnProperty.call(OLD_ALIASES, c) ? OLD_ALIASES[c] : c;
	}

	it('maps every old spelling the same way', () => {
		const inputs = [
			...Object.keys(OLD_ALIASES), ...Object.keys(CHAINS), 'ETH', ' Polygon ', 'ONCHAIN_AVALANCHE_CCHAIN', 'onchain_eth',
			'pol', 'arbitrum_one', 'bnb', 'tron', 'custom', '', null, undefined, 42,
		];
		for (const input of inputs) expect([input, normalizeChain(input)]).toEqual([input, oldNormalize(input)]);
	});

	it('never answers a prototype name with a non-string', () => {
		expect(normalizeChain('constructor')).toBe('constructor');
		expect(normalizeChain('__proto__')).toBe('__proto__');
	});
});

describe('chains: native coins', () => {
	it('Polygon is POL (decision D3) and the rest are unchanged', () => {
		expect(nativeSymbol('polygon')).toBe('POL');
		expect(nativeSymbol('matic')).toBe('POL');
		expect(nativeSymbol('ethereum')).toBe('ETH');
		expect(nativeSymbol('avalanche_cchain')).toBe('AVAX');
		expect(nativeSymbol('bitcoin')).toBe('BTC');
		expect(nativeSymbol('nope')).toBe('');
	});

	it('historyRows keeps its EVM-only map (no symbol off EVM)', () => {
		const OLD = { ethereum: 'ETH', polygon: 'POL', avalanche: 'AVAX', rootstock: 'RBTC', base: 'ETH', arbitrum: 'ETH', optimism: 'ETH', bsc: 'BNB' } as Record<string, string>;
		for (const chain of [...Object.keys(CHAINS), 'eth', 'matic', 'rsk', 'tron', '']) {
			expect([chain, historyNativeSymbol(chain)]).toEqual([chain, OLD[normalizeChain(chain)] ?? '']);
			expect(evmNativeSymbol(chain)).toBe(OLD[normalizeChain(chain)] ?? '');
		}
	});

	it('the Agent Vault coins are unchanged', () => {
		expect(VAULT_NATIVE_SYMBOL).toEqual({ ethereum: 'ETH', polygon: 'POL', avalanche: 'AVAX' });
	});
});

describe('chains: EVM ids and Aave markets', () => {
	it('CHAIN_IDS in etherscan.ts is unchanged', () => {
		expect(CHAIN_IDS).toEqual({ ethereum: 1, polygon: 137, avalanche: 43114 });
		expect(evmChainId('polygon')).toBe(137);
		expect(evmChainId('bitcoin')).toBeNull();
	});

	it('the Aave markets are the ones the syncs queried', () => {
		expect([...AAVE_CHAIN_IDS]).toEqual([1, 137, 43114]);
		expect(AAVE_CHAIN_BY_ID).toEqual({ 1: 'ethereum', 137: 'polygon', 43114: 'avalanche' });
		expect(AAVE_POOL_BY_CHAIN_ID).toEqual({
			1: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
			137: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
			43114: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
		});
		expect([...AAVE_POOL_ADDRESSES].sort()).toEqual([
			'0x794a61358d6845594f94dc1db02a252b5b4814ad',
			'0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
		]);
		expect(AAVE_MARKETS.map((m) => m.chain)).toEqual(['ethereum', 'polygon', 'avalanche']);
	});
});

describe('chains: names a form or a pasted list may use', () => {
	it('the Agent Vault reads the same chain names', () => {
		const OLD: Record<string, string> = { ethereum: 'ethereum', eth: 'ethereum', polygon: 'polygon', matic: 'polygon', pol: 'polygon', avalanche: 'avalanche', avax: 'avalanche' };
		for (const name of [...Object.keys(OLD), 'ETH', ' Avax ', 'mainnet', 'bitcoin', 'constructor', '']) {
			const key = name.trim().toLowerCase();
			expect([name, parseChain(name)]).toEqual([name, Object.hasOwn(OLD, key) ? OLD[key] : null]);
		}
	});

	it('chainsForSymbol is the Add wallet table, with POL added for Polygon', () => {
		expect(chainsForSymbol('ETH')).toEqual(['ethereum', 'polygon', 'avalanche']);
		expect(chainsForSymbol('matic')).toEqual(['polygon']);
		expect(chainsForSymbol('POL')).toEqual(['polygon']);
		expect(chainsForSymbol(' btc ')).toEqual(['bitcoin']);
		expect(chainsForSymbol('LTC')).toEqual(['litecoin']);
		expect(chainsForSymbol('SOL')).toEqual(['solana']);
		expect(chainsForSymbol('SUI')).toEqual(['sui']);
		expect(chainsForSymbol('AVAX')).toEqual(['avalanche']);
		expect(chainsForSymbol('BNB')).toBeNull();
		expect(chainsForSymbol('')).toBeNull();
		const a = chainsForSymbol('ETH')!;
		(a as string[]).push('mutated');
		expect(chainsForSymbol('ETH')).toEqual(['ethereum', 'polygon', 'avalanche']);
	});
});
