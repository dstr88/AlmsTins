import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const body = await request.json().catch(() => ({}));
	const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
	const name = typeof body.name === 'string' ? body.name.trim() : '';

	if (!accountId || !name) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing accountId or name.' }), { status: 400 });
	}

	await db.execute({
		sql: `UPDATE exchange_accounts
			SET name = ?
			WHERE id = ? AND tenant_id = ? AND source = 'exodus'`,
		args: [name, accountId, tenantId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
