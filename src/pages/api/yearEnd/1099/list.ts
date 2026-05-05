/**
 * GET /api/yearEnd/1099/list?year=2024
 *
 * Returns all 1099 uploads for the current tenant (summary only, no raw CSV).
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';

export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const GET: APIRoute = async ({ request }) => {
	try {
		const sess = await requireTenantSession(request);
		if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
		const { tenantId } = sess;

		const url = new URL(request.url);
		const year = parseInt(url.searchParams.get('year') ?? '0', 10) || null;

		const result = await db.execute({
			sql: `SELECT id, form_type, exchange_name, tax_year, filename, status, row_count, created_at
			      FROM tax_1099_uploads
			      WHERE tenant_id = ?
			        ${year ? 'AND tax_year = ?' : ''}
			      ORDER BY created_at DESC
			      LIMIT 50`,
			args: year ? [tenantId, year] : [tenantId],
		});

		type DbRow = Record<string, unknown>;
		const uploads = (result.rows as DbRow[]).map(r => ({
			id:           String(r.id),
			formType:     String(r.form_type),
			exchangeName: r.exchange_name ? String(r.exchange_name) : null,
			taxYear:      Number(r.tax_year),
			filename:     String(r.filename),
			status:       String(r.status),
			rowCount:     r.row_count != null ? Number(r.row_count) : null,
			createdAt:    String(r.created_at),
		}));

		return json({ ok: true, uploads });
	} catch (err) {
		console.error('[1099/list] error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
