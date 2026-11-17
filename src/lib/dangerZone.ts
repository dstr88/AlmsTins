/**
 * The Danger Zone (phase 4 of the poisoning-warnings plan; Donnie, Nov 16, 2026): on the
 * Addresses page, the addresses the poisoning rules flagged get their own section, apart from the
 * address book. The address book stays the "safe zone", the list the user actually pays.
 *
 * What is in it:
 *   - every counterparty in the account's history with a signal (src/lib/addressPoisoning.ts):
 *     only ever sent dust, a look-alike of a saved address, or both;
 *   - every address the user sent here themselves from the address book (no prompt needed),
 *     kept in address_danger_marks.
 * Never in it: the account's own wallets, and addresses the user saved (including ones they moved
 * out of the Danger Zone, saved with source SOURCE_FROM_DANGER so the override stays on record).
 *
 * Nothing is deleted from history: the Danger Zone holds addresses, and the transactions stay in
 * the history with their warnings.
 */

import { db } from './db';
import { canonicalAddress } from './wallets-service';
import { accountTransfers } from './poisoningFlags';
import {
	isTrustedSource,
	poisoningFindings,
	sameAddressKey,
	type AddressBookEntry,
	type PoisonSignal,
	type PoisonTransfer,
} from './addressPoisoning';

export interface DangerEntry {
	/** The address, in its stored form. */
	address: string;
	/** Why the rules flagged it; null when it is here only because the user sent it here. */
	signal: PoisonSignal | null;
	/** The saved entry it looks like (signals B and C). */
	imitates: { address: string; label: string } | null;
	/** The user sent it here from the address book. */
	marked: boolean;
	/** When it first appeared in the history (ISO), or when the user sent it here. */
	firstAt: string | null;
	/** Transfers with it in the history. */
	transfers: number;
	/** What it sent in, in US dollars, priced transfers only. */
	usdIn: number;
}

let tableReady: Promise<void> | null = null;

/** The table of addresses the user sent to the Danger Zone, created on first use. */
export function ensureDangerTable(): Promise<void> {
	if (!tableReady) {
		tableReady = db
			.execute({
				sql: `CREATE TABLE IF NOT EXISTS address_danger_marks (
				        tenant_id  TEXT NOT NULL,
				        address    TEXT NOT NULL,
				        created_at TEXT NOT NULL,
				        PRIMARY KEY (tenant_id, address)
				      )`,
			})
			.then(() => {})
			.catch((e) => {
				tableReady = null;
				throw e;
			});
	}
	return tableReady;
}

/**
 * The Danger Zone list, built from data the caller loaded. Pure. Ordered newest first, with
 * entries the rules flagged red (look-alikes) before amber (dust-only) on the same date.
 */
export function buildDangerZone(
	transfers: readonly PoisonTransfer[],
	book: readonly AddressBookEntry[],
	ownWallets: readonly string[],
	marks: readonly { address: string; createdAt: string }[],
): DangerEntry[] {
	const own = new Set(ownWallets.map((w) => sameAddressKey(w)).filter((k): k is string => !!k));
	const trusted = new Set(
		book.filter((e) => isTrustedSource(e.source)).map((e) => sameAddressKey(e.address)).filter((k): k is string => !!k),
	);
	const out = new Map<string, DangerEntry>();

	for (const [key, f] of poisoningFindings(transfers, book)) {
		if (own.has(key)) continue;
		out.set(key, {
			address: key,
			signal: f.signal,
			imitates: f.imitates ? { address: f.imitates.address, label: f.imitates.label } : null,
			marked: false,
			firstAt: f.firstAt,
			transfers: f.transfers,
			usdIn: f.usdIn,
		});
	}

	for (const m of marks) {
		const key = sameAddressKey(m.address);
		if (!key || own.has(key) || trusted.has(key)) continue;
		const found = out.get(key);
		if (found) {
			found.marked = true;
			continue;
		}
		out.set(key, { address: key, signal: null, imitates: null, marked: true, firstAt: m.createdAt, transfers: 0, usdIn: 0 });
	}

	const rank = (e: DangerEntry) => (e.signal === 'both' ? 0 : e.signal === 'lookalike' ? 1 : e.signal === 'dust-only' ? 2 : 3);
	return [...out.values()].sort((a, b) => (b.firstAt ?? '').localeCompare(a.firstAt ?? '') || rank(a) - rank(b));
}

/** The account's Danger Zone. Never throws: on failure the page shows an empty section. */
export async function loadDangerZone(tenantId: string): Promise<DangerEntry[]> {
	try {
		await ensureDangerTable();
		const [transfers, bookRes, walletRes, markRes] = await Promise.all([
			accountTransfers(tenantId),
			db.execute({ sql: 'SELECT address, label, source FROM address_labels WHERE tenant_id = ?', args: [tenantId] }),
			db.execute({ sql: 'SELECT address FROM wallets WHERE tenant_id = ?', args: [tenantId] }),
			db.execute({ sql: 'SELECT address, created_at FROM address_danger_marks WHERE tenant_id = ?', args: [tenantId] }),
		]);
		const rows = (r: { rows: unknown[] }) => r.rows as Record<string, unknown>[];
		const book = rows(bookRes).map((r) => ({
			address: String(r.address ?? ''),
			label: String(r.label ?? ''),
			source: r.source == null ? null : String(r.source),
		}));
		return buildDangerZone(
			transfers ?? [],
			book,
			rows(walletRes).map((r) => String(r.address ?? '')),
			rows(markRes).map((r) => ({ address: String(r.address ?? ''), createdAt: String(r.created_at ?? '') })),
		);
	} catch (err) {
		console.error('[dangerZone]', err instanceof Error ? err.message : 'failed');
		return [];
	}
}

/**
 * Send an address book entry to the Danger Zone: the entry is removed from the book and the
 * address is marked. No prompt (moving toward safety needs none). Returns the address, or null
 * when the entry is not this account's.
 */
export async function sendToDangerZone(tenantId: string, labelId: string): Promise<string | null> {
	await ensureDangerTable();
	const res = await db.execute({
		sql: 'SELECT address FROM address_labels WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [labelId, tenantId],
	});
	const row = res.rows[0] as Record<string, unknown> | undefined;
	if (!row) return null;
	const address = canonicalAddress(String(row.address ?? ''));
	await db.execute({ sql: 'DELETE FROM address_labels WHERE id = ? AND tenant_id = ?', args: [labelId, tenantId] });
	await db.execute({
		sql: `INSERT INTO address_danger_marks (tenant_id, address, created_at) VALUES (?, ?, ?)
		      ON CONFLICT (tenant_id, address) DO NOTHING`,
		args: [tenantId, address, new Date().toISOString()],
	});
	return address;
}

/** Clear the user's own mark on an address (when they move it into the address book). */
export async function clearDangerMark(tenantId: string, address: string): Promise<void> {
	await ensureDangerTable();
	await db.execute({
		sql: 'DELETE FROM address_danger_marks WHERE tenant_id = ? AND address = ?',
		args: [tenantId, canonicalAddress(address)],
	});
}
