import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	RECENT_ADDRESSES_KEY,
	RECENT_ADDRESSES_MAX,
	clearRecentAddresses,
	parseRecentAddresses,
	readRecentAddresses,
	recentAddressKey,
	rememberRecentAddress,
	withRecentAddress,
	type RecentStorage,
} from '../../src/lib/recentAddresses';

/**
 * The recently checked list behind the wallet checker (src/lib/recentAddresses.ts): newest first,
 * one entry per address, capped, cleared on request, and never broken by what storage holds or by
 * storage refusing to work. Every address here is invented. No DOM, no network: storage is a Map.
 */

const evm = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
const SUI = `0x${'ab'.repeat(32)}`;
const SEGWIT = 'bc1qqpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BASE58 = 'AbCdEfGhJkMnPqRsTuVwXyZ23456789abcdefghijk';

function memoryStorage(initial?: string): RecentStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	if (initial !== undefined) data.set(RECENT_ADDRESSES_KEY, initial);
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => { data.set(k, String(v)); },
		removeItem: (k) => { data.delete(k); },
	};
}

const throwing: RecentStorage = {
	getItem: () => { throw new Error('SecurityError'); },
	setItem: () => { throw new Error('QuotaExceededError'); },
	removeItem: () => { throw new Error('SecurityError'); },
};

describe('recentAddressKey', () => {
	it('folds case for hex and segwit addresses, which are case-insensitive', () => {
		expect(recentAddressKey(`0x${'AbCd'.repeat(10)}`)).toBe(`0x${'abcd'.repeat(10)}`);
		expect(recentAddressKey(`0X${'AB'.repeat(20)}`)).toBe(`0x${'ab'.repeat(20)}`);
		expect(recentAddressKey(SUI.toUpperCase().replace('0X', '0x'))).toBe(SUI);
		expect(recentAddressKey(SEGWIT.toUpperCase())).toBe(SEGWIT);
	});

	it('keeps base58 as is, since its case is part of the address', () => {
		expect(recentAddressKey(BASE58)).toBe(BASE58);
		expect(recentAddressKey(BASE58.toLowerCase())).not.toBe(recentAddressKey(BASE58));
	});

	it('ignores surrounding whitespace', () => {
		expect(recentAddressKey(`  ${evm(1)}\n`)).toBe(evm(1));
	});
});

describe('withRecentAddress', () => {
	it('puts the newest first', () => {
		let list = withRecentAddress([], evm(1), 'evm');
		list = withRecentAddress(list, SEGWIT, 'bitcoin');
		list = withRecentAddress(list, BASE58, 'solana');
		expect(list.map((e) => e.address)).toEqual([BASE58, SEGWIT, evm(1)]);
	});

	it('moves an address checked again to the front instead of listing it twice', () => {
		let list = withRecentAddress([], evm(1), 'evm');
		list = withRecentAddress(list, evm(2), 'evm');
		list = withRecentAddress(list, evm(1), 'evm');
		expect(list.map((e) => e.address)).toEqual([evm(1), evm(2)]);
	});

	it('treats the checksum and lowercase forms of one EVM address as the same entry, keeping the latest form', () => {
		const lower = `0x${'abcdef'.repeat(6)}abcd`;
		const mixed = `0x${'AbCdEf'.repeat(6)}AbCd`;
		let list = withRecentAddress([], lower, 'evm');
		list = withRecentAddress(list, mixed, 'evm');
		expect(list).toEqual([{ address: mixed, chain: 'evm' }]);
	});

	it('keeps two base58 addresses that differ only in case apart', () => {
		let list = withRecentAddress([], BASE58, 'solana');
		list = withRecentAddress(list, BASE58.toLowerCase(), 'solana');
		expect(list).toHaveLength(2);
	});

	it(`keeps at most ${RECENT_ADDRESSES_MAX}, dropping the oldest`, () => {
		let list = withRecentAddress([], evm(0), 'evm');
		for (let n = 1; n <= RECENT_ADDRESSES_MAX + 4; n++) list = withRecentAddress(list, evm(n), 'evm');
		expect(list).toHaveLength(RECENT_ADDRESSES_MAX);
		expect(list[0].address).toBe(evm(RECENT_ADDRESSES_MAX + 4));
		expect(list.at(-1)!.address).toBe(evm(5));
	});

	it('stores the address trimmed, and a chain only when it is one the checker names', () => {
		expect(withRecentAddress([], `  ${evm(3)} `, 'evm')).toEqual([{ address: evm(3), chain: 'evm' }]);
		expect(withRecentAddress([], evm(3), 'unknown')[0].chain).toBeNull();
		expect(withRecentAddress([], evm(3), 'dogecoin')[0].chain).toBeNull();
		expect(withRecentAddress([], evm(3), null)[0].chain).toBeNull();
	});

	it('refuses a value that is not shaped like an address and leaves the list as it was', () => {
		const list = withRecentAddress([], evm(1), 'evm');
		for (const bad of ['', 'short', 'vitalik.eth', `${evm(1)} ${evm(2)}`, '<img src=x onerror=alert(1)>', 'a'.repeat(129)]) {
			expect(withRecentAddress(list, bad, 'evm')).toEqual(list);
		}
	});
});

