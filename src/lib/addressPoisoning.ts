/**
 * Address-poisoning signals: the rules only (plan: Obsidian claudePoisoningWarnings-plan.md,
 * phase 1; decisions taken by Donnie, Nov 16, 2026). Nothing here reads a database or draws a
 * screen. Later phases call these rules from the history rows, the transaction drawer, the
 * address book and the Danger Zone, so every place answers the same way.
 *
 * Address poisoning: a scammer makes an address whose first and last few characters match one the
 * victim really pays, then sends the victim dust so the look-alike sits in their history, waiting
 * to be copied. Three signals:
 *
 *   A. dust-only: every transfer between the counterparty and this wallet came IN, and every one
 *      was dust. The user never sent to it.
 *   B. look-alike: it shares the first 4 and last 4 characters (after any fixed network prefix)
 *      with an address the user saved themselves, and is not that address.
 *   C. both: the classic poisoning pattern.
 *
 * The signals warn; they never block, hide or delete anything. They say what a pattern suggests,
 * not that a crime happened: an innocent airdrop can be dust-only.
 *
 * No database or server imports: React islands use this too.
 */

import { addressNetwork, type AddressNetwork } from './addressNetwork';
import { isSpamToken } from './knownContracts';

/** A transfer worth less than this many US dollars at the time is dust (Donnie, Nov 16, 2026). */
export const DUST_USD = 1;

/** Characters compared at the start of an address, after its fixed network prefix. */
export const LOOKALIKE_HEAD = 4;
/** Characters compared at the end of an address. */
export const LOOKALIKE_TAIL = 4;

/** The source of an entry the user moved out of the Danger Zone themselves (phase 4). */
export const SOURCE_FROM_DANGER = 'user-override';

/**
 * Address book sources the look-alike check trusts: only entries the user saved themselves
 * (decision 3a). The address book stores those as 'user', or SOURCE_FROM_DANGER when the user
 * moved the address out of the Danger Zone past the warning; 'auto' (the transfer matcher) and
 * 'system' (imports) were never confirmed by the user, so they are not a reference.
 */
const TRUSTED_SOURCES = new Set(['user', SOURCE_FROM_DANGER]);

export function isTrustedSource(source: string | null | undefined): boolean {
	return TRUSTED_SOURCES.has(String(source ?? '').trim().toLowerCase());
}

// ── Addresses ────────────────────────────────────────────────────────────────

function isBech32(network: AddressNetwork, lower: string): boolean {
	return (network === 'btc' && lower.startsWith('bc1')) || (network === 'ltc' && lower.startsWith('ltc1'));
}

/**
 * The form two addresses are compared in to decide whether they are the SAME address: EVM, Sui
 * and bech32 lowercased (their case carries no meaning), base58 (Bitcoin 1… and 3…, legacy
 * Litecoin, Solana) exactly as given, since its case is part of the address. Null for anything
 * that is not a blockchain address (an exchange account id, an empty value).
 */
export function sameAddressKey(address: string | null | undefined): string | null {
	const value = String(address ?? '').trim();
	const network = addressNetwork(value);
	if (!network) return null;
	const lower = value.toLowerCase();
	if (network === 'evm' || network === 'sui' || isBech32(network, lower)) return lower;
	return value;
}

/**
 * The part of an address a person reads as "the address": what follows the prefix every address
 * of its kind shares. A look-alike only has to match what varies, so the prefix is left out of the
 * comparison: `0x` (EVM, Sui), `bc1` or `ltc1` plus the witness version letter (bech32), and the
 * version character of a base58 Bitcoin or Litecoin address (1, 3, L, M). Solana has no prefix.
 */
function body(address: string, network: AddressNetwork): string {
	const lower = address.toLowerCase();
	if (network === 'evm' || network === 'sui') return lower.slice(2);
	if (isBech32(network, lower)) return lower.slice(network === 'btc' ? 4 : 5);
	if (network === 'btc' || network === 'ltc') return address.slice(1);
	return address;
}

