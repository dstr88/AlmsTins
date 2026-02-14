import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';

export const POST: APIRoute = async ({ params, request }) => {
	const walletId = params.id;
	if (!walletId) {
		return new Response(JSON.stringify({ error: true, message: 'Wallet id is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const { tenantId } = await requireTenantSession(request);
	try {
		await requireWalletOwnedByTenant(walletId, tenantId);
	} catch (err) {
		if (err instanceof Response) return err;
		throw err;
	}
	await db.execute({
		sql: 'DELETE FROM nft_hidden WHERE tenant_id = ? AND wallet_id = ?',
		args: [tenantId, walletId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
