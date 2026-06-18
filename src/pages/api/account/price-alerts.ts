/**
 * GET  /api/account/price-alerts          — list all price alerts for current user
 * POST /api/account/price-alerts          — create / update a price alert
 * DELETE /api/account/price-alerts?id=xx  — delete a price alert
 */

import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';
import { getLang } from '@/lib/i18n/locale';
import { getAccountErrors } from '@/i18n/apiErrors/account';

export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

// ── GET ───────────────────────────────────────────────────────────────────────
export const GET: APIRoute = async ({ request }) => {
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

	try {
		const result = await db.execute({
			sql: `SELECT id, asset_symbol, direction, threshold, enabled, last_alerted_at, created_at
			      FROM price_alert_preferences
			      WHERE user_id = ?
			      ORDER BY asset_symbol, direction`,
			args: [session.user.id],
		});

		type DbRow = Record<string, unknown>;
		const alerts = (result.rows as DbRow[]).map((r) => ({
			id:           String(r.id),
			assetSymbol:  String(r.asset_symbol),
			direction:    String(r.direction),
			threshold:    Number(r.threshold),
			enabled:      Boolean(r.enabled),
			lastAlertedAt: r.last_alerted_at ? String(r.last_alerted_at) : null,
			createdAt:    String(r.created_at),
		}));

		return json({ ok: true, alerts });
	} catch (err) {
		console.error('[price-alerts] GET error', err);
		return json({ ok: false, error: 'Database error' }, 500);
	}
};

// ── POST ──────────────────────────────────────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
	const t = getAccountErrors(getLang(request));
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

	let tenantId: string;
	try {
		const t = await requireTenantSession(request);
		if (!t) return json({ ok: false, error: 'Unauthorized' }, 401);
		tenantId = t.tenantId;
	} catch {
		return json({ ok: false, error: 'Unauthorized' }, 401);
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Invalid JSON' }, 400);
	}

	const id          = typeof body.id === 'string' ? body.id : null;
	const assetSymbol = typeof body.assetSymbol === 'string' ? body.assetSymbol.toUpperCase().trim() : '';
	const direction   = body.direction === 'below' ? 'below' : 'above';
	const threshold   = Number(body.threshold);
	const enabled     = body.enabled !== false;

	if (!assetSymbol) return json({ ok: false, error: t.assetSymbolRequired }, 400);
	if (!Number.isFinite(threshold) || threshold <= 0) return json({ ok: false, error: t.thresholdPositive }, 400);

	try {
		if (id) {
			// Update existing (verify ownership)
			await db.execute({
				sql: `UPDATE price_alert_preferences
				      SET asset_symbol = ?, direction = ?, threshold = ?, enabled = ?, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
				      WHERE id = ? AND user_id = ?`,
				args: [assetSymbol, direction, threshold, enabled ? 1 : 0, id, session.user.id],
			});
			return json({ ok: true, id });
		} else {
			// Check for existing alert for same symbol+direction (upsert)
			const existing = await db.execute({
				sql: `SELECT id FROM price_alert_preferences WHERE user_id = ? AND asset_symbol = ? AND direction = ? LIMIT 1`,
				args: [session.user.id, assetSymbol, direction],
			});
			const existingRow = existing.rows[0] as Record<string, unknown> | undefined;
			if (existingRow) {
				const existingId = String(existingRow.id);
				await db.execute({
					sql: `UPDATE price_alert_preferences
					      SET threshold = ?, enabled = ?, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
					      WHERE id = ?`,
					args: [threshold, enabled ? 1 : 0, existingId],
				});
				return json({ ok: true, id: existingId });
			}

			// Create new
			const newId = randomUUID();
			await db.execute({
				sql: `INSERT INTO price_alert_preferences (id, user_id, tenant_id, asset_symbol, direction, threshold, enabled)
				      VALUES (?, ?, ?, ?, ?, ?, ?)`,
				args: [newId, session.user.id, tenantId, assetSymbol, direction, threshold, enabled ? 1 : 0],
			});
			return json({ ok: true, id: newId });
		}
	} catch (err) {
		console.error('[price-alerts] POST error', err);
		return json({ ok: false, error: 'Database error' }, 500);
	}
};

// ── DELETE ────────────────────────────────────────────────────────────────────
export const DELETE: APIRoute = async ({ request }) => {
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

	const url = new URL(request.url);
	const id = url.searchParams.get('id');
	if (!id) return json({ ok: false, error: 'id required' }, 400);

	try {
		await db.execute({
			sql: `DELETE FROM price_alert_preferences WHERE id = ? AND user_id = ?`,
			args: [id, session.user.id],
		});
		return json({ ok: true });
	} catch (err) {
		console.error('[price-alerts] DELETE error', err);
		return json({ ok: false, error: 'Database error' }, 500);
	}
};