/**
 * True when `a` and `b` are different addresses on the same kind of network that share the first
 * LOOKALIKE_HEAD and last LOOKALIKE_TAIL characters after the prefix. Letters are compared without
 * case even for base58: a person checking the ends does not notice case, so neither does this.
 * More matching characters at either end are still a look-alike.
 */
export function isLookalike(a: string | null | undefined, b: string | null | undefined): boolean {
	const keyA = sameAddressKey(a);
	const keyB = sameAddressKey(b);
	if (!keyA || !keyB || keyA === keyB) return false;
	const netA = addressNetwork(keyA);
	const netB = addressNetwork(keyB);
	if (!netA || netA !== netB) return false;
	const bodyA = body(keyA, netA).toLowerCase();
	const bodyB = body(keyB, netB).toLowerCase();
	if (bodyA.length < LOOKALIKE_HEAD + LOOKALIKE_TAIL || bodyB.length < LOOKALIKE_HEAD + LOOKALIKE_TAIL) return false;
	return (
		bodyA.slice(0, LOOKALIKE_HEAD) === bodyB.slice(0, LOOKALIKE_HEAD) &&
		bodyA.slice(-LOOKALIKE_TAIL) === bodyB.slice(-LOOKALIKE_TAIL)
	);
}

export interface AddressBookEntry {
	address: string;
	label: string;
	source: string | null | undefined;
}

/**
 * The trusted address book entry `address` imitates, or null. Only entries the user saved
 * themselves count (decision 3a). When several match, the first in the list is named.
 */
export function findLookalike<E extends AddressBookEntry>(address: string | null | undefined, book: readonly E[]): E | null {
	for (const entry of book) {
		if (isTrustedSource(entry.source) && isLookalike(address, entry.address)) return entry;
	}
	return null;
}

// ── Transfers ────────────────────────────────────────────────────────────────

/** One transfer between a wallet and a counterparty, as the history rows carry it. */
export interface PoisonTransfer {
	/** The other side's address. */
	counterparty: string | null | undefined;
	/** 'in' when the counterparty sent to the wallet, 'out' when the wallet sent to it. */
	direction: string | null | undefined;
	/** Token amount moved; 0 for a zero-value transfer. */
	amount: number | null | undefined;
	/** US dollar value at the time of the transfer; null when the token has no price. */
	usd: number | null | undefined;
	tokenSymbol?: string | null;
	tokenName?: string | null;
	/**
	 * The caller already knows the token is fake, e.g. a known symbol (USDT) at a contract that is
	 * not the real one (classifyContract in knownContracts.ts says 'scam').
	 */
	spam?: boolean;
	/**
	 * A coin Almstins can value (the chain's own coin, or a token at its known contract), but no
	 * value was recorded for this transfer. Not the same as an unpriced token: it is not dust
	 * unless it moved nothing.
	 */
	valueUnknown?: boolean;
	/** When it happened (ISO 8601), for "first seen". */
	at?: string | null;
}

/**
 * Dust (decision 1): worth under DUST_USD at the time, or zero-value, or in a token already
 * flagged as spam, or in a token with no price. An unpriced token counts because it is the usual
 * shape of a poisoning token; a genuine small amount can land here too, and the user can move it
 * back in a later phase.
 */
export function isDustTransfer(t: PoisonTransfer): boolean {
	const amount = Number(t.amount);
	if (!Number.isFinite(amount) || amount === 0) return true;
	if (t.spam) return true;
	if (t.tokenSymbol && isSpamToken(t.tokenSymbol, t.tokenName ?? null)) return true;
	if (t.usd === null || t.usd === undefined) return !t.valueUnknown;
	const usd = Number(t.usd);
	if (!Number.isFinite(usd)) return true;
	return Math.abs(usd) < DUST_USD;
}

