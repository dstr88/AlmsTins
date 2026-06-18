import type { APIRoute } from 'astro';
import { getAuthSession } from '@/lib/authSession';
import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';
import { getLang } from '@/lib/i18n/locale';
import { getAccountErrors } from '@/i18n/apiErrors/account';

export const prerender = false;

// GET /api/account/alert-preferences?walletId=xxx
// Returns the alert preference for a specific wallet (or user-level if no walletId).
export const GET: APIRoute = async ({ request }) => {
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

	const url = new URL(request.url);
	const walletId = url.searchParams.get('walletId') ?? null;

	try {
		const result = await db.execute({
			sql: `SELECT id, threshold, direction, enabled, last_alerted_at
			      FROM alert_preferences
			      WHERE user_id = ?
			        AND (wallet_id = ? OR (? IS NULL AND wallet_id IS NULL))
			      LIMIT 1`,
			args: [session.user.id, walletId, walletId],
		});

		const row = result.rows[0] as Record<string, unknown> | undefined;
		return json({
			ok: true,
			preference: row
				? {
						id:            String(row.id),
						threshold:     Number(row.threshold),
						direction:     String(row.direction),
						enabled:       Boolean(row.enabled),
						lastAlertedAt: row.last_alerted_at ? String(row.last_alerted_at) : null,
					}
				: null,
		});
	} catch (err) {
		console.error('[alert-preferences] GET failed', err);
		return json({ ok: false, error: 'Database error' }, 500);
	}
};

// POST /api/account/alert-preferences
// Body: { walletId?, threshold, direction, enabled }
// Upserts the preference row.
export const POST: APIRoute = async ({ request }) => {
	const t = getAccountErrors(getLang(request));
	const session = await getAuthSession(request).catch(() => null);
	if (!session?.user?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ ok: false, error: 'Invalid JSON' }, 400);
	}

	const walletId  = typeof body.walletId  === 'string' ? body.walletId  : null;
	const threshold = typeof body.threshold === 'number'  ? body.threshold : 1.5;
	const direction = body.direction === 'above' ? 'above' : 'below';
	const enabled   = body.enabled === false ? 0 : 1;

	if (threshold <= 0 || threshold > 100) {
		return json({ ok: false, error: t.thresholdRange }, 400);
	}

	try {
		// Check if a row already exists
		const existing = await db.execute({
			sql: `SELECT id FROM alert_preferences
			      WHERE user_id = ?
			        AND (wallet_id = ? OR (? IS NULL AND wallet_id IS NULL))
			      LIMIT 1`,
			args: [session.user.id, walletId, walletId],
		});

		const existingRow = existing.rows[0] as Record<string, unknown> | undefined;

		if (existingRow) {
			await db.execute({
				sql: `UPDATE alert_preferences
				      SET threshold = ?, direction = ?, enabled = ?, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')
				      WHERE id = ?`,
				args: [threshold, direction, enabled, existingRow.id],
			});
		} else {
			await db.execute({
				sql: `INSERT INTO alert_preferences (id, user_id, wallet_id, threshold, direction, enabled)
				      VALUES (?, ?, ?, ?, ?, ?)`,
				args: [randomUUID(), session.user.id, walletId, threshold, direction, enabled],
			});
		}

		return json({ ok: true, threshold, direction, enabled: Boolean(enabled) });
	} catch (err) {
		console.error('[alert-preferences] POST failed', err);
		return json({ ok: false, error: 'Database error' }, 500);
	}
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
