import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

/**
 * PATCH /api/research/annotate/:id
 * Body: { note?: string, category?: string }
 *
 * Writes a user-supplied note and/or disposal category directly onto the
 * import_transaction record. Notes travel with the transaction everywhere
 * it is displayed — bookkeeping, research, exports.
 */
export const PATCH: APIRoute = async ({ request, params }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const txId = params.id;
	if (!txId) return new Response('Missing id', { status: 400 });

	let body: { note?: string; category?: string };
	try {
		body = await request.json();
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	const { note, category } = body;
	if (note === undefined && category === undefined) {
		return new Response('Nothing to update', { status: 400 });
	}

	// Verify the transaction belongs to this tenant
	const check = await db.execute({
		sql: 'SELECT id FROM import_transactions WHERE id = ? AND tenant_id = ?',
		args: [txId, tenantId],
	});
	if (!check.rows.length) {
		return new Response('Not found', { status: 404 });
	}

	// Build update dynamically — only set the fields that were provided
	const setClauses: string[] = [];
	const args: unknown[]      = [];

	if (note !== undefined) {
		setClauses.push('notes = ?');
		args.push(note.trim() || null);
	}
	if (category !== undefined) {
		setClauses.push('category = ?');
		args.push(category.trim() || null);
	}

	args.push(txId, tenantId);

	await db.execute({
		sql: `UPDATE import_transactions SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
		args,
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
