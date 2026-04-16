/**
 * GET  /api/reconciliation/monthly?month=YYYY-MM   — load or compute a single month
 * POST /api/reconciliation/monthly                 — body: { month: 'YYYY-MM' } — force recompute + save
 * GET  /api/reconciliation/monthly?months=all      — list all available months (no detail)
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import {
	computeMonthlyReconciliation,
	saveMonthlyReconciliation,
	loadMonthlyReconciliation,
	getAvailableReconciliationMonths,
} from '@/lib/monthlyReconciliation';

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});

export const GET: APIRoute = async ({ request }) => {
	const tenant = await requireTenantSession(request);
	if (!tenant) return json({ error: 'Unauthorized' }, 401);
	const { tenantId } = tenant;

	const url = new URL(request.url);
	const monthParam  = url.searchParams.get('month');
	const monthsParam = url.searchParams.get('months');

	// ?months=all → return list of available months
	if (monthsParam === 'all') {
		const months = await getAvailableReconciliationMonths(tenantId);
		return json({ months });
	}

	// ?month=YYYY-MM → load cached or compute fresh
	if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
		return json({ error: 'month parameter required (YYYY-MM)' }, 400);
	}

	// Try cache first
	const cached = await loadMonthlyReconciliation(tenantId, monthParam);
	if (cached) return json({ data: cached, source: 'cache' });

	// Compute and cache
	const data = await computeMonthlyReconciliation(tenantId, monthParam);
	await saveMonthlyReconciliation(tenantId, data);
	return json({ data, source: 'computed' });
};

export const POST: APIRoute = async ({ request }) => {
	const tenant = await requireTenantSession(request);
	if (!tenant) return json({ error: 'Unauthorized' }, 401);
	const { tenantId } = tenant;

	let body: { month?: string } = {};
	try { body = await request.json(); } catch { /* ignore */ }

	const month = body.month;
	if (!month || !/^\d{4}-\d{2}$/.test(month)) {
		return json({ error: 'body.month required (YYYY-MM)' }, 400);
	}

	const data = await computeMonthlyReconciliation(tenantId, month);
	await saveMonthlyReconciliation(tenantId, data);
	return json({ data, source: 'recomputed' });
};
