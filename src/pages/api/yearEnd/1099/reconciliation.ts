/**
 * GET /api/yearEnd/1099/reconciliation?uploadId=xxx
 *
 * Returns the reconciliation rows for a specific upload.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { getLang } from '@/lib/i18n/locale';
import { getYearEndErrors } from '@/i18n/apiErrors/yearEnd';

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

		const t = getYearEndErrors(getLang(request));

		const url = new URL(request.url);
		const uploadId = url.searchParams.get('uploadId');
		if (!uploadId) return json({ ok: false, error: 'uploadId required' }, 400);

		// Verify ownership
		const upload = await db.execute({
			sql: `SELECT id, form_type, exchange_name, tax_year, filename, row_count, created_at
			      FROM tax_1099_uploads
			      WHERE id = ? AND tenant_id = ?`,
			args: [uploadId, tenantId],
		});
		if (!upload.rows[0]) return json({ ok: false, error: t.uploadNotFound }, 404);

		const rows = await db.execute({
			sql: `SELECT id, form_asset, form_proceeds_usd, form_cost_basis, form_acquired_at, form_disposed_at,
			             computed_proceeds, computed_basis, computed_gain,
			             match_status, delta_proceeds, delta_basis, notes
			      FROM tax_1099_reconciliation
			      WHERE upload_id = ? AND tenant_id = ?
			      ORDER BY
			        CASE match_status
			          WHEN 'unmatched'     THEN 1
			          WHEN 'proceeds_diff' THEN 2
			          WHEN 'basis_diff'    THEN 3
			          WHEN 'matched'       THEN 4
			          ELSE 5
			        END`,
			args: [uploadId, tenantId],
		});

		type DbRow = Record<string, unknown>;
		const reconciliation = (rows.rows as DbRow[]).map(r => ({
			id:               String(r.id),
			formAsset:        String(r.form_asset),
			formProceeds:     r.form_proceeds_usd != null ? Number(r.form_proceeds_usd) : null,
			formCostBasis:    r.form_cost_basis   != null ? Number(r.form_cost_basis)   : null,
			formAcquiredAt:   r.form_acquired_at  ? String(r.form_acquired_at)          : null,
			formDisposedAt:   r.form_disposed_at  ? String(r.form_disposed_at)          : null,
			computedProceeds: r.computed_proceeds != null ? Number(r.computed_proceeds) : null,
			computedBasis:    r.computed_basis    != null ? Number(r.computed_basis)    : null,
			computedGain:     r.computed_gain     != null ? Number(r.computed_gain)     : null,
			matchStatus:      String(r.match_status),
			deltaProceeds:    r.delta_proceeds    != null ? Number(r.delta_proceeds)    : null,
			deltaBasis:       r.delta_basis       != null ? Number(r.delta_basis)       : null,
			notes:            r.notes ? String(r.notes) : null,
		}));

		const uploadRow = upload.rows[0] as DbRow;
		return json({
			ok: true,
			upload: {
				id:           String(uploadRow.id),
				formType:     String(uploadRow.form_type),
				exchangeName: uploadRow.exchange_name ? String(uploadRow.exchange_name) : null,
				taxYear:      Number(uploadRow.tax_year),
				filename:     String(uploadRow.filename),
				rowCount:     uploadRow.row_count != null ? Number(uploadRow.row_count) : null,
				createdAt:    String(uploadRow.created_at),
			},
			reconciliation,
		});
	} catch (err) {
		console.error('[1099/reconciliation] error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
