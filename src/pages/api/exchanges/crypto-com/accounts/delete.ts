import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const body = await request.json().catch(() => ({}));
	const accountId = typeof body?.accountId === 'string' ? body.accountId : '';

	if (!accountId) {
		return new Response(JSON.stringify({ error: 'Missing accountId.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Verify the account belongs to this tenant and source before deleting
	const check = await db.execute({
		sql: `SELECT id FROM exchange_accounts WHERE id = ? AND tenant_id = ? AND source = 'crypto_com'`,
		args: [accountId, tenantId],
	});
	if (!check.rows?.length) {
		return new Response(JSON.stringify({ error: 'Account not found.' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Delete this account's rows
	await db.execute({
		sql: `DELETE FROM import_raw_rows WHERE account_id = ? AND tenant_id = ?`,
		args: [accountId, tenantId],
	});
	await db.execute({
		sql: `DELETE FROM import_transactions WHERE account_id = ? AND tenant_id = ?`,
		args: [accountId, tenantId],
	});
	await db.execute({
		sql: `DELETE FROM exchange_accounts WHERE id = ? AND tenant_id = ?`,
		args: [accountId, tenantId],
	});

	// Sweep ALL orphaned rows for this tenant+source — including rows with NULL account_id
	// (uploaded before account_id tracking was added) and rows whose account_id points to
	// a deleted account. Both block future imports because row_hash is globally unique.
	await db.execute({
		sql: `DELETE FROM import_raw_rows
			WHERE tenant_id = ? AND source = 'crypto_com'
			AND (
				account_id IS NULL
				OR account_id NOT IN (
					SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'crypto_com'
				)
			)`,
		args: [tenantId, tenantId],
	});
	await db.execute({
		sql: `DELETE FROM import_transactions
			WHERE tenant_id = ? AND source = 'crypto_com'
			AND (
				account_id IS NULL
				OR account_id NOT IN (
					SELECT id FROM exchange_accounts WHERE tenant_id = ? AND source = 'crypto_com'
				)
			)`,
		args: [tenantId, tenantId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
