/**
 * The rows of the "Proof files for your records" block: which of the records on screen the viewer
 * can download a proof file for, what each row is called, and where its link points.
 *
 * The lookup sends proofFiles ({ kind, id } each) only to a signed-in account, and only for the
 * records that account owns (listOwnProofRecords). Nothing here decides who owns what: a record
 * not in proofFiles gets no row, so the block shows nothing to anyone else. Rows follow the order
 * the page shows the records in. Pure; imports only copy, fillCopy and the kind list.
 */
import { fillCopy } from './fillCopy';
import { isAnchorKind, type AnchorRecordKind } from './anchorSpec';
import { PROOF_FILE_ROW, PROOF_FILE_ROW_FALLBACK } from './copy/proofFile';

/** The download route (src/pages/api/verify/receivables/proof-file.ts). Owner-only. */
export const PROOF_FILE_ROUTE = '/api/verify/receivables/proof-file';
/** The recipe for checking a file with nothing from almstins.com, in the public repository. */
export const PROOF_FILE_HOW_TO_URL = 'https://github.com/dstr88/AlmsTins/blob/production/docs/verify-without-almstins.md';

export interface ProofFileRef { kind: AnchorRecordKind; id: string }
export interface ProofFileRow extends ProofFileRef { label: string; href: string }

/** The parts of a lookup's receivable this reads. Every field is optional: pages pass it as is. */
export interface ProofFileSource {
	id?: string;
	proofFiles?: unknown;
	claims?: Array<{ id: string; financier?: string; statusEvents?: Array<{ id: string; kind?: string; date?: string }> }>;
	attestations?: Array<{ id: string; role?: string; date?: string }>;
	reverifications?: Array<{ id: string; date?: string }>;
}

export function proofFileHref(kind: AnchorRecordKind, id: string): string {
	return `${PROOF_FILE_ROUTE}?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`;
}

/** proofFiles as sent, keeping only well-formed entries. */
export function proofFileRefs(rcv: ProofFileSource | null | undefined): ProofFileRef[] {
	const list = Array.isArray(rcv?.proofFiles) ? (rcv!.proofFiles as unknown[]) : [];
	return list.flatMap((x: any) =>
		x && isAnchorKind(x.kind) && typeof x.id === 'string' && x.id ? [{ kind: x.kind, id: x.id }] : []);
}

const day = (s: unknown) => String(s ?? '').slice(0, 10);

export function proofFileRows(rcv: ProofFileSource | null | undefined): ProofFileRow[] {
	const refs = proofFileRefs(rcv);
	if (!refs.length) return [];
	const left = new Map(refs.map((r) => [`${r.kind}:${r.id}`, r] as const));
	const rows: ProofFileRow[] = [];
	const take = (kind: AnchorRecordKind, id: string, label: string) => {
		if (!left.delete(`${kind}:${id}`)) return;
		rows.push({ kind, id, label, href: proofFileHref(kind, id) });
	};

	if (rcv?.id) {
		take('receivable', rcv.id, PROOF_FILE_ROW.receivable);
		take('settlement', rcv.id, PROOF_FILE_ROW.settlement);
	}
	for (const c of rcv?.claims ?? []) {
		const financier = String(c.financier ?? '');
		take('claim', c.id, fillCopy(PROOF_FILE_ROW.claim, { financier }));
		for (const e of c.statusEvents ?? []) {
			const tpl = (PROOF_FILE_ROW.status_event as Record<string, string>)[String(e.kind)];
			take('status_event', e.id, tpl ? fillCopy(tpl, { financier, day: day(e.date) }) : PROOF_FILE_ROW_FALLBACK.status_event);
		}
		take('claim_discharge', c.id, fillCopy(PROOF_FILE_ROW.claim_discharge, { financier }));
	}
	for (const a of rcv?.attestations ?? []) {
		const tpl = (PROOF_FILE_ROW.attestation as Record<string, string>)[String(a.role)] ?? PROOF_FILE_ROW.attestation.other;
		take('attestation', a.id, fillCopy(tpl, { day: day(a.date) }));
	}
	for (const v of rcv?.reverifications ?? []) take('reverification', v.id, fillCopy(PROOF_FILE_ROW.reverification, { day: day(v.date) }));

	for (const r of left.values()) rows.push({ ...r, label: PROOF_FILE_ROW_FALLBACK[r.kind], href: proofFileHref(r.kind, r.id) });
	return rows;
}
