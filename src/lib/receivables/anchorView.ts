/**
 * Bitcoin timestamp state for a receivables record, and the views the pages build from it.
 * A lookup row carries `anchored` (a receipt is stored) and `anchoredAt` (the block time once
 * confirmed). anchoredAt is only ever set alongside a receipt (receivablesRegistry.ts sets
 * anchored: !!anchor_json, anchoredAt: anchoredAtOf(anchor_json)), so checking it first agrees
 * with the desk's anchored-first checks on every real row. Pure; imports only copy.
 */
import { fillCopy } from './fillCopy';
import {
	ANCHOR_CHECKLIST_CONFIRMED_DETAIL, ANCHOR_CHECKLIST_NONE_DETAIL, ANCHOR_CHECKLIST_NONE_LABEL,
	ANCHOR_EVIDENCE_CONFIRMED_DETAIL, ANCHOR_EVIDENCE_NONE_DETAIL, ANCHOR_EVIDENCE_NONE_TITLE,
	ANCHOR_PENDING_DETAIL, ANCHOR_PILL_CONFIRMED, ANCHOR_PILL_NONE, ANCHOR_PILL_NONE_ACTION,
	ANCHOR_PILL_PENDING, ANCHOR_PILL_PENDING_ACTION, ANCHOR_TIMESTAMPED_TITLE,
} from './copy/anchor';

/** The record kinds the page-driven anchor route accepts (anchor.ts KINDS). */
export type PageAnchorKind = 'receivable' | 'claim' | 'attestation';
export interface AnchorFields { anchored?: boolean | null; anchoredAt?: string | null }
export type AnchorState = 'confirmed' | 'pending' | 'none';

export function anchorStateOf(rec: AnchorFields): AnchorState {
	if (rec.anchoredAt) return 'confirmed';
	if (rec.anchored) return 'pending';
	return 'none';
}

/** YYYY-MM-DD of the block time, as every page shows it today. */
export function anchorDay(rec: AnchorFields): string {
	return String(rec.anchoredAt).slice(0, 10);
}

export function anchorPillLabel(rec: AnchorFields, actionable: boolean): string {
	const s = anchorStateOf(rec);
	if (s === 'confirmed') return fillCopy(ANCHOR_PILL_CONFIRMED, { day: anchorDay(rec) });
	if (s === 'pending') return actionable ? ANCHOR_PILL_PENDING_ACTION : ANCHOR_PILL_PENDING;
	return actionable ? ANCHOR_PILL_NONE_ACTION : ANCHOR_PILL_NONE;
}

export interface AnchorEvidenceView { good: boolean; icon: string; title: string; detail: string }
export function anchorEvidence(rec: AnchorFields): AnchorEvidenceView {
	const s = anchorStateOf(rec);
	if (s === 'none') return { good: false, icon: '·', title: ANCHOR_EVIDENCE_NONE_TITLE, detail: ANCHOR_EVIDENCE_NONE_DETAIL };
	return {
		good: true, icon: '⛓', title: ANCHOR_TIMESTAMPED_TITLE,
		detail: s === 'confirmed' ? fillCopy(ANCHOR_EVIDENCE_CONFIRMED_DETAIL, { day: anchorDay(rec) }) : ANCHOR_PENDING_DETAIL,
	};
}

export interface AnchorChecklistView { state: 'yes' | 'na'; label: string; detail: string }
export function anchorChecklist(rec: AnchorFields): AnchorChecklistView {
	const s = anchorStateOf(rec);
	if (s === 'none') return { state: 'na', label: ANCHOR_CHECKLIST_NONE_LABEL, detail: ANCHOR_CHECKLIST_NONE_DETAIL };
	return {
		state: 'yes', label: ANCHOR_TIMESTAMPED_TITLE,
		detail: s === 'confirmed' ? fillCopy(ANCHOR_CHECKLIST_CONFIRMED_DETAIL, { day: anchorDay(rec) }) : ANCHOR_PENDING_DETAIL,
	};
}