describe('parseRecentAddresses: what storage holds is untrusted', () => {
	it('reads nothing, an empty string, broken JSON and non-arrays as an empty list', () => {
		for (const raw of [null, undefined, '', '{', 'null', '42', '"text"', '{"address":"x"}', 'true']) {
			expect(parseRecentAddresses(raw as string | null)).toEqual([]);
		}
	});

	it('drops entries that are not objects with an address-shaped string, and keeps the good ones in order', () => {
		const raw = JSON.stringify([
			{ address: evm(1), chain: 'evm' },
			null,
			7,
			'0x' + '1'.repeat(40),
			{ address: 12345 },
			{ address: '"><script>alert(1)</script>', chain: 'evm' },
			{ address: `${evm(2)}<b>`, chain: 'evm' },
			{ chain: 'evm' },
			{ address: SEGWIT, chain: '<i>bitcoin</i>' },
			{ address: BASE58, chain: 'solana', extra: 'ignored' },
		]);
		expect(parseRecentAddresses(raw)).toEqual([
			{ address: evm(1), chain: 'evm' },
			{ address: SEGWIT, chain: null },
			{ address: BASE58, chain: 'solana' },
		]);
	});

	it('de-duplicates and caps a list written by something else', () => {
		const many = Array.from({ length: 30 }, (_, n) => ({ address: evm(n % 15), chain: 'evm' }));
		const out = parseRecentAddresses(JSON.stringify(many));
		expect(out).toHaveLength(RECENT_ADDRESSES_MAX);
		expect(new Set(out.map((e) => e.address)).size).toBe(RECENT_ADDRESSES_MAX);
		expect(out[0].address).toBe(evm(0));
	});
});

describe('reading, remembering and clearing in storage', () => {
	it('remembers into storage, newest first, under one key', () => {
		const s = memoryStorage();
		rememberRecentAddress(evm(1), 'evm', s);
		const out = rememberRecentAddress(SUI, 'sui', s);
		expect(out.map((e) => e.address)).toEqual([SUI, evm(1)]);
		expect(readRecentAddresses(s)).toEqual(out);
		expect([...s.data.keys()]).toEqual([RECENT_ADDRESSES_KEY]);
		expect(JSON.parse(s.data.get(RECENT_ADDRESSES_KEY)!)).toEqual(out);
	});

	it('writes back a cleaned list when storage held bad data', () => {
		const s = memoryStorage('{not json');
		expect(readRecentAddresses(s)).toEqual([]);
		expect(rememberRecentAddress(evm(4), 'evm', s)).toEqual([{ address: evm(4), chain: 'evm' }]);
		expect(JSON.parse(s.data.get(RECENT_ADDRESSES_KEY)!)).toEqual([{ address: evm(4), chain: 'evm' }]);
	});

	it('clears the list from storage', () => {
		const s = memoryStorage();
		rememberRecentAddress(evm(1), 'evm', s);
		expect(clearRecentAddresses(s)).toEqual([]);
		expect(s.data.has(RECENT_ADDRESSES_KEY)).toBe(false);
		expect(readRecentAddresses(s)).toEqual([]);
	});

	it('never throws when every storage call throws: reads are empty, a remembered address is still returned', () => {
		expect(readRecentAddresses(throwing)).toEqual([]);
		expect(rememberRecentAddress(evm(1), 'evm', throwing)).toEqual([{ address: evm(1), chain: 'evm' }]);
		expect(clearRecentAddresses(throwing)).toEqual([]);
	});

	it('works with no storage at all', () => {
		expect(readRecentAddresses(null)).toEqual([]);
		expect(rememberRecentAddress(evm(1), 'evm', null)).toEqual([{ address: evm(1), chain: 'evm' }]);
		expect(clearRecentAddresses(null)).toEqual([]);
	});

	it('leaves storage untouched when the address is refused', () => {
		const s = memoryStorage();
		rememberRecentAddress(evm(1), 'evm', s);
		const before = s.data.get(RECENT_ADDRESSES_KEY);
		rememberRecentAddress('not an address', 'evm', s);
		expect(s.data.get(RECENT_ADDRESSES_KEY)).toBe(before);
	});
});

describe('the default storage is window.localStorage, and a blocked one is survived', () => {
	const original = (globalThis as { window?: unknown }).window;
	afterEach(() => {
		if (original === undefined) delete (globalThis as { window?: unknown }).window;
		else (globalThis as { window?: unknown }).window = original;
	});

	beforeEach(() => {
		delete (globalThis as { window?: unknown }).window;
	});

	it('is empty on the server, where there is no window', () => {
		expect(readRecentAddresses()).toEqual([]);
		expect(rememberRecentAddress(evm(1), 'evm')).toEqual([{ address: evm(1), chain: 'evm' }]);
	});

	it('uses window.localStorage when there is one', () => {
		const s = memoryStorage();
		(globalThis as { window?: unknown }).window = { localStorage: s };
		rememberRecentAddress(evm(2), 'evm');
		expect(readRecentAddresses()).toEqual([{ address: evm(2), chain: 'evm' }]);
		clearRecentAddresses();
		expect(s.data.size).toBe(0);
	});

	it('survives a browser where touching window.localStorage itself throws', () => {
		const win = {};
		Object.defineProperty(win, 'localStorage', { get: vi.fn(() => { throw new Error('SecurityError'); }) });
		(globalThis as { window?: unknown }).window = win;
		expect(readRecentAddresses()).toEqual([]);
		expect(rememberRecentAddress(evm(3), 'evm')).toEqual([{ address: evm(3), chain: 'evm' }]);
		expect(clearRecentAddresses()).toEqual([]);
	});
});
