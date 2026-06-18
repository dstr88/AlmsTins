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

// POST /api/address-labels  — create a user label
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

		// Cast a community vote (one per user per address)
		await db.execute({
			sql: `INSERT INTO global_address_label_votes (id, tenant_id, address, label)
			      VALUES (?, ?, ?, ?)
			      ON CONFLICT (tenant_id, address)
			      DO UPDATE SET label = excluded.label`,
			args: [crypto.randomUUID(), tenantId, address, label],
		});

		// Count votes per label for this address
		const votes = await db.execute({
			sql: `SELECT label, COUNT(*) as cnt
			      FROM global_address_label_votes
			      WHERE address = ?
			      GROUP BY label
			      ORDER BY cnt DESC
			      LIMIT 1`,
			args: [address],
		});

		if (votes.rows.length) {
			const topLabel = String(votes.rows[0].label);
			const topCount = Number(votes.rows[0].cnt);

			// Check if a global label already exists for this address
			const existing = await db.execute({
				sql: `SELECT label, vote_count FROM global_address_labels WHERE address = ? LIMIT 1`,
				args: [address],
			});

			if (existing.rows.length === 0 && topCount >= 3) {
				// First promotion: 3 independent users agree
				await db.execute({
					sql: `INSERT INTO global_address_labels (address, label, vote_count)
					      VALUES (?, ?, ?)`,
					args: [address, topLabel, topCount],
				});
			} else if (existing.rows.length > 0) {
				const currentLabel = String(existing.rows[0].label);
				// Correction: 5 users agree on a different label
				if (topLabel.toLowerCase() !== currentLabel.toLowerCase() && topCount >= 5) {
					await db.execute({
						sql: `UPDATE global_address_labels
						      SET label = ?, vote_count = ?, updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
						      WHERE address = ?`,
						args: [topLabel, topCount, address],
					});
				} else {
					// Just update the vote count for the current label
					await db.execute({
						sql: `UPDATE global_address_labels SET vote_count = ?
						      WHERE address = ? AND lower(label) = lower(?)`,
						args: [topCount, address, currentLabel],
					});
				}
			}
		}

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
