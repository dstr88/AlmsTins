/**
 * GET /api/yearEnd/form8949?year=YYYY&method=fifo
 *
 * Returns structured Form 8949 data grouped by box.
 *
 * IRS Form 8949 boxes:
 *   Part I  — Short-term (held ≤ 365 days)
 *     Box A: Covered   — basis reported to IRS on 1099-B (post-2025 exchange reports)
 *     Box B: Uncovered — NOT reported to IRS (pre-2025 exchange reports)
 *     Box C: All other — no 1099-B issued (all pre-2025 crypto defaults here)
 *   Part II — Long-term (held > 365 days)
 *     Box D: Covered
 *     Box E: Uncovered
 *     Box F: All other  ← all pre-2025 crypto goes here
 *
 * For most crypto transactions:
 *   - All pre-2025: Box C (ST) and Box F (LT) — "all other, no 1099-B"
 *   - With 2025+ 1099-DA uploads matched: Box A (ST) or Box D (LT)
 *
 * Response shape:
 * {
 *   ok: true,
 *   year: 2024,
 *   method: 'fifo',
 *   boxes: {
 *     A: Form8949Box, B: Form8949Box, C: Form8949Box,
 *     D: Form8949Box, E: Form8949Box, F: Form8949Box,
 *   },
 *   totals: { proceeds, basis, gainLoss }
 * }
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { buildAnnualBreakdown, type CostBasisMethod, type AnnualBreakdownSource } from '@/lib/annualBreakdown';
import { getCache, setCache } from '@/lib/tursoCache';
import { getLang } from '@/lib/i18n/locale';
import { getYearEndErrors } from '@/i18n/apiErrors/yearEnd';

export const prerender = false;

export interface Form8949Row {
	description:  string;  // (a) e.g. "0.5 BTC"
	dateAcquired: string;  // (b) MM/DD/YYYY or "VARIOUS"
	dateSold:     string;  // (c) MM/DD/YYYY
	proceeds:     number;  // (d)
	costBasis:    number;  // (e)
	codes:        string;  // (f) adjustment codes — blank, 'BO', 'W', etc.
	adjustment:   number;  // (g) net adjustment amount
	gainLoss:     number;  // (h) proceeds - costBasis + adjustment
	daysHeld:     number;
}

export interface Form8949Box {
	box:      'A' | 'B' | 'C' | 'D' | 'E' | 'F';
	label:    string;
	part:     'I' | 'II';
	term:     'short' | 'long';
	rows:     Form8949Row[];
	totals:   { proceeds: number; basis: number; gainLoss: number };
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function fmtDate(iso: string): string {
	try {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		const m = d.getUTCMonth() + 1;
		const day = d.getUTCDate();
		const y = d.getUTCFullYear();
		return `${m}/${day}/${y}`;
	} catch { return iso; }
}

function boxTotals(rows: Form8949Row[]) {
	return {
		proceeds: rows.reduce((s, r) => s + r.proceeds, 0),
		basis:    rows.reduce((s, r) => s + r.costBasis, 0),
		gainLoss: rows.reduce((s, r) => s + r.gainLoss, 0),
	};
}

export const GET: APIRoute = async ({ request }) => {
	try {
		const sess = await requireTenantSession(request);
		if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
		const { tenantId } = sess;

		const t = getYearEndErrors(getLang(request));

		const url = new URL(request.url);
		const yearParam = url.searchParams.get('year');
		const year = yearParam ? Number(yearParam) : new Date().getFullYear() - 1;
		const methodParam = url.searchParams.get('method');
		const method: CostBasisMethod =
			methodParam === 'hifo'    ? 'hifo'    :
			methodParam === 'lifo'    ? 'lifo'    :
			methodParam === 'spec_id' ? 'spec_id' : 'fifo';

		if (isNaN(year) || year < 2009 || year > 2100) {
			return json({ ok: false, error: t.invalidYear }, 400);
		}

		const cacheKey = `t:${tenantId}:form8949:${year}:${method}:v1`;
		const cached = await getCache<unknown>(cacheKey, { allowStale: true, staleMaxAgeSeconds: 30 * 60 });
		if (cached.value) return json({ ok: true, ...(cached.value as object), cached: true });

		// ── Build breakdown ────────────────────────────────────────────────────
		// 'auto': prefer pipeline data when available (IRS calendar-month accurate);
		// fall back to lifecycle-events FIFO if pipeline hasn't run for this year.
		const bd = await buildAnnualBreakdown(tenantId, year, method, undefined, 'auto' as AnnualBreakdownSource);

		// ── Classify each settled lot into a box ──────────────────────────────
		// Pre-2025 crypto: Box C (short-term) and Box F (long-term)
		// Post-2025 with 1099-DA coverage: Box A (ST) or Box D (LT)
		// For now, all crypto defaults to Box C / Box F ("all other")
		// A future enhancement can check tax_1099_uploads to identify covered transactions

		const boxC: Form8949Row[] = [];
		const boxF: Form8949Row[] = [];

		for (const lot of bd.shortTerm) {
			const proceeds  = lot.proceedsUsd ?? 0;
			const costBasis = lot.costUsd     ?? 0;
			const gainLoss  = proceeds - costBasis;
			const codes     = lot.costUsd == null ? 'BO' : '';  // "BO" = basis not reported
			boxC.push({
				description:  `${lot.amount.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${lot.asset}`,
				dateAcquired: fmtDate(lot.buyDate),
				dateSold:     fmtDate(lot.sellDate),
				proceeds,
				costBasis,
				codes,
				adjustment:   0,
				gainLoss,
				daysHeld:     lot.daysHeld,
			});
		}

		for (const lot of bd.longTerm) {
			const proceeds  = lot.proceedsUsd ?? 0;
			const costBasis = lot.costUsd     ?? 0;
			const gainLoss  = proceeds - costBasis;
			const codes     = lot.costUsd == null ? 'BO' : '';
			boxF.push({
				description:  `${lot.amount.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${lot.asset}`,
				dateAcquired: fmtDate(lot.buyDate),
				dateSold:     fmtDate(lot.sellDate),
				proceeds,
				costBasis,
				codes,
				adjustment:   0,
				gainLoss,
				daysHeld:     lot.daysHeld,
			});
		}

		// ── Build empty placeholder boxes (A, B, D, E) ────────────────────────
		const emptyBox = (box: 'A' | 'B' | 'D' | 'E', part: 'I' | 'II', term: 'short' | 'long', label: string): Form8949Box => ({
			box, label, part, term, rows: [], totals: { proceeds: 0, basis: 0, gainLoss: 0 },
		});

		const boxes: Record<string, Form8949Box> = {
			A: emptyBox('A', 'I',  'short', 'Basis reported to IRS (covered ST)'),
			B: emptyBox('B', 'I',  'short', 'Basis NOT reported to IRS (uncovered ST)'),
			C: { box: 'C', label: 'All other (no 1099-B) — ST', part: 'I',  term: 'short', rows: boxC, totals: boxTotals(boxC) },
			D: emptyBox('D', 'II', 'long',  'Basis reported to IRS (covered LT)'),
			E: emptyBox('E', 'II', 'long',  'Basis NOT reported to IRS (uncovered LT)'),
			F: { box: 'F', label: 'All other (no 1099-B) — LT', part: 'II', term: 'long',  rows: boxF, totals: boxTotals(boxF) },
		};

		const allRows = [...boxC, ...boxF];
		const totals = {
			proceeds: allRows.reduce((s, r) => s + r.proceeds, 0),
			basis:    allRows.reduce((s, r) => s + r.costBasis, 0),
			gainLoss: allRows.reduce((s, r) => s + r.gainLoss, 0),
		};

		const payload = { year, method, boxes, totals };
		await setCache(cacheKey, payload, 5 * 60);

		return json({ ok: true, ...payload, cached: false });
	} catch (err) {
		console.error('[form8949] error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
