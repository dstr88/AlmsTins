import { describe, it, expect } from 'vitest';
import {
	DUST_USD,
	findLookalike,
	isDustTransfer,
	isLookalike,
	isTrustedSource,
	poisoningFindings,
	sameAddressKey,
	type AddressBookEntry,
	type PoisonTransfer,
} from '../../src/lib/addressPoisoning';

/**
 * The address-poisoning rules (phase 1 of the poisoning-warnings plan). The addresses below are
 * invented; they only have each chain's shape. Decisions under test (Donnie, Nov 16, 2026): under
 * $1 is dust, an unpriced token is dust, only entries the user saved count as trusted, and a
 * look-alike shares the first 4 and last 4 characters after the network prefix.
 */

// EVM: 0x + 4 + 32 + 4 hex digits.
const COINBASE = `0xAbCd${'1'.repeat(32)}9F3e`;
const COINBASE_LOWER = COINBASE.toLowerCase();
const POISON = `0xabcd${'7'.repeat(32)}9f3e`;
const TAIL_OFF_BY_ONE = `0xabcd${'7'.repeat(32)}9f3f`;
const HEAD_OFF_BY_ONE = `0xabce${'7'.repeat(32)}9f3e`;
const MIDDLE_OFF_BY_ONE = `0xAbCd${'1'.repeat(31)}29F3e`;
const STRANGER = `0x${'5'.repeat(40)}`;
const SUI_SAME_ENDS = `0xabcd${'7'.repeat(56)}9f3e`;

// Bitcoin bech32: every address starts bc1q, so the compared part starts after it.
const BTC_SAVED = `bc1qxy2k${'g'.repeat(30)}wlh0`;
const BTC_POISON = `bc1qxy2k${'s'.repeat(30)}wlh0`;
const BTC_SHARES_ONLY_PREFIX = `bc1qzz9d${'s'.repeat(30)}wlh0`;

// Solana: base58, case-sensitive, no prefix.
const SOL_SAVED = `SoEx${'a'.repeat(30)}Pe9z`;
const SOL_POISON = `SoEx${'b'.repeat(30)}Pe9z`;
const SOL_CASE_TWIN = `soex${'b'.repeat(30)}pe9Z`;

const book: AddressBookEntry[] = [
	{ address: COINBASE_LOWER, label: 'Coinbase deposit', source: 'user' },
	{ address: BTC_SAVED, label: 'Cold storage', source: 'user' },
	{ address: SOL_SAVED, label: 'Phantom', source: 'user' },
];

const dustIn = (counterparty: string, extra: Partial<PoisonTransfer> = {}): PoisonTransfer => ({
	counterparty,
	direction: 'in',
	amount: 0.0001,
	usd: 0.01,
	tokenSymbol: 'USDT',
	...extra,
});

describe('sameAddressKey', () => {
	it('treats a checksummed and a lower-case EVM address as the same address', () => {
		expect(sameAddressKey(COINBASE)).toBe(sameAddressKey(COINBASE_LOWER));
	});

	it('lowercases bech32 and keeps base58 exactly as given', () => {
		expect(sameAddressKey(BTC_SAVED.toUpperCase())).toBe(BTC_SAVED);
		expect(sameAddressKey(SOL_SAVED)).toBe(SOL_SAVED);
		expect(sameAddressKey(SOL_SAVED.toLowerCase())).not.toBe(SOL_SAVED);
	});

	it('gives null for an exchange account id and for nothing at all', () => {
		expect(sameAddressKey('cex:coinbase:123')).toBeNull();
		expect(sameAddressKey('')).toBeNull();
		expect(sameAddressKey(null)).toBeNull();
	});
});

describe('isLookalike', () => {
	it('catches a real look-alike: same first 4 and last 4, different middle', () => {
		expect(isLookalike(POISON, COINBASE)).toBe(true);
	});

	it('is never true for the same address, whatever its case', () => {
		expect(isLookalike(COINBASE, COINBASE_LOWER)).toBe(false);
		expect(isLookalike(COINBASE, COINBASE)).toBe(false);
	});

	it('needs both ends: one character off at either end is not a look-alike', () => {
		expect(isLookalike(TAIL_OFF_BY_ONE, COINBASE)).toBe(false);
		expect(isLookalike(HEAD_OFF_BY_ONE, COINBASE)).toBe(false);
	});

	it('catches a one-character difference in the middle', () => {
		expect(isLookalike(MIDDLE_OFF_BY_ONE, COINBASE)).toBe(true);
	});

	it('does not count the shared 0x prefix as a match', () => {
		expect(isLookalike(STRANGER, COINBASE)).toBe(false);
	});

	it('only compares addresses on the same kind of network', () => {
		expect(isLookalike(SUI_SAME_ENDS, COINBASE)).toBe(false);
	});

	it('compares bech32 after bc1q, so the shared prefix alone is not a match', () => {
		expect(isLookalike(BTC_POISON, BTC_SAVED)).toBe(true);
		expect(isLookalike(BTC_SHARES_ONLY_PREFIX, BTC_SAVED)).toBe(false);
	});

	it('compares base58 ends without case, since a reader does not notice it', () => {
		expect(isLookalike(SOL_POISON, SOL_SAVED)).toBe(true);
		expect(isLookalike(SOL_CASE_TWIN, SOL_SAVED)).toBe(true);
	});
});