export type PoisonSignal = 'dust-only' | 'lookalike' | 'both';

export interface PoisonFinding<E extends AddressBookEntry = AddressBookEntry> {
	/** The counterparty, in its same-address form. */
	address: string;
	signal: PoisonSignal;
	/** The trusted entry it imitates (signals B and C). */
	imitates: E | null;
	/** Transfers with this counterparty. */
	transfers: number;
	/** The earliest `at` among them, when known. */
	firstAt: string | null;
	/** What it sent in, in US dollars, counting only priced transfers. */
	usdIn: number;
}

/**
 * The poisoning signals for one wallet's transfers, by counterparty. A counterparty with no signal
 * is left out. The wallet's own address book is the reference for look-alikes.
 *
 * Signal A needs every transfer to be IN and dust: one payment the user sent to the address, or
 * one real amount from it, clears it. Signal B applies whichever way the money went, since a
 * payment sent to a look-alike is the loss the warning exists for. An address the user saved
 * themselves gets no signal.
 */
export function poisoningFindings<E extends AddressBookEntry>(
	transfers: readonly PoisonTransfer[],
	book: readonly E[],
): Map<string, PoisonFinding<E>> {
	type Tally = { address: string; total: number; dustIn: number; firstAt: string | null; usdIn: number };
	const byAddress = new Map<string, Tally>();

	for (const t of transfers) {
		const key = sameAddressKey(t.counterparty);
		if (!key) continue;
		const tally = byAddress.get(key) ?? { address: key, total: 0, dustIn: 0, firstAt: null, usdIn: 0 };
		tally.total += 1;
		const incoming = String(t.direction ?? '').toLowerCase() === 'in';
		if (incoming && isDustTransfer(t)) tally.dustIn += 1;
		if (incoming && t.usd !== null && t.usd !== undefined && Number.isFinite(Number(t.usd))) {
			tally.usdIn += Math.abs(Number(t.usd));
		}
		if (t.at && (tally.firstAt === null || t.at < tally.firstAt)) tally.firstAt = t.at;
		byAddress.set(key, tally);
	}

	// An address the user saved themselves is their call: it is never flagged, even if it has only
	// ever sent dust (a test deposit from their own exchange account, say).
	const trusted = new Set<string>();
	for (const entry of book) {
		const key = isTrustedSource(entry.source) ? sameAddressKey(entry.address) : null;
		if (key) trusted.add(key);
	}

	const findings = new Map<string, PoisonFinding<E>>();
	for (const [key, tally] of byAddress) {
		if (trusted.has(key)) continue;
		const dustOnly = tally.total > 0 && tally.dustIn === tally.total;
		const imitates = findLookalike(key, book);
		if (!dustOnly && !imitates) continue;
		findings.set(key, {
			address: key,
			signal: dustOnly && imitates ? 'both' : imitates ? 'lookalike' : 'dust-only',
			imitates,
			transfers: tally.total,
			firstAt: tally.firstAt,
			usdIn: tally.usdIn,
		});
	}
	return findings;
}

// ── Saving to the address book (phase 3) ─────────────────────────────────────

/**
 * Before a new address goes into the address book: the trusted entry it looks like, or null.
 * An address already in the book (the save only updates its label) is never questioned.
 */
export function saveLookalike<E extends AddressBookEntry>(address: string | null | undefined, book: readonly E[]): E | null {
	const key = sameAddressKey(address);
	if (!key) return null;
	if (book.some((e) => sameAddressKey(e.address) === key)) return null;
	return findLookalike(key, book);
}

/**
 * For showing two addresses one above the other: which character positions differ (case ignored,
 * as in isLookalike). Positions past the end of the shorter one count as different.
 */
export function differingPositions(a: string, b: string): Set<number> {
	const out = new Set<number>();
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if ((a[i] ?? '').toLowerCase() !== (b[i] ?? '').toLowerCase()) out.add(i);
	}
	return out;
}
