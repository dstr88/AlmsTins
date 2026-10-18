import { describe, it, expect, vi } from 'vitest';

// walletIdentity.ts (compared against below) opens the database at import; the logic under test is pure.
vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [], rowsAffected: 0 }) } }));

import {
	buildOwnedIndex,
	refOfImportRow,
	refOfOnchainRow,
	refOfSuiRow,
	walletKeyOfRef,
	walletOfRow,
	type WalletEntry,
	type WalletOfRowContext,
} from '../../src/lib/tax/walletOfRow';
import { normalizeTxHash } from '../../src/lib/tax/normalize';
import { resolveWalletRef, type WalletDirectory, type WalletRef } from '../../src/lib/walletIdentity';
import { en } from '../../src/i18n/historyExport';

/**
 * src/lib/tax/walletOfRow.ts: which wallet or account a row belongs to.
 *
 * The records half (refOfImportRow, refOfOnchainRow, refOfSuiRow) is what historyRows.ts did
 * inline; tests/records/historyHelpers.test.ts and historyByWallet.test.ts hold the records
 * output. The tax half resolves a row to wallet keys, one case per mapping rule. Every address,
 * id and name here is invented.
 */

const EVM = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const EVM_LOWER = EVM.toLowerCase();
const EVM2 = '0x1111111111111111111111111111111111111111';
const OUTSIDE = '0x9999999999999999999999999999999999999999';
const BTC = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const SOL = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const SUI = '0x' + 'ab'.repeat(32);
const ACCT = '6f1c2d3e-0000-4000-8000-00000000abcd';

const wallets = new Map<string, WalletEntry>([
	['w-evm', { address: EVM }],
	['w-evm2', { address: EVM2 }],
	['w-btc', { address: BTC }],
	['w-sol', { address: SOL }],
	['w-sui', { address: SUI }],
	['w-poly', { address: EVM2, chains: ['polygon', 'ethereum'] }],
	['w-multi', { address: EVM, chains: ['', 'avalanche'] }],
	['w-mirror', { address: `cex:crypto_com:${ACCT}` }],
	['w-custom', { address: 'custom_abc123' }],
	['w-nothing', { address: '' }],
]);

const owned = buildOwnedIndex([EVM, EVM2, BTC, SOL, SUI, `cex:crypto_com:${ACCT}`, '', null, undefined]);
const ctx: WalletOfRowContext = { wallets, owned };

describe('buildOwnedIndex', () => {
	it('normalizes EVM addresses to lowercase, keeps other addresses as they are, and drops exchange mirrors and blanks', () => {
		expect(owned).toEqual(new Set([EVM_LOWER, EVM2, BTC, SOL, SUI]));
	});
});

describe('the records half: where a row says it belongs (what historyRows.ts did inline)', () => {
	it('an imported row from a chain source keys on its wallet; account ids are shared across addresses', () => {
		expect(refOfImportRow({ source: 'bitcoin', wallet_id: 'w-btc', account_id: 'shared' })).toEqual({ kind: 'wallet', walletId: 'w-btc', chain: 'bitcoin' });
		expect(refOfImportRow({ source: 'avalanche_cchain', wallet_id: 'w-evm' })).toEqual({ kind: 'wallet', walletId: 'w-evm', chain: 'avalanche' });
		expect(refOfImportRow({ source: ' Solana ', wallet_id: ' w-sol ' })).toEqual({ kind: 'wallet', walletId: 'w-sol', chain: 'solana' });
	});

	it('an exchange row keys on its account, or on the exchange\'s unassigned bucket', () => {
		expect(refOfImportRow({ source: 'crypto_com', account_id: 'a1' })).toEqual({ kind: 'account', source: 'crypto_com', accountId: 'a1' });
		expect(refOfImportRow({ source: 'crypto_com', account_id: '' })).toEqual({ kind: 'account', source: 'crypto_com', accountId: null });
		expect(refOfImportRow({ source: 'kraken' })).toEqual({ kind: 'account', source: 'kraken', accountId: null });
	});

	it('a chain-sourced row with no wallet falls back to its account; an exchange row ignores a stray wallet id', () => {
		expect(refOfImportRow({ source: 'avalanche_cchain', account_id: 'a' })).toEqual({ kind: 'account', source: 'avalanche_cchain', accountId: 'a' });
		expect(refOfImportRow({ source: 'coinbase', wallet_id: 'w-evm', account_id: 'a' })).toEqual({ kind: 'account', source: 'coinbase', accountId: 'a' });
	});

	it('an on-chain row names its wallet and chain; a Sui row its wallet', () => {
		expect(refOfOnchainRow({ wallet_id: 'w-evm', chain: 'Ethereum' })).toEqual({ kind: 'wallet', walletId: 'w-evm', chain: 'ethereum' });
		expect(refOfOnchainRow({ wallet_id: '', chain: 'matic' })).toEqual({ kind: 'wallet', walletId: null, chain: 'polygon' });
		expect(refOfOnchainRow({})).toEqual({ kind: 'wallet', walletId: null, chain: 'unknown' });
		expect(refOfSuiRow({ wallet_id: 'w-sui' })).toEqual({ kind: 'wallet', walletId: 'w-sui', chain: 'sui' });
		expect(refOfSuiRow({ wallet_id: null })).toEqual({ kind: 'wallet', walletId: null, chain: 'sui' });
	});
});

