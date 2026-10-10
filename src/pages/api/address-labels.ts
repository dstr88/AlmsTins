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
		sql: `SELECT id, address, label, source, category, chain, notes, phone_number, created_at
		      FROM address_labels
		      WHERE tenant_id = ?
		      ORDER BY created_at DESC`,
		args: [tenantId],
	});

	return json(result.rows);
};

// POST /api/address-labels  — create a user label (private to this account)
export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json();
	const address  = typeof body.address  === 'string' ? body.address.replace(/\s+/g, '').toLowerCase() : '';
	const label    = typeof body.label    === 'string' ? body.label.trim() : '';
	const category    = typeof body.category    === 'string' ? body.category.trim()    : 'counterparty';
	const chain       = typeof body.chain       === 'string' ? body.chain.trim()       : null;
	const notes       = typeof body.notes       === 'string' ? body.notes.trim()       : null;
	const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : null;

	if (!address) return json({ error: true, message: 'Address is required' }, 400);
	if (!label)   return json({ error: true, message: 'Label is required' }, 400);

	const id = crypto.randomUUID();

	// Normalise phone to null so COALESCE(phone_number, '') comparison is consistent
	const phone = phoneNumber || null;

	try {
		// Unique key is (tenant_id, address, COALESCE(phone_number, ''))
		// — same address + same phone = update; same address + different phone = new row
		const existing = await db.execute({
			sql: `SELECT id FROM address_labels
			      WHERE tenant_id = ? AND address = ? AND COALESCE(phone_number, '') = ?
			      LIMIT 1`,
			args: [tenantId, address, phone ?? ''],
		});

		if (existing.rows.length > 0) {
			await db.execute({
				sql: `UPDATE address_labels
				      SET label = ?, source = 'user', category = ?, chain = ?, notes = ?, phone_number = ?,
				          updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
				      WHERE tenant_id = ? AND address = ? AND COALESCE(phone_number, '') = ?`,
				args: [label, category, chain, notes, phone, tenantId, address, phone ?? ''],
			});
		} else {
			await db.execute({
				sql: `INSERT INTO address_labels (id, tenant_id, address, label, source, category, chain, notes, phone_number)
				      VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?)`,
				args: [id, tenantId, address, label, category, chain, notes, phone],
			});
		}

		// A label stays in this account. It used to count as a cross-account vote that
		// promoted matching labels to every user; that built an address-to-name list out of
		// private labels, so it was removed (privacy policy v1.2, 2026-10-10).
		// src/scripts/removeSharedLabelVotes.mjs deletes the old votes and shared labels.

		const row = await db.execute({
			sql: `SELECT id, address, label, source, category, chain, notes, phone_number, created_at FROM address_labels
			      WHERE tenant_id = ? AND address = ? AND COALESCE(phone_number, '') = ? LIMIT 1`,
			args: [tenantId, address, phone ?? ''],
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