describe('findLookalike', () => {
	it('names the saved entry the address imitates', () => {
		expect(findLookalike(POISON, book)?.label).toBe('Coinbase deposit');
	});

	it('trusts only entries the user saved, not automatic or imported ones', () => {
		expect(isTrustedSource('user')).toBe(true);
		expect(isTrustedSource('auto')).toBe(false);
		expect(isTrustedSource('system')).toBe(false);
		const autoOnly: AddressBookEntry[] = [
			{ address: COINBASE_LOWER, label: 'Coinbase (matched)', source: 'auto' },
			{ address: BTC_SAVED, label: 'Avalanche import', source: 'system' },
		];
		expect(findLookalike(POISON, autoOnly)).toBeNull();
		expect(findLookalike(BTC_POISON, autoOnly)).toBeNull();
	});
});

describe('isDustTransfer', () => {
	it('is dust under $1 and not dust at $1 or more', () => {
		expect(DUST_USD).toBe(1);
		expect(isDustTransfer(dustIn(STRANGER, { usd: 0.99 }))).toBe(true);
		expect(isDustTransfer(dustIn(STRANGER, { usd: 1 }))).toBe(false);
		expect(isDustTransfer(dustIn(STRANGER, { usd: 250 }))).toBe(false);
	});

	it('is dust for a zero-value transfer, even one with a price', () => {
		expect(isDustTransfer(dustIn(STRANGER, { amount: 0, usd: 0 }))).toBe(true);
	});

	it('is dust for a token with no price', () => {
		expect(isDustTransfer(dustIn(STRANGER, { amount: 5000, usd: null, tokenSymbol: 'UNKNOWN' }))).toBe(true);
	});

	it('is dust for a token already flagged as spam, whatever it claims to be worth', () => {
		expect(isDustTransfer(dustIn(STRANGER, { usd: 500, tokenSymbol: 'USDT', tokenName: 'Claim at usdt-gift.xyz' }))).toBe(true);
	});

	it('reads a negative value by its size', () => {
		expect(isDustTransfer(dustIn(STRANGER, { usd: -0.5 }))).toBe(true);
		expect(isDustTransfer(dustIn(STRANGER, { usd: -20 }))).toBe(false);
	});
});

describe('poisoningFindings', () => {
	it('flags an innocent airdrop as dust-only, not as a look-alike', () => {
		const found = poisoningFindings([dustIn(STRANGER, { tokenSymbol: 'ARB', usd: 0.4 })], book);
		const f = found.get(sameAddressKey(STRANGER)!);
		expect(f?.signal).toBe('dust-only');
		expect(f?.imitates).toBeNull();
	});

	it('flags the classic pattern (dust from a look-alike) as both, naming the entry', () => {
		const found = poisoningFindings([dustIn(POISON, { amount: 0, usd: 0 })], book);
		const f = found.get(sameAddressKey(POISON)!);
		expect(f?.signal).toBe('both');
		expect(f?.imitates?.label).toBe('Coinbase deposit');
	});

	it('flags a look-alike the user paid, which is the loss the warning is for', () => {
		const found = poisoningFindings(
			[{ counterparty: POISON, direction: 'out', amount: 1200, usd: 1200, tokenSymbol: 'USDC' }],
			book,
		);
		expect(found.get(sameAddressKey(POISON)!)?.signal).toBe('lookalike');
	});

	it('clears dust-only once the user has sent to the address', () => {
		const found = poisoningFindings(
			[dustIn(STRANGER), { counterparty: STRANGER, direction: 'out', amount: 0.001, usd: 0.3, tokenSymbol: 'ETH' }],
			book,
		);
		expect(found.has(sameAddressKey(STRANGER)!)).toBe(false);
	});

	it('clears dust-only once the address has sent a real amount', () => {
		const found = poisoningFindings([dustIn(STRANGER), dustIn(STRANGER, { amount: 40, usd: 40 })], book);
		expect(found.has(sameAddressKey(STRANGER)!)).toBe(false);
	});

	it('never flags an address the user saved, even if it only ever sent dust', () => {
		const found = poisoningFindings([dustIn(COINBASE)], book);
		expect(found.size).toBe(0);
	});

	it('does flag a dust-only address the book has only as an automatic entry', () => {
		const autoBook: AddressBookEntry[] = [{ address: STRANGER, label: 'Matched', source: 'auto' }];
		expect(poisoningFindings([dustIn(STRANGER)], autoBook).get(sameAddressKey(STRANGER)!)?.signal).toBe('dust-only');
	});

	it('groups a checksummed and a lower-case counterparty as one address', () => {
		const found = poisoningFindings([dustIn(POISON.toUpperCase().replace('0X', '0x')), dustIn(POISON)], book);
		expect(found.size).toBe(1);
		expect(found.get(sameAddressKey(POISON)!)?.transfers).toBe(2);
	});

	it('reports when it first appeared and what it sent, counting priced transfers only', () => {
		const found = poisoningFindings(
			[
				dustIn(STRANGER, { usd: 0.25, at: '2026-11-10T08:00:00Z' }),
				dustIn(STRANGER, { usd: 0.5, at: '2026-11-02T08:00:00Z' }),
				dustIn(STRANGER, { usd: null, tokenSymbol: 'FAKE', at: '2026-11-05T08:00:00Z' }),
			],
			book,
		);
		const f = found.get(sameAddressKey(STRANGER)!);
		expect(f?.firstAt).toBe('2026-11-02T08:00:00Z');
		expect(f?.usdIn).toBeCloseTo(0.75);
		expect(f?.transfers).toBe(3);
	});

	it('skips exchange account ids and missing counterparties', () => {
		const found = poisoningFindings([dustIn('cex:coinbase:42'), dustIn('')], book);
		expect(found.size).toBe(0);
	});
});
