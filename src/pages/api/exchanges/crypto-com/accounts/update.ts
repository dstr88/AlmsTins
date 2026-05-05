import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

type Payload = {
	accountId?: string;
	name?: string;
};

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	const payload = (await request.json().catch(() => ({}))) as Payload;
	const accountId = payload.accountId?.trim() ?? '';
	const name = payload.name?.trim() ?? '';

	if (!accountId || !name) {
		return new Response(JSON.stringify({ error: 'Missing accountId or name.' }), { status: 400 });
	}

	const result = await db.execute({
		sql: `UPDATE exchange_accounts
			SET name = ?
			WHERE id = ? AND tenant_id = ? AND source = 'crypto_com'`,
		args: [name, accountId, tenantId],
	});

	if ((result.rowsAffected ?? 0) === 0) {
		return new Response(JSON.stringify({ error: 'Account not found.' }), { status: 404 });
	}

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
