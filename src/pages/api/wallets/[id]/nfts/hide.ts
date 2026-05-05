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

	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;
	try {
		await requireWalletOwnedByTenant(walletId, tenantId);
	} catch (err) {
		if (err instanceof Response) return err;
		throw err;
	}
	const payload = (await request.json().catch(() => null)) as {
		chainId?: number;
		contract?: string;
		tokenId?: string;
	} | null;
	const chainId = Number(payload?.chainId ?? 0);
	const contract = String(payload?.contract ?? '').trim().toLowerCase();
	const tokenId = String(payload?.tokenId ?? '').trim();

	if (!chainId || !contract || !tokenId) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing NFT identifiers' }), { status: 400 });
	}

	await db.execute({
		sql: `INSERT INTO nft_hidden (tenant_id, wallet_id, chain_id, contract_address, token_id)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(tenant_id, wallet_id, chain_id, contract_address, token_id) DO NOTHING`,
		args: [tenantId, walletId, chainId, contract, tokenId],
	});

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
