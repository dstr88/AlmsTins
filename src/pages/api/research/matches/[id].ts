import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

/**
 * PATCH /api/research/matches/:id
 * Body: { action: 'confirm' | 'reject' }
 *
 * confirm → status = 'confirmed', confirmed_at = now
 * reject  → status = 'rejected'  (both transactions go back to unmatched pool)
 */
export const PATCH: APIRoute = async ({ request, params }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const matchId = params.id ?? '';
	if (!matchId) return new Response('Missing match id', { status: 400 });

	let action: string;
	try {
		const body = await request.json();
		action = body?.action ?? '';
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	if (action !== 'confirm' && action !== 'reject') {
		return new Response('action must be "confirm" or "reject"', { status: 400 });
	}

	// Verify the match belongs to this tenant
	const existing = await db.execute({
		sql: `SELECT id FROM transfer_matches WHERE id = ? AND tenant_id = ? LIMIT 1`,
		args: [matchId, tenantId],
	});
	if (!existing.rows.length) {
		return new Response('Not found', { status: 404 });
	}

	if (action === 'confirm') {
		await db.execute({
			sql: `UPDATE transfer_matches
			      SET status = 'confirmed', confirmed_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
			      WHERE id = ? AND tenant_id = ?`,
			args: [matchId, tenantId],
		});
	} else {
		await db.execute({
			sql: `UPDATE transfer_matches SET status = 'rejected' WHERE id = ? AND tenant_id = ?`,
			args: [matchId, tenantId],
		});
	}

	return new Response(JSON.stringify({ ok: true, action }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
