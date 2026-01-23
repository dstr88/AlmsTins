import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const POST: APIRoute = async ({ params, request }) => {
	const walletId = params.id;
	if (!walletId) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing wallet id' }), { status: 400 });
	}

	const { tenantId } = await requireTenantSession(request);
	await db.execute({
		sql: 'DELETE FROM nft_hidden WHERE tenant_id = ? AND wallet_id = ?',
		args: [tenantId, walletId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
