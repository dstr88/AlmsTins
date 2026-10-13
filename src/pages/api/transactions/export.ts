/**
 * GET /api/transactions/export[?walletId=...][&year=YYYY]
 *
 * The plain CSV of the tenant's own transactions: no wallet grouping, owner or label columns
 * (the grouped, labeled ZIP is GET /api/records/history-by-wallet, on paid plans). Answers on
 * every plan, as it always has: it is the portability export the privacy policy promises.
 * Linked from src/components/dashboard/HistoryDownload.astro ("Download my transactions
 * (CSV)", shown to a Free account on Wallets and Bookkeeping) and from
 * src/components/dashboard/Tin0AllTransactions.astro (the ?walletId= link; that panel is
 * switched off in vault.astro for now).
 *
 * Built from the same rows as the grouped export (src/lib/historyRows.ts), which fixes what
 * this route used to get wrong: ?walletId= now filters every half (it filtered only the
 * on-chain half, so a one-wallet file held every exchange row), duplicates are skipped, Sui
 * is included, on-chain amounts are filled in, every cell is protected against spreadsheet
 * formulas, and the filename no longer carries the raw wallet id.
 *
 * Like the ZIP: more than MAX_HISTORY_ROWS rows is a JSON 413 (choose a year), and a second
 * request while this account's file is being built is a JSON 429.
 *
 * The tenant comes from the session only; a walletId must belong to that tenant.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { buildPlainHistory, HistoryBusyError, parseYearParam } from '@/lib/historyExport';
import { HistoryTooLargeError } from '@/lib/historyRows';
import { getLang } from '@/lib/i18n/locale';

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const { tenantId } = session;

	const params = new URL(request.url).searchParams;
	const parsed = parseYearParam(params.get('year'));
	if (!parsed.ok) return json({ error: 'Invalid year.' }, 400);

	let wallet: { id: string; address: string; label: string | null } | undefined;
	const walletId = params.get('walletId');
	if (walletId !== null) {
		if (!walletId.trim()) return json({ error: 'Wallet id is required.' }, 400);
		const res = await db.execute({
			sql: 'SELECT w.id, w.address, w.label FROM wallets w WHERE w.id = ? AND w.tenant_id = ? LIMIT 1',
			args: [walletId, tenantId],
		});
		const row = res.rows[0] as Record<string, unknown> | undefined;
		if (!row) return json({ error: 'Wallet not found.' }, 404);
		wallet = {
			id: String(row.id),
			address: String(row.address ?? ''),
			label: row.label == null ? null : String(row.label),
		};
	}

	try {
		const { filename, csv } = await buildPlainHistory(tenantId, { year: parsed.year, wallet, lang: getLang(request) });
		return new Response(csv, {
			status: 200,
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Cache-Control': 'no-store',
			},
		});
	} catch (err) {
		if (err instanceof HistoryTooLargeError) {
			return json({ error: 'Too many rows for one file. Choose a year.', tooManyRows: true, limit: err.limit }, 413);
		}
		if (err instanceof HistoryBusyError) {
			return json({ error: 'A download is already being prepared for this account.' }, 429);
		}
		console.error('[transactions/export] build failed', err);
		return json({ error: 'The download could not be prepared. Please try again.' }, 500);
	}
};
