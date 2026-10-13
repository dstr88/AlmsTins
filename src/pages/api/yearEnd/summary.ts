/**
 * GET /api/yearEnd/summary?year=YYYY
 *
 * Returns a Schedule D–style tax summary for the authenticated tenant.
 *
 * Capital gain/loss computation is approximate: proceeds come from lifecycle
 * events (out-direction, taxable classes); cost basis comes from the
 * weighted_avg_cost_usd recorded on the lifecycle group at the time the event
 * was inserted.  Exact FIFO per-lot matching is done client-side on the
 * transactions page — this endpoint provides the high-level dashboard card.
 *
 * Response shape:
 * {
 *   ok: true,
 *   year: 2024,
 *   ordinaryIncome: { total: number, count: number, byAsset: {symbol, amount}[] },
 *   disposals:      { totalProceeds: number, count: number, unpricedCount: number },
 *   unpricedOnchain: number,   // onchain txs still missing native_usd
 * }
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { requireTaxOwner } from '@/lib/taxAuth';
import { getYearEndSummary, isValidSummaryYear, parseSummaryMethod } from '@/lib/yearEndSummary';
import { getLang } from '@/lib/i18n/locale';
import { getYearEndErrors } from '@/i18n/apiErrors/yearEnd';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
	const denied = await requireTaxOwner(request); // tax documents: owner only
	if (denied) return denied;
	const session = await requireTenantSession(request);
	if (!session) return respond({ ok: false, error: 'Unauthorized' }, 401);
	const { tenantId } = session;

	const t = getYearEndErrors(getLang(request));

	const yearParam = url.searchParams.get('year');
	const year      = yearParam ? Number(yearParam) : new Date().getFullYear();
	const method    = parseSummaryMethod(url.searchParams.get('method'));

	if (!isValidSummaryYear(year)) {
		return respond({ ok: false, error: t.invalidYear }, 400);
	}

	// The computation lives in src/lib/yearEndSummary.ts, shared with /dashboard/yearEnd/gains.
	const summary = await getYearEndSummary(tenantId, year, method);
	if (!summary) return respond({ ok: false, error: t.unableToBuildSummary }, 500);
	return respond(summary);
};

function respond(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
