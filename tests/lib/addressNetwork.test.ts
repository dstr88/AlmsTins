import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { addressNetwork, isOnchainAddress } from '../../src/lib/addressNetwork';

/**
 * The address recognizer shared by the Address Labels list and GET /api/address-history. The
 * values below are invented; they only have each chain's shape.
 */

const EVM_ADDR = `0x${'ab12'.repeat(10)}`;
const SUI_ADDR = `0x${'9a8b'.repeat(16)}`;
const BTC_BECH32 = `bc1q${'x3'.repeat(19)}`;
const BTC_LEGACY = `1${'ex4mp'.repeat(6)}`;
const BTC_P2SH = `3${'ex4mp'.repeat(6)}`;
const LTC_BECH32 = `ltc1q${'w7'.repeat(19)}`;
const LTC_LEGACY = `L${'Ex4mp'.repeat(6)}`;
const SOL_ADDR = `So${'Ex4mPe'.repeat(6)}`;

describe('addressNetwork', () => {
	it.each([
		[EVM_ADDR, 'evm'],
		[EVM_ADDR.toUpperCase().replace('0X', '0x'), 'evm'],
		[SUI_ADDR, 'sui'],
		[BTC_BECH32, 'btc'],
		[BTC_BECH32.toUpperCase(), 'btc'],
		[BTC_LEGACY, 'btc'],
		[BTC_P2SH, 'btc'],
		[LTC_BECH32, 'ltc'],
		[LTC_LEGACY, 'ltc'],
		[`M${LTC_LEGACY.slice(1)}`, 'ltc'],
		[SOL_ADDR, 'sol'],
		[SOL_ADDR.toLowerCase(), 'sol'],
	])('%s is %s', (address, network) => {
		expect(addressNetwork(address)).toBe(network);
	});

	it('an exchange account id is not an on-chain address', () => {
		expect(addressNetwork('cex:crypto_com:11111111-1111-4111-8111-111111111111')).toBeNull();
		expect(addressNetwork('CEX:coinbase:abc')).toBeNull();
		expect(isOnchainAddress('cex:crypto_com:abc')).toBe(false);
	});

	it('anything else is null', () => {
		for (const v of ['', 'hello world', '0x1234', `0x${'zz'.repeat(20)}`, '@burn']) {
			expect(addressNetwork(v), v).toBeNull();
			expect(isOnchainAddress(v), v).toBe(false);
		}
	});

	it('a real Solana key mixes upper and lower case, and still reads as Solana', () => {
		expect(addressNetwork('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin')).toBe('sol');
		// 0, O, I and l are not base58.
		expect(addressNetwork(`O${SOL_ADDR.slice(1)}`)).toBeNull();
	});

	it('Litecoin is checked before Bitcoin, and Sui (64 hex digits) before EVM (40)', () => {
		expect(addressNetwork(LTC_BECH32)).toBe('ltc');
		expect(addressNetwork(SUI_ADDR)).toBe('sui');
		expect(addressNetwork(SUI_ADDR.slice(0, 42))).toBe('evm');
	});

	it('known ambiguity: a Solana key that starts with 1 or 3 reads as a legacy Bitcoin address', () => {
		// Only the stored chain can tell them apart (src/lib/sync/syncBtcAddress.ts notes the same).
		expect(addressNetwork(`1${SOL_ADDR.slice(1)}`)).toBe('btc');
		expect(addressNetwork(`3${SOL_ADDR.slice(1)}`)).toBe('btc');
	});

	it('isOnchainAddress is true for every recognized network', () => {
		for (const v of [EVM_ADDR, SUI_ADDR, BTC_BECH32, BTC_LEGACY, LTC_BECH32, LTC_LEGACY, SOL_ADDR]) {
			expect(isOnchainAddress(v), v).toBe(true);
		}
	});
});

describe('AddressLabels uses the shared recognizer', () => {
	const src = readFileSync(path.resolve(__dirname, '../../src/components/dashboard/AddressLabels.tsx'), 'utf8');

	it('imports addressNetwork and keeps no copy of its own', () => {
		expect(src).toMatch(/import \{ addressNetwork \} from '@\/lib\/addressNetwork'/);
		expect(src).not.toMatch(/function detectNetwork/);
	});

	it('the badge keys stay the upper-case names the colors use, with ??? for anything else', () => {
		expect(src).toMatch(/addressNetwork\(l\.address\)\?\.toUpperCase\(\) \?\? '\?\?\?'/);
		for (const key of ['EVM', 'BTC', 'LTC', 'SOL', 'SUI', "'???'"]) expect(src).toContain(`${key}:`);
	});
});

describe('an XPR Network account name has no network of its own', () => {
	// A name is plain text, so the shape cannot say it is XPR: the stored chain does (wallets.chains,
	// import source 'xpr'). The recognizer must not claim one either way.
	it('an ordinary name is not an address', () => {
		for (const name of ['testalice1', 'stake.proton', 'eosio.token']) expect(addressNetwork(name), name).toBeNull();
	});

	it('a name that starts like a legacy Bitcoin address is read as one by shape alone, which is why callers pass the stored chain', () => {
		expect(addressNetwork('1abc')).toBe('btc');
	});
});
