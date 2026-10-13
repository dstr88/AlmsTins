import { describe, it, expect } from 'vitest';
import {
	UNASSIGNED,
	cexWalletKey,
	chainWalletKey,
	isChainSource,
	isEvmAddress,
	isUnassignedWalletKey,
	normalizeChain,
	normalizeWalletAddress,
	parseWalletKey,
	walletKey,
} from '../../src/lib/walletKey';

/**
 * src/lib/walletKey.ts: one stable string per wallet, shared by the history export and the
 * per-wallet engine. Exchange accounts are cex:{source}:{account_id} (the format cexSnapshot,
 * address labels and the transfer matcher already use), on-chain wallets are {chain}:{address},
 * one EVM address on two chains is two wallets (owner decision, Oct 12 2026), and only EVM
 * addresses are lowercased.
 */

const EVM = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const EVM_LOWER = EVM.toLowerCase();
const SOL = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const BTC_LEGACY = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const BTC_BECH32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const ACCOUNT = '6f1c2d3e-0000-4000-8000-00000000abcd';

describe('normalizeChain', () => {
	it.each([
		['ethereum', 'ethereum'],
		['Ethereum', 'ethereum'],
		[' ETH ', 'ethereum'],
		['mainnet', 'ethereum'],
		['onchain_ethereum', 'ethereum'],
		['polygon', 'polygon'],
		['matic', 'polygon'],
		['polygon_pos', 'polygon'],
		['avalanche', 'avalanche'],
		['avalanche_cchain', 'avalanche'],
		['AVAX', 'avalanche'],
		['c-chain', 'avalanche'],
		['bitcoin', 'bitcoin'],
		['btc', 'bitcoin'],
		['solana', 'solana'],
		['sol', 'solana'],
		['sui', 'sui'],
		['rootstock', 'rootstock'],
		['rsk', 'rootstock'],
		['litecoin', 'litecoin'],
		['ltc', 'litecoin'],
		['custom', 'custom'],
		['base', 'base'],
	])('%s → %s', (input, out) => {
		expect(normalizeChain(input)).toBe(out);
	});

	it.each([[''], ['   '], [null], [undefined]])('an empty chain (%s) is "unknown", never an empty key part', (input) => {
		expect(normalizeChain(input)).toBe('unknown');
	});
});

describe('addresses: only EVM is lowercased', () => {
	it('recognizes an EVM address in any case, and nothing else', () => {
		expect(isEvmAddress(EVM)).toBe(true);
		expect(isEvmAddress(EVM_LOWER)).toBe(true);
		expect(isEvmAddress(` ${EVM} `)).toBe(true);
		for (const a of [SOL, BTC_LEGACY, BTC_BECH32, '0x123', `${EVM}00`, 'cex:coinbase:x', '', null, 42]) {
			expect(isEvmAddress(a), String(a)).toBe(false);
		}
	});

	it('lowercases an EVM address and trims', () => {
		expect(normalizeWalletAddress(` ${EVM} `)).toBe(EVM_LOWER);
	});

	it.each([[SOL], [BTC_LEGACY], [BTC_BECH32], ['0x' + 'Ab'.repeat(32)]])('keeps the case of a non-EVM address (%s)', (a) => {
		expect(normalizeWalletAddress(a)).toBe(a);
	});

	it('a 64-hex Sui address is not EVM and keeps its case', () => {
		const sui = '0x' + 'aB'.repeat(32);
		expect(normalizeWalletAddress(sui)).toBe(sui);
		expect(chainWalletKey('sui', sui)).toBe(`sui:${sui}`);
	});
});

describe('exchange accounts: cex:{source}:{account_id}', () => {
	it('matches the format cexSnapshot.ts writes for exchange mirror wallets', () => {
		expect(cexWalletKey('crypto_com', ACCOUNT)).toBe(`cex:crypto_com:${ACCOUNT}`);
		expect(cexWalletKey('coinbase', ACCOUNT)).toBe(`cex:coinbase:${ACCOUNT}`);
	});

	it('canonicalizes the source the way the importers store it', () => {
		expect(cexWalletKey('crypto-com', ACCOUNT)).toBe(`cex:crypto_com:${ACCOUNT}`);
		expect(cexWalletKey('Crypto.com', ACCOUNT)).toBe(`cex:crypto_com:${ACCOUNT}`);
		expect(cexWalletKey(' Kraken ', ACCOUNT)).toBe(`cex:kraken:${ACCOUNT}`);
	});

	it('two accounts at the same exchange are two keys', () => {
		expect(cexWalletKey('crypto_com', 'acct-1')).not.toBe(cexWalletKey('crypto_com', 'acct-2'));
	});

	it.each([[null], [undefined], [''], ['   ']])('a row with no account (%s) goes to cex:{source}:unassigned', (id) => {
		expect(cexWalletKey('crypto_com', id)).toBe('cex:crypto_com:unassigned');
	});

	it('the unassigned bucket is per exchange', () => {
		expect(cexWalletKey('coinbase', null)).toBe('cex:coinbase:unassigned');
		expect(cexWalletKey('coinbase', null)).not.toBe(cexWalletKey('kraken', null));
	});
});

