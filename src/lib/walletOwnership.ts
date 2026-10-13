import { db } from '@/lib/db';

export async function requireWalletOwnedByTenant(walletId: string, tenantId: string): Promise<void> {
	if (!walletId) {
		throw new Response(JSON.stringify({ error: true, message: 'Wallet id is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const walletCheck = await db.execute({
		sql: 'SELECT 1 FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
		args: [walletId, tenantId],
	});

	if (!walletCheck.rows?.length) {
		throw new Response(JSON.stringify({ error: true, message: 'Wallet not found.' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
