import { describe, it, expect } from 'vitest';
import { findWalletAddressInText, isWalletAddressWord } from '../../src/lib/addressFormats';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The transfer matcher labels the destination address written in an exchange withdrawal's
 * description. It used to take any run of 25 letters and digits, which also caught transaction
 * hashes and exchange ids. Addresses below are invented, with each chain's shape.
 */

const EVM = `0xAbCd${'1'.repeat(32)}9F3e`;
const EVM_TX = `0x${'ab'.repeat(32)}`;
const BECH32 = `bc1q${'w508d6qejxtdg4y5r3zarvary0c5xw7k'}`;
const LTC_BECH32 = `ltc1q${'g7x4'.repeat(9)}`;
const LEGACY = `1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2`;
const SOLANA = `So${'Ex4mPe'.repeat(6)}`;

describe('isWalletAddressWord', () => {
	it('accepts EVM, bech32, legacy base58 and Solana addresses', () => {
		for (const a of [EVM, EVM.toLowerCase(), BECH32, BECH32.toUpperCase(), LTC_BECH32, LEGACY, SOLANA]) {
			expect(isWalletAddressWord(a), a).toBe(true);
		}
	});

	it('rejects transaction hashes, Sui-length hex and exchange ids', () => {
		expect(isWalletAddressWord(EVM_TX)).toBe(false);
		expect(isWalletAddressWord('ab'.repeat(32))).toBe(false); // a bare 64-hex hash (Bitcoin txid, XPR)
		expect(isWalletAddressWord('9f2c4e1ab3d5f7c9e1a2b4c6d8e9f1a3')).toBe(false); // a hex id
		expect(isWalletAddressWord('WITHDRAWAL20261117ABCDEFGHJK')).toBe(false); // an internal reference
		expect(isWalletAddressWord('ABCDEFGHJKMNPQRSTUVWXYZ23456789ABCD')).toBe(false); // a one-case reference code
		expect(isWalletAddressWord('')).toBe(false);
	});
});

describe('findWalletAddressInText', () => {
	it('finds the address even when a transaction hash comes first', () => {
		expect(findWalletAddressInText(`Withdraw ETH tx ${EVM_TX} to ${EVM}`)).toBe(EVM);
	});

	it('finds nothing in a description that only carries a hash or an id', () => {
		expect(findWalletAddressInText(`Withdrawal txid ${'cd'.repeat(32)} ref WITHDRAWAL20261117ABCDEFGHJK`)).toBeNull();
		expect(findWalletAddressInText(null)).toBeNull();
	});

	it('finds Bitcoin, Litecoin and Solana addresses', () => {
		expect(findWalletAddressInText(`Send BTC to ${BECH32}`)).toBe(BECH32);
		expect(findWalletAddressInText(`LTC -> ${LTC_BECH32}`)).toBe(LTC_BECH32);
		expect(findWalletAddressInText(`to ${LEGACY} (legacy)`)).toBe(LEGACY);
		expect(findWalletAddressInText(`SOL withdrawal ${SOLANA}`)).toBe(SOLANA);
	});
});

describe('the transfer matcher', () => {
	it('labels only a real address, in its canonical form', () => {
		const src = readFileSync(path.resolve(__dirname, '../../src/lib/transferMatcher.ts'), 'utf8');
		expect(src).toMatch(/findWalletAddressInText\(outTx\.description\)/);
		expect(src).toMatch(/canonicalAddress\(found\)/);
		expect(src).not.toMatch(/\{25,\}\)\\b/);
	});
});