describe('walletKeyOfRef gives the key resolveWalletRef gives', () => {
	const dir: WalletDirectory = {
		wallets: new Map([...wallets].map(([id, w]) => [id, { id, address: w.address, label: null, walletType: w.address.startsWith('custom_') ? 'custom' : w.address.startsWith('cex:') ? 'exchange' : 'onchain' }])),
		walletsByAddress: new Map(),
		accounts: new Map([[ACCT, { id: ACCT, source: 'crypto_com', name: 'Account #1' }]]),
		overrides: new Map(),
		ownersByAddress: new Map(),
	};
	const refs: [string, WalletRef][] = [
		['an exchange account', { kind: 'account', source: 'crypto_com', accountId: ACCT }],
		['an exchange account the tenant no longer has', { kind: 'account', source: 'crypto_com', accountId: 'gone' }],
		['the unassigned bucket', { kind: 'account', source: 'kraken', accountId: null }],
		['a source spelled with a hyphen', { kind: 'account', source: 'crypto-com', accountId: 'a' }],
		['an EVM wallet (mixed-case address)', { kind: 'wallet', walletId: 'w-evm', chain: 'ethereum' }],
		['the same address on another chain', { kind: 'wallet', walletId: 'w-evm', chain: 'polygon' }],
		['a chain alias', { kind: 'wallet', walletId: 'w-evm', chain: 'eth' }],
		['a legacy Bitcoin wallet (case kept)', { kind: 'wallet', walletId: 'w-btc', chain: 'bitcoin' }],
		['a Solana wallet', { kind: 'wallet', walletId: 'w-sol', chain: 'solana' }],
		['a Sui wallet', { kind: 'wallet', walletId: 'w-sui', chain: 'sui' }],
		['an exchange mirror wallet', { kind: 'wallet', walletId: 'w-mirror', chain: 'ethereum' }],
		['a custom wallet', { kind: 'wallet', walletId: 'w-custom', chain: 'custom' }],
		['a wallet with no address', { kind: 'wallet', walletId: 'w-nothing', chain: 'ethereum' }],
		['a wallet id the tenant does not have', { kind: 'wallet', walletId: 'w-other-tenant', chain: 'ethereum' }],
		['no wallet id', { kind: 'wallet', walletId: null, chain: 'bitcoin' }],
	];
	it.each(refs)('%s', (_name, ref) => {
		expect(walletKeyOfRef(ref, wallets)).toBe(resolveWalletRef(dir, ref, en.file).key);
	});

	it('spells out the formats', () => {
		expect(walletKeyOfRef({ kind: 'account', source: 'crypto-com', accountId: ACCT }, wallets)).toBe(`cex:crypto_com:${ACCT}`);
		expect(walletKeyOfRef({ kind: 'wallet', walletId: 'w-evm', chain: 'eth' }, wallets)).toBe(`ethereum:${EVM_LOWER}`);
		expect(walletKeyOfRef({ kind: 'wallet', walletId: 'w-btc', chain: 'bitcoin' }, wallets)).toBe(`bitcoin:${BTC}`);
		expect(walletKeyOfRef({ kind: 'wallet', walletId: 'w-mirror', chain: 'ethereum' }, wallets)).toBe(`cex:crypto_com:${ACCT}`);
		expect(walletKeyOfRef({ kind: 'wallet', walletId: 'nope', chain: 'polygon' }, wallets)).toBe('polygon:unassigned');
	});
});

