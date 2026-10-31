/**
 * A receivable's financing position, derived one way for every reader.
 *
 * Pure and client-safe. Extracted unchanged from getReceivableStatus in receivablesRegistry.ts
 * (claimed, financing status, lifecycle) and from rag() in the registry page's inline script
 * (the pill state). tests/receivables/registryCharacterization.test.ts and registryRag.test.ts
 * pinned that behavior before the move.
 */
import { isPartyDispute } from './attestationClass';

export type FinancingStatus = 'unfinanced' | 'partially_financed' | 'fully_financed' | 'over_financed';

/** Lifecycle stage: created, then financed, then settled. Released = every claim discharged,
 *  not yet marked settled. */
export type Lifecycle = 'created' | 'financed' | 'released' | 'settled';

/** The sum of active (not discharged) claims, in the order given. A claim marked `aging: 'lapsed'`
 *  (D7: its record was not maintained for LAPSE_AFTER_DAYS) is left out of the sum — it no longer
 *  counts toward headroom or the duplicate-financing answer, while the claim itself stays listed.
 *  Claims that carry no aging field count exactly as before. */
export function claimedOf(claims: ReadonlyArray<{ status: string; amount: number; aging?: string }>): number {
	return claims.filter((c) => c.status === 'active' && c.aging !== 'lapsed').reduce((s, c) => s + c.amount, 0);
}

/** Claims are summed in floating point, so claims that add up to the face can land a hair above or
 *  below it (0.1 + 0.2, or 699.70 + 200.20 + 100.10, depending on the order they are added). Within
 *  one part in a billion of the face counts as equal: far below a cent, and it works for currencies
 *  with no minor unit or three of them. */
const FACE_TOLERANCE = 1e-9;

export function financingStatusOf(claimed: number, face: number): FinancingStatus {
	return claimed <= 0 ? 'unfinanced'
		: Math.abs(claimed - face) <= FACE_TOLERANCE * Math.max(1, Math.abs(face)) ? 'fully_financed'
		: claimed < face ? 'partially_financed'
		: 'over_financed';
}

export function lifecycleOf(p: { settled: boolean; claimed: number; hadClaims: boolean }): Lifecycle {
	return p.settled ? 'settled'
		: p.claimed > 0 ? 'financed'
		: p.hadClaims ? 'released'
		: 'created';
}

/** The one-glance state a status pill shows, in priority order. */
export type RagState = 'test' | 'disputed' | 'settled' | 'partial' | 'full' | 'open';

export interface RagInput {
	isTest?: unknown;
	settled?: unknown;
	status?: unknown;
	attestations?: ReadonlyArray<{ class?: unknown; role?: unknown; statement?: unknown; source?: unknown }> | null;
}

/**
 * A test record first: a second financier must never weigh a rehearsal as an encumbrance, nor
 * dismiss a real claim because he expected a test. Then a party's dispute, then settlement,
 * then how much is encumbered.
 *
 * Withdrawn (S2) is deliberately not a state here. A withdrawn record that is disputed or fully
 * financed is exactly the one a second financier must see as such, so the pill keeps the record's
 * state and the "withdrawn" tag is shown beside it (WithdrawnNote, the book and list marks).
 */
export function ragState(rcv: RagInput): RagState {
	if (rcv.isTest) return 'test';
	if ((rcv.attestations || []).some((a) => isPartyDispute(a))) return 'disputed';
	if (rcv.settled) return 'settled';
	if (rcv.status === 'partially_financed') return 'partial';
	if (rcv.status === 'fully_financed' || rcv.status === 'over_financed') return 'full';
	return 'open';
}
