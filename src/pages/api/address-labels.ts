import type { APIRoute } from 'astro';
import { db } from '../../lib/db';
import { requireTenantSession } from '../../lib/requireTenantSession';
import { canonicalAddress } from '../../lib/wallets-service';
import { normalizeLabelCategory } from '../../lib/addressLabelCategory';
import { json } from '@/lib/http';

export const prerender = false;

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
	// EVM and bech32 lowercased; base58 (Bitcoin 1…/3…, Solana) kept exact, since lowercasing it
	// makes a different address that no wallet or transaction will ever match.
	const address  = typeof body.address  === 'string' ? canonicalAddress(body.address.replace(/\s+/g, '')) : '';
	const label    = typeof body.label    === 'string' ? body.label.trim() : '';
	const category    = normalizeLabelCategory(body.category);
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
		// — same address + same phone = update; same address + different phone = new row.
		// Matched case-insensitively so a label saved lowercased before base58 kept its case is
		// updated (and its address corrected) rather than duplicated.
		const existing = await db.execute({
			sql: `SELECT id FROM address_labels
			      WHERE tenant_id = ? AND lower(address) = lower(?) AND COALESCE(phone_number, '') = ?
			      ORDER BY CASE WHEN address = ? THEN 0 ELSE 1 END
			      LIMIT 1`,
			args: [tenantId, address, phone ?? '', address],
		});

		if (existing.rows.length > 0) {
			await db.execute({
				sql: `UPDATE address_labels
				      SET address = ?, label = ?, source = 'user', category = ?, chain = ?, notes = ?, phone_number = ?,
				          updated_at = to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
				      WHERE id = ? AND tenant_id = ?`,
				args: [address, label, category, chain, notes, phone, String(existing.rows[0].id), tenantId],
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
