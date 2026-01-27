import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const POST: APIRoute = async ({ request }) => {
	const { tenantId } = await requireTenantSession(request);
	let payload: { id?: string; note?: string; category?: string; group_id?: string } = {};
	try {
		payload = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400 });
	}

	if (!payload.id) {
		return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });
	}

	await db.execute({
		sql: `UPDATE import_transactions
			SET note = COALESCE(?, note),
				category = COALESCE(?, category),
				group_id = COALESCE(?, group_id)
			WHERE id = ? AND tenant_id = ?`,
		args: [payload.note ?? null, payload.category ?? null, payload.group_id ?? null, payload.id, tenantId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
