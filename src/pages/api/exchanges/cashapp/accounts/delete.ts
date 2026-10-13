import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { removeAccountIdentity } from '@/lib/walletOwnerLabel';

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
		sql: `SELECT id FROM exchange_accounts WHERE id = ? AND tenant_id = ? AND source = 'cashapp'`,
		args: [accountId, tenantId],
	});
	if (!check.rows?.length) {
		return new Response(JSON.stringify({ error: 'Account not found.' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}

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
	// Its owner label goes with it (this tenant's row for this account only).
	await removeAccountIdentity(tenantId, 'cashapp', accountId).catch((err) =>
		console.error('[accounts/delete] wallet identity', err instanceof Error ? err.message : String(err)),
	);

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
