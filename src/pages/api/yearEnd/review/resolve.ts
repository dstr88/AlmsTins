// POST /api/yearEnd/review/resolve
// Saves a user's manual classification decision for a review item.
// The item is marked resolved and a manual tax_classification is upserted.

import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { getLang } from '@/lib/i18n/locale';
import { getYearEndErrors } from '@/i18n/apiErrors/yearEnd';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;

		const t = getYearEndErrors(getLang(request));

		const body = await request.json();

		const {
			reviewItemId,
			sourceType,
			sourceId,
			category,
			notes,
			pricePerToken,
			buyDateIso,
		} = body as {
			reviewItemId: string;
			sourceType: 'import' | 'onchain';
			sourceId: string;
			category: string;
			notes?: string;
			pricePerToken?: number;
			buyDateIso?: string;
		};

		if (!reviewItemId || !sourceType || !sourceId || !category) {
			return respond({ ok: false, error: t.missingRequiredFields }, 400);
		}

		// Verify the review item belongs to this tenant
		const itemResult = await db.execute({
			sql: `SELECT id FROM tax_review_items WHERE id = ? AND tenant_id = ? LIMIT 1`,
			args: [reviewItemId, tenantId],
		});
		if (!itemResult.rows.length) {
			return respond({ ok: false, error: t.reviewItemNotFound }, 404);
		}

		const now = new Date().toISOString();

		// Upsert manual classification — preserved across pipeline re-runs
		await db.execute({
			sql: `INSERT INTO tax_classifications
			      (id, tenant_id, source_type, source_id, category, notes, is_manual,
			       created_at, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
			      ON CONFLICT (tenant_id, source_type, source_id)
			      DO UPDATE SET
			        category   = excluded.category,
			        notes      = COALESCE(excluded.notes, tax_classifications.notes),
			        is_manual  = 1,
			        updated_at = excluded.updated_at`,
			args: [randomUUID(), tenantId, sourceType, sourceId, category, notes ?? null, now, now],
		});

		// If user supplied a price, save it to manual_cost_basis
		if (pricePerToken && pricePerToken > 0) {
			await db.execute({
				sql: `INSERT INTO manual_cost_basis (id, tenant_id, sell_source_id, quantity, price_per_token, buy_date_iso, created_at, updated_at)
				      VALUES (?, ?, ?, 0, ?, ?, ?, ?)
				      ON CONFLICT (tenant_id, sell_source_id)
				      DO UPDATE SET
				        price_per_token = excluded.price_per_token,
				        buy_date_iso    = COALESCE(excluded.buy_date_iso, manual_cost_basis.buy_date_iso),
				        updated_at      = excluded.updated_at`,
				args: [randomUUID(), tenantId, sourceId, pricePerToken, buyDateIso ?? null, now, now],
			});
		}

		// Update notes on the review item if provided
		if (notes) {
			await db.execute({
				sql: `UPDATE tax_review_items SET notes = ?, updated_at = ? WHERE id = ?`,
				args: [notes, now, reviewItemId],
			});
		}

		// Mark resolved
		await db.execute({
			sql: `UPDATE tax_review_items
			      SET resolved = 1, resolved_at = ?, resolved_category = ?, updated_at = ?
			      WHERE id = ?`,
			args: [now, category, now, reviewItemId],
		});

		return respond({ ok: true }, 200);
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('[tax/review/resolve]', error);
		const t = getYearEndErrors(getLang(request));
		return respond({ ok: false, error: t.failedToSave }, 500);
	}
};

function respond(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