describe('the tax half: walletOfRow, one case per mapping rule', () => {
	describe('import rows', () => {
		it('with a wallet_id on a chain source: the chain key', () => {
			expect(walletOfRow({ origin: 'import', source: 'bitcoin', walletId: 'w-btc', accountId: 'shared' }, ctx)).toEqual({
				legs: [{ side: null, wallet: `bitcoin:${BTC}` }],
				basis: 'wallet',
			});
			expect(walletOfRow({ origin: 'import', source: 'solana', walletId: 'w-sol' }, ctx).legs[0].wallet).toBe(`solana:${SOL}`);
			expect(walletOfRow({ origin: 'import', source: 'avalanche_cchain', walletId: 'w-evm' }, ctx).legs[0].wallet).toBe(`avalanche:${EVM_LOWER}`);
		});

		it('from an exchange with an account_id: cex:{source}:{account_id}', () => {
			expect(walletOfRow({ origin: 'import', source: 'coinbase', accountId: 'acct-1' }, ctx)).toEqual({
				legs: [{ side: null, wallet: 'cex:coinbase:acct-1' }],
				basis: 'account',
			});
			expect(walletOfRow({ origin: 'import', source: 'Crypto-Com', accountId: 'a' }, ctx).legs[0].wallet).toBe('cex:crypto_com:a');
		});

		it('with no account_id: cex:{source}:unassigned, one bucket per exchange', () => {
			expect(walletOfRow({ origin: 'import', source: 'coinbase', accountId: null }, ctx)).toEqual({
				legs: [{ side: null, wallet: 'cex:coinbase:unassigned' }],
				basis: 'unassigned',
			});
			expect(walletOfRow({ origin: 'import', source: 'kraken' }, ctx).legs[0].wallet).toBe('cex:kraken:unassigned');
		});

		it("a chain-synced row whose wallet is not the tenant's lands on the chain's unassigned bucket, not on someone else's wallet", () => {
			expect(walletOfRow({ origin: 'import', source: 'bitcoin', walletId: 'someone-elses' }, ctx).legs[0].wallet).toBe('bitcoin:unassigned');
		});

		it("source 'manual' with batch 'manual-{walletId}': that wallet", () => {
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-w-evm' }, ctx)).toEqual({
				legs: [{ side: null, wallet: `ethereum:${EVM_LOWER}` }],
				basis: 'manual_batch',
			});
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-w-sol', accountId: null }, ctx).legs[0].wallet).toBe(`solana:${SOL}`);
		});

		it('a manual row has no chain, so it keys on the first chain the wallet lists, then on the address shape', () => {
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-w-poly' }, ctx).legs[0].wallet).toBe(`polygon:${EVM2}`);
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-w-multi' }, ctx).legs[0].wallet).toBe(`avalanche:${EVM_LOWER}`);
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-w-evm2' }, ctx).legs[0].wallet).toBe(`ethereum:${EVM2}`);
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-w-sui' }, ctx).legs[0].wallet).toBe(`sui:${SUI}`);
			// The same chain the wallet's own rows key on, so a token-basis lot sits in the pool its sales draw from.
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-w-btc' }, ctx).legs[0].wallet).toBe(`bitcoin:${BTC}`);
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-w-custom' }, ctx).legs[0].wallet).toBe('custom:custom_abc123');
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-w-odd' }, { ...ctx, wallets: new Map([['w-odd', { address: 'not-an-address!' }]]) }).legs[0].wallet).toBe('unknown:not-an-address!');
		});

		it('a manual row for a wallet the tenant does not have stays in the unassigned bucket', () => {
			expect(walletOfRow({ origin: 'import', source: 'manual', importBatchId: 'manual-gone' }, ctx)).toEqual({
				legs: [{ side: null, wallet: 'cex:manual:unassigned' }],
				basis: 'unassigned',
			});
		});

		it("a 'manual-' batch on another source is not a manual token-basis row", () => {
			expect(walletOfRow({ origin: 'import', source: 'coinbase', accountId: 'a', importBatchId: 'manual-w-evm' }, ctx).legs[0].wallet).toBe('cex:coinbase:a');
		});

		describe('aave_{chain} rows: the wallet found by joining the tx hash to transactions', () => {
			const hash = '0x' + 'ab'.repeat(32);
			const withHashes: WalletOfRowContext = { ...ctx, walletIdByTxHash: new Map([[normalizeTxHash(hash), 'w-evm']]) };

			it('keys on the wallet of the transactions row with the same hash, on the chain in the source', () => {
				expect(walletOfRow({ origin: 'import', source: 'aave_ethereum', txHash: hash }, withHashes)).toEqual({
					legs: [{ side: null, wallet: `ethereum:${EVM_LOWER}` }],
					basis: 'aave_tx',
				});
				expect(walletOfRow({ origin: 'import', source: 'aave_polygon', txHash: hash }, withHashes).legs[0].wallet).toBe(`polygon:${EVM_LOWER}`);
			});

			it('the hash matches whatever its case or 0x', () => {
				expect(walletOfRow({ origin: 'import', source: 'aave_ethereum', txHash: hash.toUpperCase().replace('0X', '0x') }, withHashes).basis).toBe('aave_tx');
				expect(walletOfRow({ origin: 'import', source: 'aave_ethereum', txHash: hash.slice(2) }, withHashes).basis).toBe('aave_tx');
			});

			it('with no matching transaction, or no hash, the row stays unassigned', () => {
				expect(walletOfRow({ origin: 'import', source: 'aave_ethereum', txHash: '0x' + 'cd'.repeat(32) }, withHashes)).toEqual({
					legs: [{ side: null, wallet: 'cex:aave_ethereum:unassigned' }],
					basis: 'unassigned',
				});
				expect(walletOfRow({ origin: 'import', source: 'aave_ethereum' }, withHashes).basis).toBe('unassigned');
				expect(walletOfRow({ origin: 'import', source: 'aave_ethereum', txHash: hash }, ctx).basis).toBe('unassigned');
			});

			it("a hash that points at a wallet the tenant does not have is not trusted", () => {
				const stray: WalletOfRowContext = { ...ctx, walletIdByTxHash: new Map([[normalizeTxHash(hash), 'someone-elses']]) };
				expect(walletOfRow({ origin: 'import', source: 'aave_ethereum', txHash: hash }, stray).basis).toBe('unassigned');
			});
		});
	});

	describe('transactions rows: the chain and the address of the side that moved', () => {
		const base = { origin: 'onchain' as const, chain: 'ethereum', walletId: 'w-evm' };

		it('an outgoing row is the sender: the from address', () => {
			expect(walletOfRow({ ...base, fromAddress: EVM, toAddress: OUTSIDE, txType: 'outgoing' }, ctx)).toEqual({
				legs: [{ side: 'out', wallet: `ethereum:${EVM_LOWER}` }],
				basis: 'owned_address',
			});
			expect(walletOfRow({ ...base, fromAddress: EVM, toAddress: OUTSIDE, txType: 'token_out' }, ctx).legs[0].side).toBe('out');
		});

		it('an incoming row is the receiver: the to address', () => {
			expect(walletOfRow({ ...base, fromAddress: OUTSIDE, toAddress: EVM, txType: 'incoming' }, ctx)).toEqual({
				legs: [{ side: 'in', wallet: `ethereum:${EVM_LOWER}` }],
				basis: 'owned_address',
			});
			expect(walletOfRow({ ...base, fromAddress: OUTSIDE, toAddress: EVM, txType: 'token_in' }, ctx).legs[0].side).toBe('in');
		});

		it('the address, not the wallet_id, decides: a row that names the wrong wallet still lands on the right one', () => {
			expect(walletOfRow({ ...base, walletId: 'w-evm2', fromAddress: EVM, toAddress: OUTSIDE, txType: 'outgoing' }, ctx).legs[0].wallet).toBe(`ethereum:${EVM_LOWER}`);
		});

		it('when both sides are tracked on the same chain it is a self-send: two legs, an out and an in', () => {
			expect(walletOfRow({ ...base, walletId: 'w-evm2', fromAddress: EVM, toAddress: EVM2.toUpperCase().replace('0X', '0x'), txType: 'incoming' }, ctx)).toEqual({
				legs: [
					{ side: 'out', wallet: `ethereum:${EVM_LOWER}` },
					{ side: 'in', wallet: `ethereum:${EVM2}` },
				],
				basis: 'owned_address',
			});
		});

		it('a self-send keeps its two legs whichever way the row was typed', () => {
			for (const txType of ['incoming', 'outgoing', 'token_in', 'token_out', 'contract']) {
				expect(walletOfRow({ ...base, fromAddress: EVM, toAddress: EVM2, txType }, ctx).legs.map((l) => l.side)).toEqual(['out', 'in']);
			}
		});

		it('a send to an address of the same wallet is two legs in one wallet', () => {
			const r = walletOfRow({ ...base, fromAddress: EVM, toAddress: EVM_LOWER, txType: 'outgoing' }, ctx);
			expect(r.legs).toEqual([
				{ side: 'out', wallet: `ethereum:${EVM_LOWER}` },
				{ side: 'in', wallet: `ethereum:${EVM_LOWER}` },
			]);
		});

		it('with no direction on the row (a contract call), the tracked side tells', () => {
			expect(walletOfRow({ ...base, fromAddress: EVM, toAddress: OUTSIDE, txType: 'aave_supply' }, ctx).legs).toEqual([{ side: 'out', wallet: `ethereum:${EVM_LOWER}` }]);
			expect(walletOfRow({ ...base, fromAddress: OUTSIDE, toAddress: EVM, txType: null }, ctx).legs).toEqual([{ side: 'in', wallet: `ethereum:${EVM_LOWER}` }]);
		});

		it('the chain is normalized, and one address on two chains is two wallets', () => {
			expect(walletOfRow({ ...base, chain: 'eth', fromAddress: EVM, toAddress: OUTSIDE, txType: 'outgoing' }, ctx).legs[0].wallet).toBe(`ethereum:${EVM_LOWER}`);
			expect(walletOfRow({ ...base, chain: 'polygon', fromAddress: EVM, toAddress: OUTSIDE, txType: 'outgoing' }, ctx).legs[0].wallet).toBe(`polygon:${EVM_LOWER}`);
		});

		it('with no tracked address on the row, or no address index, it keys on its wallet_id', () => {
			expect(walletOfRow({ ...base, fromAddress: OUTSIDE, toAddress: OUTSIDE, txType: 'outgoing' }, ctx)).toEqual({
				legs: [{ side: 'out', wallet: `ethereum:${EVM_LOWER}` }],
				basis: 'wallet',
			});
			expect(walletOfRow({ ...base, walletId: 'w-evm2', fromAddress: EVM, toAddress: OUTSIDE, txType: 'outgoing' }, { wallets })).toEqual({
				legs: [{ side: 'out', wallet: `ethereum:${EVM2}` }],
				basis: 'wallet',
			});
		});

		it('a row typed outgoing whose from address is not tracked keys on its wallet_id, not on the other side', () => {
			expect(walletOfRow({ ...base, walletId: 'w-evm2', fromAddress: OUTSIDE, toAddress: EVM, txType: 'outgoing' }, ctx).legs).toEqual([{ side: 'out', wallet: `ethereum:${EVM2}` }]);
		});

		it('a row with no wallet at all lands on the chain\'s unassigned bucket', () => {
			expect(walletOfRow({ origin: 'onchain', chain: 'polygon', fromAddress: OUTSIDE, toAddress: OUTSIDE }, ctx)).toEqual({
				legs: [{ side: null, wallet: 'polygon:unassigned' }],
				basis: 'unassigned',
			});
		});

		it('a manual custom-wallet entry keys on its wallet_id', () => {
			expect(walletOfRow({ origin: 'onchain', chain: 'custom', walletId: 'w-custom', txType: 'buy' }, ctx)).toEqual({
				legs: [{ side: null, wallet: 'custom:custom_abc123' }],
				basis: 'wallet',
			});
		});

		it('a row on an exchange mirror wallet keys as that exchange account', () => {
			expect(walletOfRow({ origin: 'onchain', chain: 'ethereum', walletId: 'w-mirror' }, ctx).legs[0].wallet).toBe(`cex:crypto_com:${ACCT}`);
		});
	});

	describe('Sui rows', () => {
		it('key on their wallet_id', () => {
			expect(walletOfRow({ origin: 'sui', walletId: 'w-sui' }, ctx)).toEqual({ legs: [{ side: null, wallet: `sui:${SUI}` }], basis: 'wallet' });
		});

		it("a wallet the tenant does not have is sui:unassigned", () => {
			expect(walletOfRow({ origin: 'sui', walletId: 'gone' }, ctx)).toEqual({ legs: [{ side: null, wallet: 'sui:unassigned' }], basis: 'unassigned' });
			expect(walletOfRow({ origin: 'sui' }, ctx).legs[0].wallet).toBe('sui:unassigned');
		});
	});
});
