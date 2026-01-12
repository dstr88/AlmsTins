import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { computeWalletValue } from '@/lib/sync/syncWalletValue';
import { safeParseChains } from '@/lib/wallets-service';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
	const walletId = params.id ?? '';
	console.log('[debug.wallet-value] START', { walletId });

	if (!walletId) {
		return new Response(JSON.stringify({ ok: false, error: 'Missing wallet id' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const result = await db.execute({
			sql: 'SELECT id, address, label, chains FROM wallets WHERE id = ? LIMIT 1',
			args: [walletId],
		});

		const row = result.rows[0] as Record<string, any> | undefined;
		if (!row) {
			return new Response(JSON.stringify({ ok: false, error: 'Wallet not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const wallet = {
			id: row.id,
			address: row.address,
			label: row.label ?? null,
			chains: safeParseChains(row.chains),
		};

		console.log('[debug.wallet-value] wallet', wallet);

		const breakdown = await computeWalletValue(wallet.id, wallet.address, wallet.chains as any);

		console.log('[debug.wallet-value] RESULT', {
			walletId,
			chainCount: breakdown.length,
			chains: breakdown.map((b) => b.chain),
		});

		return new Response(
			JSON.stringify({
				ok: true,
				walletId,
				breakdown,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err: any) {
		console.error('[debug.wallet-value] ERROR', { walletId, err });
		return new Response(
			JSON.stringify({
				ok: false,
				error: err?.message ?? 'Failed to compute wallet value',
				message: err?.message ?? String(err),
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
};
