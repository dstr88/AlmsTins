/**
 * Who may download what from the history and bookkeeping buttons. Small and dependency-free
 * so the pages can render the right button without loading the export code.
 *
 *   History by wallet (ZIP, GET /api/records/history-by-wallet): any paid plan, the cheapest
 *   included, and the owner always (owner decision, Oct 12 2026). Fail-closed: a plan id that
 *   is not listed here is treated as free.
 *
 *   Bookkeeping Needs Attention and Income CSVs: the same rule breakdown-csv.ts applies
 *   (refused when the plan is free), so the page never offers a button that downloads an error.
 *
 * Demo sessions follow the demo tenant's own plan (getActivePlan), as the bookkeeping CSVs
 * and the Year Summary PDF already do; the demo data is the synthetic demo set.
 */

import { isOwner } from './owner';

export const HISTORY_BY_WALLET_PLANS: ReadonlySet<string> = new Set(['starter', 'pro', 'unlimited']);

export function canDownloadHistoryByWallet(planId: string | null | undefined, tenantId: string | null | undefined): boolean {
	return (!!planId && HISTORY_BY_WALLET_PLANS.has(planId)) || isOwner(tenantId);
}

export function canDownloadBookkeepingCsv(planId: string | null | undefined): boolean {
	return !!planId && planId !== 'free';
}
