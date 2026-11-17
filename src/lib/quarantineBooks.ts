/**
 * Needs Attention and quarantine (Donnie, Nov 17, 2026: "Needs attention does not see dust";
 * addresses the user quarantined are hidden too, "but they should be easy to spot").
 *
 * The bookkeeping page's Needs Attention lists outgoing sales and transfers with no cost basis. An
 * item is set aside, behind a "Show" line, only when BOTH hold:
 *   - the address it went to is in quarantine (a poisoning signal, or the user quarantined it),
 *   - and it moved nothing or dust: zero, no value, or under $1.
 * A real payment to a quarantined address is never hidden: that is a loss the user needs to see.
 *
 * Display only, like the page's spam-token filter: the tax math, the CSV exports and the Year
 * Summary are untouched. Holdings are untouched (decided Nov 17).
 */

import { db } from './db';
import { DUST_USD } from './addressPoisoning';
import { flagOf, type PoisonFlag } from './poisoningFlags';

/** An item that moved nothing, has no value, or is worth under DUST_USD. */
export function isDustDisposal(item: { amount: number; proceedsUsd: number | null }): boolean {
	if (!Number.isFinite(item.amount) || item.amount === 0) return true;
	if (item.proceedsUsd == null || !Number.isFinite(item.proceedsUsd)) return true;
	return Math.abs(item.proceedsUsd) < DUST_USD;
}

/** Splits Needs Attention into what is listed and what is set aside behind "Show". Pure. */
export function splitQuarantinedDust<T extends { sourceId: string; amount: number; proceedsUsd: number | null }>(
	items: readonly T[],
	counterpartyBySource: ReadonlyMap<string, string>,
	flags: Map<string, PoisonFlag>,
): { visible: T[]; hidden: Array<{ item: T; flag: PoisonFlag }> } {
	const visible: T[] = [];
	const hidden: Array<{ item: T; flag: PoisonFlag }> = [];
	for (const item of items) {
		const flag = flagOf(flags, counterpartyBySource.get(item.sourceId) ?? null);
		if (flag && isDustDisposal(item)) hidden.push({ item, flag });
		else visible.push(item);
	}
	return { visible, hidden };
}

/** The address each item went to (transactions.to_address), by source id. Never throws. */
export async function loadCounterparties(tenantId: string, sourceIds: readonly string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const ids = [...new Set(sourceIds.filter(Boolean))];
	if (!ids.length) return out;
	try {
		const res = await db.execute({
			sql: `SELECT id, to_address FROM transactions WHERE tenant_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
			args: [tenantId, ...ids],
		});
		for (const r of res.rows as Record<string, unknown>[]) {
			if (r.id != null && typeof r.to_address === 'string' && r.to_address) out.set(String(r.id), r.to_address);
		}
	} catch (err) {
		console.error('[quarantineBooks]', err instanceof Error ? err.message : 'failed');
	}
	return out;
}
