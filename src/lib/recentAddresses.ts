/**
 * The addresses a person checked recently in the public wallet checker, so they can pick one
 * again instead of pasting it. The list lives only in that person's browser (localStorage): it is
 * never sent to Almstins and never put in analytics. Checking an address still sends that one
 * address to the server, as before; this list is not part of the request.
 *
 * Newest first, at most RECENT_ADDRESSES_MAX entries, one entry per address (compared in a
 * normalized form, so an EVM address in checksum case and in lowercase are the same entry).
 *
 * A stored value is untrusted: another script on the origin, an extension or an older build could
 * have written anything under the key. readRecentAddresses() keeps only entries shaped like an
 * address (letters and digits, 25 to 128 characters) and drops the rest, and the UI renders them as
 * text. Every storage call is wrapped: a private window, blocked site data or a full quota reads as
 * an empty list and writes nothing, and the checker works the same without it.
 *
 * Browser-safe: no server imports (src/lib/walletChecker.ts pulls in node:crypto, so only its
 * type is used here).
 */

import type { Chain } from './walletChecker';
import { BECH32_PREFIX, EVM_ADDRESS_ANY_PREFIX, SUI_ADDRESS } from './addressFormats';

export const RECENT_ADDRESSES_KEY = 'almstins-recent-addresses';
export const RECENT_ADDRESSES_MAX = 10;

/** One remembered address: as the person checked it, and its chain when the check named one. */
export interface RecentAddress {
	address: string;
	chain: Exclude<Chain, 'unknown'> | null;
}

/** The storage calls used here, so a test can pass its own. */
export type RecentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KNOWN_CHAINS: ReadonlySet<string> = new Set(['evm', 'sui', 'solana', 'bitcoin', 'litecoin', 'tron']);

// Every address shape the checker accepts (hex, base58, bech32) is letters and digits only, and
// isValidAddress() takes 25 to 128 characters. Anything else in storage is not one of ours.
const STORED_ADDRESS = /^[0-9A-Za-z]{25,128}$/;

/**
 * The form two addresses are compared in. EVM and Sui hex and segwit (bech32) addresses are
 * case-insensitive, so they are lowercased; base58 (Solana, Tron, legacy Bitcoin) is
 * case-sensitive and kept as is.
 */
export function recentAddressKey(address: string): string {
	const a = address.trim();
	if (EVM_ADDRESS_ANY_PREFIX.test(a) || SUI_ADDRESS.test(a) || BECH32_PREFIX.test(a)) return a.toLowerCase();
	return a;
}

function toEntry(value: unknown): RecentAddress | null {
	if (!value || typeof value !== 'object') return null;
	const { address, chain } = value as { address?: unknown; chain?: unknown };
	if (typeof address !== 'string') return null;
	const trimmed = address.trim();
	if (!STORED_ADDRESS.test(trimmed)) return null;
	return {
		address: trimmed,
		chain: typeof chain === 'string' && KNOWN_CHAINS.has(chain) ? (chain as RecentAddress['chain']) : null,
	};
}

/** Newest first, one entry per address key, at most RECENT_ADDRESSES_MAX; bad entries dropped. */
function tidy(entries: readonly unknown[]): RecentAddress[] {
	const seen = new Set<string>();
	const out: RecentAddress[] = [];
	for (const raw of entries) {
		const entry = toEntry(raw);
		if (!entry) continue;
		const key = recentAddressKey(entry.address);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(entry);
		if (out.length === RECENT_ADDRESSES_MAX) break;
	}
	return out;
}

/** The list a stored string holds. Anything that is not a JSON array reads as an empty list. */
export function parseRecentAddresses(raw: string | null | undefined): RecentAddress[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? tidy(parsed) : [];
	} catch {
		return [];
	}
}

/** The list with this address moved (or added) to the front. An address that is not shaped like one leaves the list as it was. */
export function withRecentAddress(list: readonly RecentAddress[], address: string, chain: string | null | undefined): RecentAddress[] {
	const entry = toEntry({ address, chain });
	if (!entry) return tidy(list);
	return tidy([entry, ...list]);
}

/** This browser's localStorage, or null where reading it throws (blocked site data, some private windows). */
function browserStorage(): RecentStorage | null {
	try {
		return typeof window === 'undefined' ? null : window.localStorage;
	} catch {
		return null;
	}
}

/** The remembered addresses, newest first. Empty when storage is missing, blocked or holds something else. */
export function readRecentAddresses(storage: RecentStorage | null = browserStorage()): RecentAddress[] {
	if (!storage) return [];
	try {
		return parseRecentAddresses(storage.getItem(RECENT_ADDRESSES_KEY));
	} catch {
		return [];
	}
}

/**
 * Remembers an address the person just checked and returns the new list. When the write fails
 * (blocked storage, full quota) the returned list still holds it, so it shows until the page closes.
 */
export function rememberRecentAddress(address: string, chain: string | null | undefined, storage: RecentStorage | null = browserStorage()): RecentAddress[] {
	const next = withRecentAddress(readRecentAddresses(storage), address, chain);
	if (storage) {
		try {
			storage.setItem(RECENT_ADDRESSES_KEY, JSON.stringify(next));
		} catch {
			/* storage is blocked or full; the list lasts until the page closes */
		}
	}
	return next;
}

/** Forgets every remembered address and returns the empty list. */
export function clearRecentAddresses(storage: RecentStorage | null = browserStorage()): RecentAddress[] {
	if (storage) {
		try {
			storage.removeItem(RECENT_ADDRESSES_KEY);
		} catch {
			/* storage is blocked; nothing was kept there */
		}
	}
	return [];
}
