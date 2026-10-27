import { describe, it, expect } from 'vitest';
import { eventWalletKey, walletContextOf, walletDisplayOf } from '../../src/lib/tax/eventWallet';

/**
 * Which wallet a lifecycle event belongs to. The addresses are invented; the wallets table is the
 * only thing the resolver reads, so nothing here touches a database.
 */
const A = `0x${'a'.repeat(40)}`;
const B = `0x${'b'.repeat(40)}`;
const ctx = walletContextOf([
	{ id: 'w1', address: A },
	{ id: 'w2', address: B },
]);

describe('eventWalletKey', () => {
	it('an on-chain import row keys on its wallet and chain', () => {
		const key = eventWalletKey(
			{ sourceType: 'import', direction: 'in', importSource: 'bitcoin', importWalletId: 'w1' },
			ctx,
		);
		expect(key).toBe(`bitcoin:${A}`);
	});

	it('an exchange import row keys on its account', () => {
		const key = eventWalletKey(
			{ sourceType: 'import', direction: 'out', importSource: 'coinbase', importAccountId: 'acct-7' },
			ctx,
		);
		expect(key).toBe('cex:coinbase:acct-7');
	});

	it('an incoming on-chain row keys on the wallet that received it', () => {
		const key = eventWalletKey(
			{ sourceType: 'onchain', direction: 'in', txWalletId: 'w2', txChain: 'polygon', fromAddress: '0x' + 'c'.repeat(40), toAddress: B },
			ctx,
		);
		expect(key).toBe(`polygon:${B}`);
	});

	it('a source that is neither an import nor on-chain has no wallet', () => {
		expect(eventWalletKey({ sourceType: 'manual', direction: 'in' }, ctx)).toBeNull();
	});
});

describe('walletDisplayOf', () => {
	it('shows the address of an on-chain wallet', () => {
		expect(walletDisplayOf(`polygon:${A}`)).toBe(A);
	});

	it('shows the source and account of an exchange account', () => {
		expect(walletDisplayOf('cex:coinbase:acct-7')).toBe('coinbase · acct-7');
	});

	it('shows nothing for an unassigned or missing key', () => {
		expect(walletDisplayOf(null)).toBeNull();
		expect(walletDisplayOf('polygon:unassigned')).toBeNull();
	});
});
