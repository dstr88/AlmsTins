import type { APIRoute } from 'astro';
import { db } from '../../lib/db';
import { requireTenantSession } from '../../lib/requireTenantSession';

export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

// GET  /api/address-labels  — list all user-created labels for this tenant
export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const result = await db.execute({
		sql: `SELECT id, address, label, source, created_at
		      FROM address_labels
		      WHERE tenant_id = ?
		      ORDER BY created_at DESC`,
		args: [tenantId],
	});

	return json(result.rows);
};

// POST /api/address-labels  — create a user label
export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json();
	const address = typeof body.address === 'string' ? body.address.replace(/\s+/g, '').toLowerCase() : '';
	const label   = typeof body.label   === 'string' ? body.label.trim() : '';

	if (!address) return json({ error: true, message: 'Address is required' }, 400);
	if (!label)   return json({ error: true, message: 'Label is required' }, 400);

	const id = crypto.randomUUID();

	try {
		await db.execute({
			sql: `INSERT INTO address_labels (id, tenant_id, address, label, source)
			      VALUES (?, ?, ?, ?, 'user')
			      ON CONFLICT (tenant_id, address)
			      DO UPDATE SET label = excluded.label, source = 'user',
			                    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
			args: [id, tenantId, address, label],
		});

		const row = await db.execute({
			sql: `SELECT id, address, label, source, created_at FROM address_labels
			      WHERE tenant_id = ? AND address = ? LIMIT 1`,
			args: [tenantId, address],
		});

		return json(row.rows[0], 201);
	} catch (e) {
		console.error('Failed to save address label', e);
		return json({ error: true, message: 'Unable to save label' }, 500);
	}
};

// DELETE /api/address-labels?id=…
export const DELETE: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const id = new URL(request.url).searchParams.get('id');
	if (!id) return json({ error: true, message: 'id is required' }, 400);

	await db.execute({
		sql: `DELETE FROM address_labels WHERE id = ? AND tenant_id = ?`,
		args: [id, tenantId],
	});

	return new Response(null, { status: 204 });
};
