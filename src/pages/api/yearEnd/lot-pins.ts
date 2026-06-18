/**
 * /api/yearEnd/lot-pins
 *
 * GET    ?year=2024            — list all pins for a tax year
 * POST                         — upsert a pin (disposal_source_id → lot)
 * DELETE ?disposalSourceId=xx  — remove a pin
 *
 * Used by Specific ID cost basis method.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';

export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

async function auth(request: Request) {
	const sess = await requireTenantSession(request);
	if (!sess) return null;
	const userSess = await getAuthSession(request).catch(() => null);
	return { tenantId: sess.tenantId, userId: userSess?.user?.id ?? sess.tenantId };
}

// ── GET ───────────────────────────────────────────────────────────────────────
export const GET: APIRoute = async ({ request }) => {
	const ctx = await auth(request);
	if (!ctx) return json({ ok: false, error: 'Unauthorized' }, 401);

	const url = new URL(request.url);
	const year = parseInt(url.searchParams.get('year') ?? '0', 10) || new Date().getFullYear() - 1;

	try {
		const result = await db.execute({
			sql: `SELECT id, disposal_source_id, lot_acquired_at, lot_amount_hint, note, created_at
			      FROM tax_lot_pins
			      WHERE tenant_id = ? AND tax_year = ?
			      ORDER BY created_at DESC`,
			args: [ctx.tenantId, year],
		});

		type DbRow = Record<string, unknown>;
		const pins = (result.rows as DbRow[]).map(r => ({
			id:                String(r.id),
			disposalSourceId:  String(r.disposal_source_id),
			lotAcquiredAt:     String(r.lot_acquired_at),
			lotAmountHint:     Number(r.lot_amount_hint),
			note:              r.note ? String(r.note) : null,
			createdAt:         String(r.created_at),
		}));

		return json({ ok: true, pins });
	} catch (err) {
		console.error('[lot-pins] GET error', err);
		return json({ ok: false, error: 'Database error' }, 500);
	}
};

// ── POST ──────────────────────────────────────────────────────────────────────
export const POST: APIRoute = async ({ request }) => {
	const ctx = await auth(request);
	if (!ctx) return json({ ok: false, error: 'Unauthorized' }, 401);

	let body: Record<string, unknown>;
	try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

	const disposalSourceId = typeof body.disposalSourceId === 'string' ? body.disposalSourceId.trim() : '';
	const lotAcquiredAt    = typeof body.lotAcquiredAt    === 'string' ? body.lotAcquiredAt.trim()    : '';
	const lotAmountHint    = Number(body.lotAmountHint ?? 0);
	const taxYear          = parseInt(String(body.taxYear ?? new Date().getFullYear() - 1), 10);
	const note             = typeof body.note === 'string' ? body.note.trim() || null : null;

	if (!disposalSourceId) return json({ ok: false, error: 'disposalSourceId required' }, 400);
	if (!lotAcquiredAt)    return json({ ok: false, error: 'lotAcquiredAt required' }, 400);

	try {
		// Check if pin already exists for this disposal
		const existing = await db.execute({
			sql: `SELECT id FROM tax_lot_pins WHERE tenant_id = ? AND disposal_source_id = ?`,
			args: [ctx.tenantId, disposalSourceId],
		});

		const existingRow = existing.rows[0] as Record<string, unknown> | undefined;

		if (existingRow) {
			await db.execute({
				sql: `UPDATE tax_lot_pins
				      SET lot_acquired_at = ?, lot_amount_hint = ?, note = ?, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
				      WHERE id = ?`,
				args: [lotAcquiredAt, lotAmountHint, note, String(existingRow.id)],
			});
			return json({ ok: true, id: String(existingRow.id) });
		}

		const id = randomUUID();
		await db.execute({
			sql: `INSERT INTO tax_lot_pins (id, tenant_id, user_id, tax_year, disposal_source_id, lot_acquired_at, lot_amount_hint, note)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [id, ctx.tenantId, ctx.userId, taxYear, disposalSourceId, lotAcquiredAt, lotAmountHint, note],
		});
		return json({ ok: true, id });
	} catch (err) {
		console.error('[lot-pins] POST error', err);
		return json({ ok: false, error: 'Database error' }, 500);
	}
};

// ── DELETE ────────────────────────────────────────────────────────────────────
export const DELETE: APIRoute = async ({ request }) => {
	const ctx = await auth(request);
	if (!ctx) return json({ ok: false, error: 'Unauthorized' }, 401);

	const url = new URL(request.url);
	const disposalSourceId = url.searchParams.get('disposalSourceId');
	if (!disposalSourceId) return json({ ok: false, error: 'disposalSourceId required' }, 400);

	try {
		await db.execute({
			sql: `DELETE FROM tax_lot_pins WHERE tenant_id = ? AND disposal_source_id = ?`,
			args: [ctx.tenantId, disposalSourceId],
		});
		return json({ ok: true });
	} catch (err) {
		console.error('[lot-pins] DELETE error', err);
		return json({ ok: false, error: 'Database error' }, 500);
	}
};
