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

/** The sum of active (not discharged) claims, in the order given. */
export function claimedOf(claims: ReadonlyArray<{ status: string; amount: number }>): number {
	return claims.filter((c) => c.status === 'active').reduce((s, c) => s + c.amount, 0);
}

export function financingStatusOf(claimed: number, face: number): FinancingStatus {
	return claimed <= 0 ? 'unfinanced'
		: claimed < face ? 'partially_financed'
		: claimed === face ? 'fully_financed'
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
 */
export function ragState(rcv: RagInput): RagState {
	if (rcv.isTest) return 'test';
	if ((rcv.attestations || []).some((a) => isPartyDispute(a))) return 'disputed';
	if (rcv.settled) return 'settled';
	if (rcv.status === 'partially_financed') return 'partial';
	if (rcv.status === 'fully_financed' || rcv.status === 'over_financed') return 'full';
	return 'open';
}
