/**
 * How a record-download row reads: its label, its date and its download address. Pure, so the
 * desk, the client page and the tests share one copy. Every field from the route is checked;
 * a row that is not one of the known kinds is dropped rather than guessed at.
 */
import { ANCHOR_KINDS, type AnchorRecordKind } from '@/lib/receivables/anchorSpec';
import { fillCopy } from '@/lib/receivables/fillCopy';
import { formatMoney } from '@/lib/format';
import { PROOF_LABEL, PROOF_PARTY, PROOF_STATUS_EVENT } from '@/lib/receivables/copy/proofDownloads';

export interface ProofRow {
	kind: AnchorRecordKind;
	id: string;
	at: string | null;
	detail: Record<string, unknown>;
}

/** The route's answer, as the list reads it. */
export function readProofRows(j: unknown): ProofRow[] | null {
	if (!j || typeof j !== 'object' || (j as { ok?: unknown }).ok !== true) return null;
	const recs = (j as { records?: unknown }).records;
	if (!Array.isArray(recs)) return null;
	return recs.flatMap((r): ProofRow[] => {
		if (!r || typeof r !== 'object') return [];
		const o = r as Record<string, unknown>;
		if (typeof o.kind !== 'string' || !(ANCHOR_KINDS as readonly string[]).includes(o.kind)) return [];
		if (typeof o.id !== 'string' || !o.id) return [];
		const detail = o.detail && typeof o.detail === 'object' ? (o.detail as Record<string, unknown>) : {};
		return [{ kind: o.kind as AnchorRecordKind, id: o.id, at: typeof o.at === 'string' ? o.at : null, detail }];
	});
}

const s = (v: unknown, fallback = '') => (typeof v === 'string' && v ? v : fallback);

export function proofRowLabel(row: ProofRow): string {
	const d = row.detail;
	switch (row.kind) {
		case 'receivable': return PROOF_LABEL.receivable;
		case 'settlement': return PROOF_LABEL.settlement;
		case 'claim':
			return fillCopy(PROOF_LABEL.claim, {
				financier: s(d.financier, 'financier'),
				amount: typeof d.amount === 'number' && Number.isFinite(d.amount) ? formatMoney(d.amount, s(d.currency, '')) : '',
			}).replace(/, $/, '');
		case 'claim_discharge': return fillCopy(PROOF_LABEL.claim_discharge, { financier: s(d.financier, 'financier') });
		case 'attestation':
			return fillCopy(d.disputed ? PROOF_LABEL.dispute : PROOF_LABEL.answer, {
				party: PROOF_PARTY[s(d.role)] ?? PROOF_PARTY.other,
				label: s(d.label, 'unnamed'),
			});
		case 'status_event': return fillCopy(PROOF_LABEL.status_event, { event: PROOF_STATUS_EVENT[s(d.event)] ?? s(d.event, 'update') });
		case 'reverification': return fillCopy(PROOF_LABEL.reverification, { verdict: s(d.verdict, 'done') });
		case 'email_statement':
			return fillCopy(PROOF_LABEL.email_statement, {
				financier: s(d.financier, 'financier'),
				amount: typeof d.amount === 'number' && Number.isFinite(d.amount) ? formatMoney(d.amount, s(d.currency, '')) : '',
				date: s(d.asOf).slice(0, 10),
			}).replace(/, , /, ', ');
		default: return row.kind;
	}
}

/** The day the record was written, YYYY-MM-DD, or '' when unknown. */
export function proofRowDate(row: ProofRow): string {
	return row.at ? row.at.slice(0, 10) : '';
}

/** Where the signed-in download is (the existing owner-only route). */
export function proofFileHref(row: ProofRow): string {
	return `/api/verify/receivables/proof-file?kind=${encodeURIComponent(row.kind)}&id=${encodeURIComponent(row.id)}`;
}
