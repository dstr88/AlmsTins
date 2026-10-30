import { describe, expect, it } from 'vitest';
import {
  XPR_ACCOUNT_NAME,
  XPR_TX_ID,
  isXprAccountName,
  normalizeXprAccountName,
	BECH32_ADDRESS,
	EVM_ADDRESS,
	EVM_ADDRESS_ANY_PREFIX,
	EVM_ADDRESS_ANY_PREFIX_SOURCE,
	EVM_ADDRESS_LOWER,
	EVM_ADDRESS_SOURCE,
	EVM_TX_HASH,
	EVM_TX_HASH_LOWER,
	SOLANA_ADDRESS,
	SUI_ADDRESS,
	bech32Pattern,
	findEvmAddress,
	isEvmAddress,
} from '@/lib/addressFormats';

/**
 * Proof that moving the address patterns into src/lib/addressFormats.ts changed nothing: each
 * shared pattern is compared with the literal it replaced (copied here from the old code) on a
 * generated corpus. The one intended difference, the bech32 prefixes, is pinned at the end.
 */

// A small deterministic generator, so a failure is reproducible.
function rng(seed: number) {
	let x = seed >>> 0;
	return () => {
		x = (x * 1664525 + 1013904223) >>> 0;
		return x / 2 ** 32;
	};
}
const rand = rng(20261025);
const pick = (chars: string, n: number) => Array.from({ length: n }, () => chars[Math.floor(rand() * chars.length)]).join('');

const HEX_MIXED = '0123456789abcdefABCDEF';
const HEX_LOWER = '0123456789abcdef';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const NOISE = 'bio1OIl0xX:?@ -_/.';

function corpus(): string[] {
	const out: string[] = ['', ' ', '0x', '0X', 'cex:coinbase:abc'];
	for (let i = 0; i < 400; i++) {
		const len = 36 + Math.floor(rand() * 32); // 36..67 hex digits
		const hex = pick(rand() < 0.5 ? HEX_LOWER : HEX_MIXED, len);
		const prefix = ['0x', '0X', '', 'x'][Math.floor(rand() * 4)];
		out.push(prefix + hex);
		out.push(`ethereum:${prefix}${hex}@1?value=1`);
		out.push(` ${prefix}${hex} `);
		out.push(prefix + hex.slice(0, 20) + pick(NOISE, 1) + hex.slice(21));
	}
	for (let i = 0; i < 300; i++) {
		const hrp = ['bc', 'tb', 'bcrt', 'ltc', 'tltc', 'BC', 'LTC', 'xc', 'b'][Math.floor(rand() * 9)];
		const len = 4 + Math.floor(rand() * 90);
		out.push(`${hrp}1${pick(BECH32, len)}`);
		out.push(`${hrp}1${pick(BECH32 + NOISE, len)}`);
		out.push(`${hrp}1${pick(BECH32, len)}`.toUpperCase());
	}
	for (let i = 0; i < 300; i++) {
		const len = 25 + Math.floor(rand() * 30);
		out.push(pick(BASE58, len));
		out.push(pick(BASE58 + '0OIl', len));
		out.push(`${['1', '3', 'L', 'M', 'T'][Math.floor(rand() * 5)]}${pick(BASE58, len)}`);
	}
	return out;
}
const CORPUS = corpus();

function sameOn(a: RegExp, b: RegExp) {
	for (const s of CORPUS) expect([s, a.test(s)]).toEqual([s, b.test(s)]);
}

function sameMatches(a: RegExp, b: RegExp) {
	for (const s of CORPUS) {
		const text = `see ${s} and ${s.split('').reverse().join('')} then 0x${'ab'.repeat(20)}`;
		expect([...text.matchAll(a)].map((m) => m[0])).toEqual([...text.matchAll(b)].map((m) => m[0]));
	}
}

