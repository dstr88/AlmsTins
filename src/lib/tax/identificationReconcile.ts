/**
 * identificationReconcile.ts: for one tax year, which sales were covered by an identification
 * recorded before them and which fell back to the earliest-acquired default. Pure.
 *
 * It reads the ledger's own record of what each sale used (LedgerResult.selections), so it shows what
 * the figures did, not a second opinion. Sales before the per-wallet boundary have no selection: they
 * are matched in one pool per coin.
 */

import { parseInstant } from './normalize';
import { PER_WALLET_FROM } from './basisMethod';
import type { LedgerSelection } from './lotLedger';
import type { IdentificationMethod, LotIdentification } from './lotIdentification';

export interface ReconcileRow {
	sourceRef: string;
	at: string;
	asset: string;
	wallet: string;
	qty: number;
	/** The entry in force, or null for the default. */
	identification: Pick<LotIdentification, 'id' | 'method' | 'createdAt' | 'effectiveAt'> | null;
	/** What the sale used. */
	method: IdentificationMethod;
}

export interface Reconciliation {
	year: number;
	/** False for years before the wallet-by-wallet rule: nothing was matched per wallet. */
	applicable: boolean;
	rows: ReconcileRow[];
	covered: number;
	total: number;
}

const FROM_ENGINE: Record<string, IdentificationMethod> = { fifo: 'earliest', lifo: 'latest', hifo: 'highest_basis' };

export function reconcileYear(selections: readonly LedgerSelection[], entries: readonly LotIdentification[], year: number): Reconciliation {
	const applicable = year >= Number(PER_WALLET_FROM.slice(0, 4));
	if (!applicable) return { year, applicable, rows: [], covered: 0, total: 0 };
	const byId = new Map(entries.map((e) => [e.id, e]));
	const rows: ReconcileRow[] = [];
	for (const s of selections) {
		if (!s.taxable) continue;
		const ms = parseInstant(s.at);
		if (ms === null || new Date(ms).getUTCFullYear() !== year) continue;
		const entry = s.identificationId ? byId.get(s.identificationId) ?? null : null;
		rows.push({
			sourceRef: s.sourceRef,
			at: s.at,
			asset: s.asset,
			wallet: s.wallet,
			qty: s.qty,
			identification: entry ? { id: entry.id, method: entry.method, createdAt: entry.createdAt, effectiveAt: entry.effectiveAt } : null,
			method: entry ? entry.method : FROM_ENGINE[s.method] ?? 'earliest',
		});
	}
	rows.sort((a, b) => (parseInstant(a.at) ?? 0) - (parseInstant(b.at) ?? 0) || (a.sourceRef < b.sourceRef ? -1 : 1));
	return { year, applicable, rows, covered: rows.filter((r) => r.identification).length, total: rows.length };
}
