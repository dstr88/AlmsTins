/**
 * Address-poisoning flags for the addresses a screen is about to show (phase 2 of the
 * poisoning-warnings plan). The rules live in addressPoisoning.ts; this file feeds them the
 * account's own data:
 *
 *   - the account's whole history (historyRows.ts: on-chain, exchange imports and Sui), so
 *     "only ever sent you dust" is judged on every transfer with an address, not just the token a
 *     screen happens to show;
 *   - the account's address book (address_labels), the reference for look-alikes;
 *   - the account's own wallets, which are never flagged.
 *
 * Signal A is judged across all of the account's wallets: an address the user paid from any of
 * them is a real counterparty, not bait.
 *
 * The transfers are kept in memory per account for a few minutes (history is the slow part); the
 * address book is read fresh every time, so a label the user just saved counts at once.
 */

import { db } from './db';
import { loadQuarantineMarks } from './quarantineMarks';
import { loadHistoryRows, HistoryTooLargeError, type HistoryRow } from './historyRows';
import { nativeSymbol } from './chains';
import {
	findLookalike,
	isTrustedSource,
	poisoningFindings,
	sameAddressKey,
	type AddressBookEntry,
	type PoisonSignal,
	type PoisonTransfer,
} from './addressPoisoning';

/** What a screen needs to draw a warning for one address. */
export interface PoisonFlag {
	/**
	 * 'quarantined': the user quarantined this address themselves (src/lib/quarantine.ts). Their own
	 * verdict wins over the automatic signals and is drawn with ☠.
	 */
	signal: PoisonSignal | 'quarantined';
	/** The label of the saved address it imitates (signals B and C). */
	imitates: string | null;
}

/** More rows than this and no flags are computed (the same order as the history export). */
export const MAX_POISON_HISTORY_ROWS = 20_000;
const CACHE_MS = 5 * 60 * 1000;
const transferCache = new Map<string, { transfers: PoisonTransfer[]; expiresAt: number }>();

/**
 * One history row as a transfer for the rules. A failed transaction moved nothing and is left out,
 * as is a row with no counterparty. The chain's own coin with no recorded value is a coin
 * Almstins can value (valueUnknown), not an unpriced token.
 */
export function transferFromHistoryRow(row: HistoryRow): PoisonTransfer | null {
	if (row.failed || !row.counterparty) return null;
	if (row.direction !== 'in' && row.direction !== 'out') return null;
	const amount = row.amount === '' ? null : Number(row.amount);
	const usd = row.usdValue === '' ? null : Number(row.usdValue);
	const native = nativeSymbol(row.chain);
	return {
		counterparty: row.counterparty,
		direction: row.direction,
		amount,
		usd,
		tokenSymbol: row.asset || null,
		valueUnknown: !!native && row.asset.toUpperCase() === native.toUpperCase(),
		at: row.sortKey || null,
		wallet: row.ref?.kind === 'wallet' ? row.ref.walletId : null,
	};
}

/** The account's transfers for the rules, cached a few minutes; null when the history is too large. */
export async function accountTransfers(tenantId: string): Promise<PoisonTransfer[] | null> {
	const cached = transferCache.get(tenantId);
	if (cached && cached.expiresAt > Date.now()) return cached.transfers;
	try {
		const rows = await loadHistoryRows(tenantId, {}, MAX_POISON_HISTORY_ROWS);
		const transfers = rows.map(transferFromHistoryRow).filter((t): t is PoisonTransfer => t !== null);
		transferCache.set(tenantId, { transfers, expiresAt: Date.now() + CACHE_MS });
		return transfers;
	} catch (err) {
		if (err instanceof HistoryTooLargeError) return null;
		throw err;
	}
}

/**
 * The flags among `addresses`, keyed by sameAddressKey. Addresses with no signal, the account's
 * own wallets, and anything that is not a blockchain address are left out. Pure: the caller loads
 * the transfers, the address book and the wallets.
 */
export function flagsFor(
	addresses: readonly (string | null | undefined)[],
	transfers: readonly PoisonTransfer[],
	book: readonly AddressBookEntry[],
	ownWallets: readonly string[],
	quarantined: readonly string[] = [],
): Map<string, PoisonFlag> {
	const own = new Set(ownWallets.map((w) => sameAddressKey(w)).filter((k): k is string => !!k));
	const wanted = new Set(
		addresses.map((a) => sameAddressKey(a)).filter((k): k is string => !!k && !own.has(k)),
	);
	const out = new Map<string, PoisonFlag>();
	if (!wanted.size) return out;
	// Only the transfers with an address on screen count, but each one's full history does.
	const relevant = transfers.filter((t) => {
		const key = sameAddressKey(t.counterparty);
		return !!key && wanted.has(key);
	});
	const findings = poisoningFindings(relevant, book);
	const trusted = new Set(
		book.filter((e) => isTrustedSource(e.source)).map((e) => sameAddressKey(e.address)).filter((k): k is string => !!k),
	);
	const byUser = new Set(quarantined.map((a) => sameAddressKey(a)).filter((k): k is string => !!k));
	for (const key of wanted) {
		const found = findings.get(key);
		if (byUser.has(key) && !trusted.has(key)) {
			out.set(key, { signal: 'quarantined', imitates: found?.imitates?.label ?? null });
			continue;
		}
		if (found) {
			out.set(key, { signal: found.signal, imitates: found.imitates?.label ?? null });
			continue;
		}
		// An address on screen that the history doesn't carry (a row synced after the cached history
		// was read, or history too large to read) can still be a look-alike.
		if (trusted.has(key)) continue;
		const imitates = findLookalike(key, book);
		if (imitates) out.set(key, { signal: 'lookalike', imitates: imitates.label });
	}
	return out;
}

/**
 * Flags for the addresses a screen is about to show. Never throws: a warning that cannot be
 * computed is left out and logged, and the screen draws as it did before.
 */
export async function loadPoisoningFlags(
	tenantId: string,
	addresses: readonly (string | null | undefined)[],
): Promise<Map<string, PoisonFlag>> {
	try {
		if (!addresses.some((a) => sameAddressKey(a))) return new Map();
		const [transfers, bookRes, walletRes, marks] = await Promise.all([
			accountTransfers(tenantId),
			db.execute({ sql: 'SELECT address, label, source FROM address_labels WHERE tenant_id = ?', args: [tenantId] }),
			db.execute({ sql: 'SELECT address FROM wallets WHERE tenant_id = ?', args: [tenantId] }),
			loadQuarantineMarks(tenantId),
		]);
		const book: AddressBookEntry[] = (bookRes.rows as Record<string, unknown>[]).map((r) => ({
			address: String(r.address ?? ''),
			label: String(r.label ?? ''),
			source: r.source == null ? null : String(r.source),
		}));
		const wallets = (walletRes.rows as Record<string, unknown>[]).map((r) => String(r.address ?? ''));
		return flagsFor(addresses, transfers ?? [], book, wallets, marks.map((m) => m.address));
	} catch (err) {
		console.error('[poisoningFlags]', err instanceof Error ? err.message : 'failed');
		return new Map();
	}
}

/** The flag for one address from a map loadPoisoningFlags returned, or null. */
export function flagOf(flags: Map<string, PoisonFlag>, address: string | null | undefined): PoisonFlag | null {
	const key = sameAddressKey(address);
	return key ? flags.get(key) ?? null : null;
}