describe('on-chain wallets: {chain}:{address}', () => {
	it('one EVM address on two chains is two wallets', () => {
		expect(chainWalletKey('ethereum', EVM)).toBe(`ethereum:${EVM_LOWER}`);
		expect(chainWalletKey('polygon', EVM)).toBe(`polygon:${EVM_LOWER}`);
		expect(chainWalletKey('ethereum', EVM)).not.toBe(chainWalletKey('polygon', EVM));
	});

	it('the same address and chain is one key, whatever the case or chain spelling', () => {
		expect(chainWalletKey('avalanche_cchain', EVM)).toBe(chainWalletKey('avalanche', EVM_LOWER));
		expect(chainWalletKey('ETH', ` ${EVM_LOWER} `)).toBe(chainWalletKey('ethereum', EVM));
	});

	it('base58 and legacy Bitcoin addresses keep their case', () => {
		expect(chainWalletKey('solana', SOL)).toBe(`solana:${SOL}`);
		expect(chainWalletKey('btc', BTC_LEGACY)).toBe(`bitcoin:${BTC_LEGACY}`);
		expect(chainWalletKey('bitcoin', BTC_BECH32)).toBe(`bitcoin:${BTC_BECH32}`);
	});

	it.each([[null], [undefined], [''], ['  ']])('no address (%s) goes to {chain}:unassigned', (a) => {
		expect(chainWalletKey('ethereum', a)).toBe('ethereum:unassigned');
	});

	it('an exchange mirror wallet row (address cex:...) keys as its exchange account', () => {
		expect(chainWalletKey('ethereum', `cex:crypto_com:${ACCOUNT}`)).toBe(`cex:crypto_com:${ACCOUNT}`);
		expect(chainWalletKey('', `cex:crypto-com:${ACCOUNT}`)).toBe(`cex:crypto_com:${ACCOUNT}`);
	});

	it('a custom wallet keys on its chain and placeholder address', () => {
		expect(chainWalletKey('custom', 'custom_abc123')).toBe('custom:custom_abc123');
	});
});

describe('walletKey() dispatches on kind', () => {
	it('cex and chain inputs', () => {
		expect(walletKey({ kind: 'cex', source: 'gemini', accountId: ACCOUNT })).toBe(`cex:gemini:${ACCOUNT}`);
		expect(walletKey({ kind: 'cex', source: 'gemini' })).toBe('cex:gemini:unassigned');
		expect(walletKey({ kind: 'chain', chain: 'polygon', address: EVM })).toBe(`polygon:${EVM_LOWER}`);
		expect(walletKey({ kind: 'chain', chain: 'polygon' })).toBe('polygon:unassigned');
	});
});

describe('parseWalletKey is the inverse', () => {
	it.each([
		[`cex:crypto_com:${ACCOUNT}`, { kind: 'cex', source: 'crypto_com', accountId: ACCOUNT }],
		['cex:coinbase:unassigned', { kind: 'cex', source: 'coinbase', accountId: null }],
		[`ethereum:${EVM_LOWER}`, { kind: 'chain', chain: 'ethereum', address: EVM_LOWER }],
		[`solana:${SOL}`, { kind: 'chain', chain: 'solana', address: SOL }],
		['avalanche:unassigned', { kind: 'chain', chain: 'avalanche', address: null }],
	])('%s', (key, parsed) => {
		expect(parseWalletKey(key)).toEqual(parsed);
	});

	it('round-trips every key the builders make', () => {
		const keys = [
			cexWalletKey('kraken', ACCOUNT),
			cexWalletKey('kraken', null),
			chainWalletKey('ethereum', EVM),
			chainWalletKey('solana', SOL),
			chainWalletKey('bitcoin', null),
		];
		for (const key of keys) {
			const p = parseWalletKey(key)!;
			const again = p.kind === 'cex' ? cexWalletKey(p.source, p.accountId) : chainWalletKey(p.chain, p.address);
			expect(again).toBe(key);
		}
	});

	it.each([[''], ['nocolon'], ['cex:'], ['cex:coinbase'], ['cex:coinbase:'], [':0xabc'], ['ethereum:'], [null], [7]])(
		'%s is not a wallet key',
		(key) => {
			expect(parseWalletKey(key)).toBeNull();
		},
	);
});

describe('unassigned buckets and chain sources', () => {
	it('isUnassignedWalletKey', () => {
		expect(isUnassignedWalletKey(`cex:crypto_com:${UNASSIGNED}`)).toBe(true);
		expect(isUnassignedWalletKey('ethereum:unassigned')).toBe(true);
		expect(isUnassignedWalletKey(`cex:crypto_com:${ACCOUNT}`)).toBe(false);
		expect(isUnassignedWalletKey(`ethereum:${EVM_LOWER}`)).toBe(false);
		expect(isUnassignedWalletKey('garbage')).toBe(false);
	});

	it('blockchain import sources are not exchanges', () => {
		for (const s of ['bitcoin', 'solana', 'avalanche_cchain', 'litecoin']) expect(isChainSource(s), s).toBe(true);
		for (const s of ['coinbase', 'crypto_com', 'kraken', 'exodus', 'unknown', '']) expect(isChainSource(s), s).toBe(false);
	});
});
