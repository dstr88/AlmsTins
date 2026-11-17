/**
 * Quarantine (phase 4 of the poisoning-warnings plan; named by Donnie, Nov 17, 2026): addresses
 * the poisoning rules flagged, or that the user quarantined themselves, kept apart from the
 * address book. Found when looked for, never in the way: a quiet button on each wallet card opens
 * that wallet's list, and an account-wide page sits behind a quiet link under the address book.
 *
 * What is in it:
 *   - every counterparty in the account's history with a signal (src/lib/addressPoisoning.ts):
 *     only ever sent dust, a look-alike of a saved address, or both;
 *   - every address the user quarantined themselves (address_quarantine), shown with ☠.
 * Never in it: the account's own wallets, and addresses the user saved (including ones they
 * released from quarantine, saved with source SOURCE_RELEASED so the override stays on record).
 *
 * Nothing is deleted from history: quarantine holds addresses, and the transactions stay in the
 * history with their marks.
 */

import { db } from './db';
import { canonicalAddress } from './wallets-service';
import { accountTransfers, almstinsLabeledAddresses } from './poisoningFlags';
import { ensureQuarantineTable, loadQuarantineMarks } from './quarantineMarks';
import { countsOnButton, type QuarantineEntry } from './quarantineEntry';

export { ensureQuarantineTable, loadQuarantineMarks, countsOnButton };
export type { QuarantineEntry };
import {
	isTrustedSource,
	poisoningFindings,
	sameAddressKey,
	type AddressBookEntry,
	type PoisonTransfer,
} from './addressPoisoning';

/**
 * The quarantine list, built from data the caller loaded. Pure. Newest first; on the same date,
 * look-alikes before dust and the user's own before either.
 */
export function buildQuarantine(
	transfers: readonly PoisonTransfer[],
	book: readonly AddressBookEntry[],
	ownWallets: readonly string[],
	marks: readonly { address: string; createdAt: string }[],
	notDustSenders: ReadonlySet<string> = new Set(),
): QuarantineEntry[] {
	const own = new Set(ownWallets.map((w) => sameAddressKey(w)).filter((k): k is string => !!k));
	const trusted = new Set(
		book.filter((e) => isTrustedSource(e.source)).map((e) => sameAddressKey(e.address)).filter((k): k is string => !!k),
	);
	const out = new Map<string, QuarantineEntry>();

	for (const [key, f] of poisoningFindings(transfers, book, { notDustSenders })) {
		if (own.has(key)) continue;
		out.set(key, {
			address: key,
			signal: f.signal,
			imitates: f.imitates ? { address: f.imitates.address, label: f.imitates.label } : null,
			byUser: false,
			firstAt: f.firstAt,
			transfers: f.transfers,
			usdIn: f.usdIn,
			wallets: f.wallets,
		});
	}

	for (const m of marks) {
		const key = sameAddressKey(m.address);
		if (!key || own.has(key) || trusted.has(key)) continue;
		const found = out.get(key);
		if (found) {
			found.byUser = true;
			continue;
		}
		// No signal: its history is still worth showing (when it first appeared, which wallets).
		const mine = transfers.filter((t) => sameAddressKey(t.counterparty) === key);
		const wallets = [...new Set(mine.map((t) => t.wallet).filter((w): w is string => !!w))];
		const firstAt = mine.reduce<string | null>((min, t) => (t.at && (!min || t.at < min) ? t.at : min), null);
		const usdIn = mine
			.filter((t) => String(t.direction).toLowerCase() === 'in' && t.usd != null && Number.isFinite(Number(t.usd)))
			.reduce((sum, t) => sum + Math.abs(Number(t.usd)), 0);
		out.set(key, {
			address: key,
			signal: null,
			imitates: null,
			byUser: true,
			firstAt: firstAt ?? m.createdAt,
			transfers: mine.length,
			usdIn,
			wallets,
		});
	}

	const rank = (e: QuarantineEntry) => (e.byUser ? 0 : e.signal === 'both' ? 1 : e.signal === 'lookalike' ? 2 : 3);
	return [...out.values()].sort((a, b) => (b.firstAt ?? '').localeCompare(a.firstAt ?? '') || rank(a) - rank(b));
}

/** The account's quarantine. Never throws: on failure the screens show nothing. */
export async function loadQuarantine(tenantId: string): Promise<QuarantineEntry[]> {
	try {
		const [transfers, bookRes, walletRes, marks, labeled] = await Promise.all([
			accountTransfers(tenantId),
			db.execute({ sql: 'SELECT address, label, source FROM address_labels WHERE tenant_id = ?', args: [tenantId] }),
			db.execute({ sql: 'SELECT address FROM wallets WHERE tenant_id = ?', args: [tenantId] }),
			loadQuarantineMarks(tenantId),
			almstinsLabeledAddresses(),
		]);
		const rows = (r: { rows: unknown[] }) => r.rows as Record<string, unknown>[];
		const book = rows(bookRes).map((r) => ({
			address: String(r.address ?? ''),
			label: String(r.label ?? ''),
			source: r.source == null ? null : String(r.source),
		}));
		return buildQuarantine(transfers ?? [], book, rows(walletRes).map((r) => String(r.address ?? '')), marks, labeled);
	} catch (err) {
		console.error('[quarantine]', err instanceof Error ? err.message : 'failed');
		return [];
	}
}

/**
 * Quarantine an address book entry: the entry leaves the book and the address is marked as the
 * user's own choice. No prompt (moving toward safety needs none). Returns the address, or null
 * when the entry is not this account's.
 */
export async function quarantineLabel(tenantId: string, labelId: string): Promise<string | null> {
	await ensureQuarantineTable();
	const res = await db.execute({
		sql: 'SELECT address FROM address_labels WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [labelId, tenantId],
	});
	const row = res.rows[0] as Record<string, unknown> | undefined;
	if (!row) return null;
	const address = canonicalAddress(String(row.address ?? ''));
	await db.execute({ sql: 'DELETE FROM address_labels WHERE id = ? AND tenant_id = ?', args: [labelId, tenantId] });
	await db.execute({
		sql: `INSERT INTO address_quarantine (tenant_id, address, created_at) VALUES (?, ?, ?)
		      ON CONFLICT (tenant_id, address) DO NOTHING`,
		args: [tenantId, address, new Date().toISOString()],
	});
	return address;
}

/** Clear the user's own quarantine mark on an address (when they release it to the address book). */
export async function clearQuarantineMark(tenantId: string, address: string): Promise<void> {
	await ensureQuarantineTable();
	await db.execute({
		sql: 'DELETE FROM address_quarantine WHERE tenant_id = ? AND address = ?',
		args: [tenantId, canonicalAddress(address)],
	});
}
