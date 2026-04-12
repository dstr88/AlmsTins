/**
 * POST /api/tax/1099/upload
 *
 * Accepts a multipart form with a 1099-DA or 1099-B CSV file.
 * Parses the CSV into structured rows, stores them in tax_1099_uploads,
 * then runs reconciliation against computed gains from annualBreakdown.
 *
 * Body (multipart/form-data):
 *   file        — CSV file
 *   formType    — '1099-da' | '1099-b'
 *   taxYear     — e.g. '2024'
 *   exchangeName — optional, e.g. 'Coinbase'
 *
 * Response: { ok, uploadId, rowCount, reconciliation: ReconcRow[] }
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';
import { buildAnnualBreakdown, type AnnualBreakdownSource } from '@/lib/annualBreakdown';
import { randomUUID } from 'node:crypto';

export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

// ── CSV parser (no dependencies) ─────────────────────────────────────────────
function parseCsv(text: string): Array<Record<string, string>> {
	const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
	if (lines.length < 2) return [];

	// Find header row (skip blank leading lines)
	let headerIdx = 0;
	while (headerIdx < lines.length && lines[headerIdx].trim() === '') headerIdx++;
	if (headerIdx >= lines.length) return [];

	const headers = splitCsvLine(lines[headerIdx]).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
	const rows: Array<Record<string, string>> = [];

	for (let i = headerIdx + 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;
		const cols = splitCsvLine(line);
		const row: Record<string, string> = {};
		headers.forEach((h, idx) => {
			row[h] = (cols[idx] ?? '').trim().replace(/^\$/, '').replace(/,/g, '');
		});
		rows.push(row);
	}
	return rows;
}

function splitCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
			else inQuotes = !inQuotes;
		} else if (ch === ',' && !inQuotes) {
			result.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	result.push(current);
	return result;
}

// ── Column name normalisation ─────────────────────────────────────────────────
// 1099-DA and 1099-B have different column names across exchanges.
// We normalise to: proceeds, cost_basis, asset, acquired, disposed
interface NormRow {
	asset:        string;
	proceeds:     number | null;
	costBasis:    number | null;
	acquiredAt:   string | null;
	disposedAt:   string | null;
	rawProceeds:  string;
	rawBasis:     string;
}

function normaliseRow(row: Record<string, string>, formType: string): NormRow | null {
	// Map common column variations
	const get = (...keys: string[]) => {
		for (const k of keys) {
			const val = row[k] ?? row[k.replace(/_/g, '')] ?? row[k.replace(/_/g, ' ')];
			if (val != null && val !== '') return val;
		}
		return '';
	};

	const asset = get(
		'asset', 'symbol', 'cryptocurrency', 'digital_asset', 'coin',
		'description', 'asset_name', 'currency',
	);

	const rawProceeds = get('proceeds', 'gross_proceeds', 'total_proceeds', 'sale_price', 'proceeds_usd');
	const rawBasis    = get('cost_basis', 'cost_or_other_basis', 'adjusted_basis', 'basis', 'cost');
	const acquiredAt  = get('date_acquired', 'acquisition_date', 'date_of_acquisition', 'acquired');
	const disposedAt  = get('date_sold', 'date_disposed', 'disposition_date', 'date_of_sale', 'disposed', 'sold');

	const proceeds  = rawProceeds  ? parseFloat(rawProceeds.replace(/[$,]/g, ''))  : null;
	const costBasis = rawBasis     ? parseFloat(rawBasis.replace(/[$,]/g, ''))     : null;

	// Skip rows that are clearly empty / totals
	if (!asset && proceeds == null && costBasis == null) return null;

	return {
		asset: asset.toUpperCase().replace(/\s+/g, ''),
		proceeds:    Number.isFinite(proceeds)  ? proceeds  : null,
		costBasis:   Number.isFinite(costBasis) ? costBasis : null,
		acquiredAt:  acquiredAt  || null,
		disposedAt:  disposedAt  || null,
		rawProceeds,
		rawBasis,
	};
}

// ── Reconciliation ────────────────────────────────────────────────────────────
interface ReconcRow {
	id:               string;
	formAsset:        string;
	formProceeds:     number | null;
	formCostBasis:    number | null;
	formAcquiredAt:   string | null;
	formDisposedAt:   string | null;
	computedProceeds: number | null;
	computedBasis:    number | null;
	computedGain:     number | null;
	matchStatus:      string;
	deltaProceeds:    number | null;
	deltaBasis:       number | null;
}

const TOLERANCE = 1.0; // $1 rounding tolerance

function classify(deltaP: number | null, deltaB: number | null): string {
	if (deltaP == null && deltaB == null) return 'unmatched';
	const pOk = deltaP == null || Math.abs(deltaP) <= TOLERANCE;
	const bOk = deltaB == null || Math.abs(deltaB) <= TOLERANCE;
	if (pOk && bOk) return 'matched';
	if (!pOk && bOk) return 'proceeds_diff';
	if (pOk && !bOk) return 'basis_diff';
	return 'proceeds_diff'; // both off
}

// ── Main handler ──────────────────────────────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
	let tenantId: string;
	let userId: string;
	try {
		const t = await requireTenantSession(request);
		if (!t) return json({ ok: false, error: 'Unauthorized' }, 401);
		tenantId = t.tenantId;
		const session = await getAuthSession(request);
		userId = session?.user?.id ?? tenantId;
	} catch {
		return json({ ok: false, error: 'Unauthorized' }, 401);
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ ok: false, error: 'Invalid form data' }, 400);
	}

	const file         = formData.get('file') as File | null;
	const formType     = String(formData.get('formType') ?? '1099-da') === '1099-b' ? '1099-b' : '1099-da';
	const taxYearRaw   = formData.get('taxYear');
	const exchangeName = String(formData.get('exchangeName') ?? '').trim() || null;

	if (!file || file.size === 0) return json({ ok: false, error: 'No file provided' }, 400);
	if (file.size > 5 * 1024 * 1024) return json({ ok: false, error: 'File too large (max 5 MB)' }, 400);

	const taxYear = parseInt(String(taxYearRaw ?? new Date().getFullYear() - 1), 10);
	if (!Number.isFinite(taxYear) || taxYear < 2015 || taxYear > 2030) {
		return json({ ok: false, error: 'Invalid tax year' }, 400);
	}

	// Read CSV text
	let csvText: string;
	try {
		csvText = await file.text();
	} catch {
		return json({ ok: false, error: 'Could not read file' }, 400);
	}

	// Parse
	let parsedRows: NormRow[];
	try {
		const rawRows = parseCsv(csvText);
		parsedRows = rawRows.map(r => normaliseRow(r, formType)).filter((r): r is NormRow => r !== null);
	} catch (err) {
		console.error('[1099/upload] parse error', err);
		return json({ ok: false, error: 'Failed to parse CSV' }, 422);
	}

	if (parsedRows.length === 0) {
		return json({ ok: false, error: 'No data rows found in CSV. Check that this is a valid 1099-DA/B file.' }, 422);
	}

	// Store upload record
	const uploadId = randomUUID();
	try {
		await db.execute({
			sql: `INSERT INTO tax_1099_uploads
			        (id, tenant_id, user_id, form_type, exchange_name, tax_year, filename, status, row_count, raw_csv, parsed_json)
			      VALUES (?, ?, ?, ?, ?, ?, ?, 'parsed', ?, ?, ?)`,
			args: [
				uploadId, tenantId, userId, formType, exchangeName, taxYear,
				file.name, parsedRows.length,
				csvText.slice(0, 500_000), // cap raw storage at 500 KB
				JSON.stringify(parsedRows),
			],
		});
	} catch (err) {
		console.error('[1099/upload] DB insert error', err);
		return json({ ok: false, error: 'Database error saving upload' }, 500);
	}

	// ── Reconcile against computed gains ──────────────────────────────────────
	let bd: Awaited<ReturnType<typeof buildAnnualBreakdown>>;
	try {
		bd = await buildAnnualBreakdown(tenantId, taxYear, 'fifo', undefined, 'auto' as AnnualBreakdownSource);
	} catch (err) {
		console.error('[1099/upload] breakdown error', err);
		// Don't fail the upload — store as-is without reconciliation
		return json({ ok: true, uploadId, rowCount: parsedRows.length, reconciliation: [] });
	}

	// Group computed disposals by asset symbol for matching
	// bd.shortTerm + bd.longTerm are SettledLot arrays
	type Disposal = { asset: string; proceedsUsd: number | null; costUsd: number | null; gainLossUsd: number | null; sellDate: string };
	const allDisposals: Disposal[] = [...bd.shortTerm, ...bd.longTerm];
	const computedBySymbol = new Map<string, Disposal[]>();
	for (const d of allDisposals) {
		const sym = (d.asset ?? '').toUpperCase();
		if (!computedBySymbol.has(sym)) computedBySymbol.set(sym, []);
		computedBySymbol.get(sym)!.push(d);
	}

	const reconcRows: ReconcRow[] = [];
	const reconcInserts: Array<() => Promise<void>> = [];

	for (const formRow of parsedRows) {
		const computed = computedBySymbol.get(formRow.asset);

		// Simple aggregated match: sum computed proceeds/basis for same asset
		const computedProceeds = computed ? computed.reduce((s, d) => s + (d.proceedsUsd ?? 0), 0) : null;
		const computedBasis    = computed ? computed.reduce((s, d) => s + (d.costUsd ?? 0), 0) : null;
		const computedGain     = (computedProceeds != null && computedBasis != null)
			? computedProceeds - computedBasis
			: null;

		const deltaProceeds = (formRow.proceeds != null && computedProceeds != null)
			? formRow.proceeds - computedProceeds
			: null;
		const deltaBasis = (formRow.costBasis != null && computedBasis != null)
			? formRow.costBasis - computedBasis
			: null;

		const matchStatus = classify(deltaProceeds, deltaBasis);

		const rowId = randomUUID();
		const reconcRow: ReconcRow = {
			id:               rowId,
			formAsset:        formRow.asset,
			formProceeds:     formRow.proceeds,
			formCostBasis:    formRow.costBasis,
			formAcquiredAt:   formRow.acquiredAt,
			formDisposedAt:   formRow.disposedAt,
			computedProceeds,
			computedBasis,
			computedGain,
			matchStatus,
			deltaProceeds,
			deltaBasis,
		};
		reconcRows.push(reconcRow);

		reconcInserts.push(() => db.execute({
			sql: `INSERT INTO tax_1099_reconciliation
			        (id, upload_id, tenant_id, form_asset, form_proceeds_usd, form_cost_basis,
			         form_acquired_at, form_disposed_at, computed_proceeds, computed_basis,
			         computed_gain, match_status, delta_proceeds, delta_basis)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				rowId, uploadId, tenantId,
				formRow.asset, formRow.proceeds, formRow.costBasis,
				formRow.acquiredAt, formRow.disposedAt,
				computedProceeds, computedBasis, computedGain,
				matchStatus, deltaProceeds, deltaBasis,
			],
		}).then(() => {}));
	}

	// Store reconciliation rows (fire-and-forget; don't block response)
	Promise.all(reconcInserts.map(fn => fn())).catch(err => {
		console.error('[1099/upload] reconciliation DB error', err);
	});

	// Sort: unmatched first, then by delta descending
	reconcRows.sort((a, b) => {
		const order: Record<string, number> = { unmatched: 0, proceeds_diff: 1, basis_diff: 2, matched: 3, extra: 4 };
		return (order[a.matchStatus] ?? 9) - (order[b.matchStatus] ?? 9);
	});

	return json({ ok: true, uploadId, rowCount: parsedRows.length, reconciliation: reconcRows });
};
