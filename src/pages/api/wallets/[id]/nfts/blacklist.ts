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

	const body = (await request.json().catch(() => null)) as {
		chainId?: number;
		contract?: string;
		tokenId?: string;
	} | null;

	const chainId = Number(body?.chainId ?? 0);
	const contract = String(body?.contract ?? '').trim().toLowerCase();
	const tokenId = String(body?.tokenId ?? '').trim();

	if (!chainId || !contract || !tokenId) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing NFT identifiers' }), { status: 400 });
	}

	// Add to blacklist and remove from whitelist atomically
	await Promise.all([
		db.execute({
			sql: `INSERT INTO nft_hidden (tenant_id, wallet_id, chain_id, contract_address, token_id)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(tenant_id, wallet_id, chain_id, contract_address, token_id) DO NOTHING`,
			args: [tenantId, walletId, chainId, contract, tokenId],
		}),
		db.execute({
			sql: `DELETE FROM nft_whitelist
				WHERE tenant_id = ? AND wallet_id = ? AND chain_id = ? AND contract_address = ? AND token_id = ?`,
			args: [tenantId, walletId, chainId, contract, tokenId],
		}),
	]);

	// Invalidate snapshot so next request rebuilds with updated lists
	await db.execute({
		sql: `DELETE FROM wallet_nft_snapshot WHERE tenant_id = ? AND wallet_id = ? AND chain_id = 0`,
		args: [tenantId, walletId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