describe('addressFormats: the shared patterns accept exactly what the copies they replaced did', () => {
	it('EVM_ADDRESS is the mixed-case pattern (walletKey, walletChecker, safetyCheck, sync-aave, verifyProof, walletIdentity)', () => {
		sameOn(EVM_ADDRESS, /^0x[0-9a-fA-F]{40}$/);
		sameOn(EVM_ADDRESS, /^0x[a-fA-F0-9]{40}$/);
	});

	it('EVM_ADDRESS on a lowercased value is the lowercase test on it (addressNetwork, WalletOverview, wallets-service)', () => {
		for (const s of CORPUS) {
			const lower = s.toLowerCase();
			expect([s, EVM_ADDRESS.test(lower)]).toEqual([s, /^0x[a-f0-9]{40}$/.test(lower)]);
		}
	});

	it('EVM_ADDRESS_LOWER is the lowercase-only pattern (explorerLinks, transfers, threatLists, verifyRegistry)', () => {
		sameOn(EVM_ADDRESS_LOWER, /^0x[0-9a-f]{40}$/);
	});

	it('EVM_ADDRESS_ANY_PREFIX is the case-insensitive pattern (aave client, liquidations, currentHoldings, agent vault)', () => {
		sameOn(EVM_ADDRESS_ANY_PREFIX, /^0x[0-9a-f]{40}$/i);
		sameOn(EVM_ADDRESS_ANY_PREFIX, /^0[xX][0-9a-fA-F]{40}$/);
	});

	it('the agent vault token pattern is unchanged', () => {
		sameMatches(
			new RegExp(`(?<![0-9A-Za-z])${EVM_ADDRESS_ANY_PREFIX_SOURCE}(?![0-9A-Za-z])`, 'g'),
			/(?<![0-9A-Za-z])0[xX][0-9A-Fa-f]{40}(?![0-9A-Za-z])/g,
		);
	});

	it('findEvmAddress is the first unanchored match (WalletChecker, VerifyDashboard, VerifyScan, verifyRegistry)', () => {
		for (const s of CORPUS) expect([s, findEvmAddress(s)]).toEqual([s, s.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null]);
		sameMatches(new RegExp(EVM_ADDRESS_SOURCE, 'g'), /0x[a-fA-F0-9]{40}/g);
	});

	it('isEvmAddress trims, as walletKey did', () => {
		for (const s of CORPUS) expect([s, isEvmAddress(s)]).toEqual([s, /^0x[0-9a-fA-F]{40}$/.test(s.trim())]);
		expect(isEvmAddress(undefined)).toBe(false);
		expect(isEvmAddress(42)).toBe(false);
	});

	it('the mail and auto-classify extraction patterns are unchanged', () => {
		sameMatches(
			new RegExp(`\\b(${EVM_ADDRESS_SOURCE}|bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|[1-9A-HJ-NP-Za-km-z]{32,44})\\b`, 'g'),
			/\b(0x[a-fA-F0-9]{40}|bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g,
		);
		sameMatches(
			new RegExp(`\\b(${EVM_ADDRESS_SOURCE}|bc1[a-zA-HJ-NP-Z0-9]{25,}|[13][a-zA-HJ-NP-Z0-9]{25,}|[A-HJ-NP-Za-km-z1-9]{32,44})\\b`, 'g'),
			/\b(0x[a-fA-F0-9]{40}|bc1[a-zA-HJ-NP-Z0-9]{25,}|[13][a-zA-HJ-NP-Z0-9]{25,}|[A-HJ-NP-Za-km-z1-9]{32,44})\b/g,
		);
	});

	it('transaction hash, Sui and Solana patterns are unchanged', () => {
		sameOn(EVM_TX_HASH, /^0x[0-9a-fA-F]{64}$/);
		sameOn(EVM_TX_HASH_LOWER, /^0x[0-9a-f]{64}$/);
		sameOn(SUI_ADDRESS, /^0x[0-9a-fA-F]{64}$/);
		sameOn(SOLANA_ADDRESS, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
	});

	it('a one-chain bech32 pattern is the old per-chain one (walletChecker, explorerLinks)', () => {
		sameOn(bech32Pattern('bc'), /^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}$/);
		sameOn(bech32Pattern('ltc'), /^ltc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}$/);
		sameOn(bech32Pattern('bc'), /^bc1[02-9ac-hj-np-z]{6,87}$/);
		sameOn(bech32Pattern('ltc'), /^ltc1[02-9ac-hj-np-z]{6,87}$/);
	});
});

