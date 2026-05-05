/**
 * DELETE /api/exchange-accounts/:id
 *
 * Removes a stale or incorrect exchange account and all its associated
 * imported rows. Requires the account to belong to the current tenant.
 */
import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const prerender = false;

export const DELETE: APIRoute = async ({ params, request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const accountId = params.id;

		if (!accountId) {
			return json({ error: 'Missing account id.' }, 400);
		}

		// Verify ownership before touching anything
		const ownerCheck = await db.execute({
			sql: `SELECT id FROM exchange_accounts WHERE id = ? AND tenant_id = ? LIMIT 1`,
			args: [accountId, tenantId],
		});

		if (!ownerCheck.rows.length) {
			return json({ error: 'Account not found.' }, 404);
		}

		// Count how many imported rows will be removed (for the response)
		const countRes = await db.execute({
			sql: `SELECT COUNT(*) AS cnt FROM import_transactions WHERE account_id = ? AND tenant_id = ?`,
			args: [accountId, tenantId],
		});
		const txCount = Number((countRes.rows[0] as Record<string, unknown>)?.cnt ?? 0);

		// Delete in dependency order: raw rows → normalised transactions → account
		await db.batch([
			{
				sql: `DELETE FROM import_raw_rows WHERE account_id = ? AND tenant_id = ?`,
				args: [accountId, tenantId],
			},
			{
				sql: `DELETE FROM import_transactions WHERE account_id = ? AND tenant_id = ?`,
				args: [accountId, tenantId],
			},
			{
				sql: `DELETE FROM exchange_accounts WHERE id = ? AND tenant_id = ?`,
				args: [accountId, tenantId],
			},
		], 'write');

		return json({ ok: true, deletedTxCount: txCount });
	} catch (err) {
		console.error('[exchange-accounts/delete]', err);
		return json({ error: 'Delete failed.' }, 500);
	}
};

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
