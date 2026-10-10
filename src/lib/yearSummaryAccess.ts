import { isOwner } from './owner';

/**
 * The Year Summary PDF (and the verification bundle that proves it) is an Unlimited-plan
 * feature, as the pricing page says (decided 2026-10-10; it had been served to any paid
 * plan). The owner always has it: it is the owner's own tax tool. The gain/loss CSV is
 * separate and stays on every paid plan.
 */
export function canDownloadYearSummaryPdf(planId: string, tenantId: string | null | undefined): boolean {
	return planId === 'unlimited' || isOwner(tenantId);
}
