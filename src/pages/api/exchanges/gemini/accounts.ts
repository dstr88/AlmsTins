import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const countResult = await db.execute({
		sql: `SELECT COUNT(*) AS count FROM exchange_accounts
			WHERE tenant_id = ? AND source = 'gemini'`,
		args: [tenantId],
	});
	const count = Number(countResult.rows?.[0]?.count ?? 0);
	const name = `Account #${count + 1}`;
	const accountId = randomUUID();

	await db.execute({
		sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name)
			VALUES (?, ?, 'gemini', ?)`,
		args: [accountId, tenantId, name],
	});

	return new Response(JSON.stringify({ ok: true, accountId, name }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