describe('addressFormats: one bech32 prefix list (the intended change)', () => {
	const VERIFY_REGISTRY_OLD = /^(bc|tb|bcrt|ltc|tltc)1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}$/;
	const WALLETS_SERVICE_OLD = /^(bc1|ltc1|tb1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}$/;

	it('is exactly what verifyRegistry already accepted', () => {
		sameOn(BECH32_ADDRESS, VERIFY_REGISTRY_OLD);
	});

	it('widens wallets-service only by the regtest and Litecoin testnet prefixes', () => {
		for (const s of CORPUS) {
			if (BECH32_ADDRESS.test(s) === WALLETS_SERVICE_OLD.test(s)) continue;
			expect(WALLETS_SERVICE_OLD.test(s)).toBe(false);
			expect(s.startsWith('bcrt1') || s.startsWith('tltc1')).toBe(true);
		}
		expect(BECH32_ADDRESS.test(`bcrt1${'q'.repeat(20)}`)).toBe(true);
		expect(BECH32_ADDRESS.test(`tltc1${'q'.repeat(20)}`)).toBe(true);
	});
});

describe('XPR Network account names', () => {
	// Checked against the chain's own answers (get_account on proton.eosusa.io, 2026-10-30): a name
	// the chain normalizes is valid, any other is refused ("Name not properly normalized").
	it.each([
		'a', 'abc', 'testalice1', 'a.b.c', '1abc', '12345.12345', 'aaaaaaaaaaaa', 'stake.proton', 'eosio.token',
		'aaaaaaaaaaaaj', 'aaaaaaaaaaaa5', '.abc', 'bc1qabc',
	])('accepts %s', (name) => {
		expect(XPR_ACCOUNT_NAME.test(name), name).toBe(true);
	});

	it.each([
		'', 'ABC', 'Abc', 'abc.', 'abc..', 'a b', 'abc_d', 'abc6', 'abc0', 'abc9', 'aaaaaaaaaaaaaa',
		// The 13th character is limited to .12345abcdefghij, and not '.'.
		'aaaaaaaaaaaak', 'aaaaaaaaaaaaz', 'aaaaaaaaaaaa.',
		'0xabc', 'é', 'abc\n',
	])('refuses %j', (name) => {
		expect(XPR_ACCOUNT_NAME.test(name), name).toBe(false);
	});

	it('normalizes what was typed: trimmed, lowercase; null when it is not a name', () => {
		expect(normalizeXprAccountName('  TestAlice1 ')).toBe('testalice1');
		expect(normalizeXprAccountName('Has Space')).toBeNull();
		expect(normalizeXprAccountName('abc.')).toBeNull();
		expect(normalizeXprAccountName(42)).toBeNull();
		expect(normalizeXprAccountName(null)).toBeNull();
		expect(isXprAccountName(' TESTALICE1')).toBe(true);
		expect(isXprAccountName('nope!')).toBe(false);
	});

	it('a transaction id is 64 hex digits', () => {
		expect(XPR_TX_ID.test('ab'.repeat(32))).toBe(true);
		expect(XPR_TX_ID.test('AB'.repeat(32))).toBe(true);
		expect(XPR_TX_ID.test('ab'.repeat(31))).toBe(false);
		expect(XPR_TX_ID.test(`0x${'ab'.repeat(32)}`)).toBe(false);
	});

	it('looks like ordinary text, which is why an XPR wallet is added with an explicit chain choice', () => {
		// A real account name can have the shape of a Bitcoin address start, and any word is a name.
		expect(XPR_ACCOUNT_NAME.test('1abc')).toBe(true);
		expect(XPR_ACCOUNT_NAME.test('alice')).toBe(true);
	});
});
