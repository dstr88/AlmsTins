import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';

// "Reset all" — clears both the blacklist (nft_hidden) and whitelist (nft_whitelist)
// so that purchase detection runs fresh on the next snapshot build.
export const POST: APIRoute = async ({ params, request }) => {
	const walletId = params.id;
	if (!walletId) {
		return new Response(JSON.stringify({ error: true, message: 'Wallet id is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	try {
		await requireWalletOwnedByTenant(walletId, tenantId);
	} catch (err) {
		if (err instanceof Response) return err;
		throw err;
	}

	await Promise.all([
		db.execute({
			sql: 'DELETE FROM nft_hidden WHERE tenant_id = ? AND wallet_id = ?',
			args: [tenantId, walletId],
		}),
		db.execute({
			sql: 'DELETE FROM nft_whitelist WHERE tenant_id = ? AND wallet_id = ?',
			args: [tenantId, walletId],
		}).catch(() => null), // graceful if whitelist table not yet migrated
	]);

	// Invalidate snapshot
	await db.execute({
		sql: 'DELETE FROM wallet_nft_snapshot WHERE tenant_id = ? AND wallet_id = ? AND chain_id = 0',
		args: [tenantId, walletId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
