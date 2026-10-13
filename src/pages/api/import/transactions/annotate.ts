import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { getImportTransactionColumns, resolveImportNoteColumn } from '@/lib/importTransactionsSchema';

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	let payload: { id?: string; note?: string; category?: string; group_id?: string } = {};
	try {
		payload = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400 });
	}

	if (!payload.id) {
		return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });
	}

	let importColumns = new Set<string>();
	try {
		importColumns = await getImportTransactionColumns();
	} catch (error) {
		console.error('[import/transactions/annotate] Failed to load import_transactions schema', error);
	}

	const updateParts: string[] = [];
	const args: any[] = [];

	const noteColumn = resolveImportNoteColumn(importColumns);
	if (noteColumn) {
		updateParts.push(`${noteColumn} = COALESCE(?, ${noteColumn})`);
		args.push(payload.note ?? null);
	}
	if (importColumns.has('category')) {
		updateParts.push('category = COALESCE(?, category)');
		args.push(payload.category ?? null);
	}
	if (importColumns.has('group_id')) {
		updateParts.push('group_id = COALESCE(?, group_id)');
		args.push(payload.group_id ?? null);
	}

	if (updateParts.length) {
		args.push(payload.id, tenantId);
		await db.execute({
			sql: `UPDATE import_transactions
				SET ${updateParts.join(', ')}
				WHERE id = ? AND tenant_id = ?`,
			args,
		});
	}

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
