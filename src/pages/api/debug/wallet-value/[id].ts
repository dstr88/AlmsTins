import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { computeWalletValue } from '@/lib/sync/syncWalletValue';
import { safeParseChains } from '@/lib/wallets-service';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { DEFAULT_ERC20_CHAINS, type SupportedChain } from '@/lib/constants';

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
	const walletId = params.id ?? '';
	console.log('[debug.wallet-value] START', { walletId });

	if (!walletId) {
		return new Response(JSON.stringify({ error: true, message: 'Wallet id is required.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		await requireWalletOwnedByTenant(walletId, tenantId);
		const result = await db.execute({
			sql: 'SELECT id, address, label, chains FROM wallets WHERE id = ? AND tenant_id = ? LIMIT 1',
			args: [walletId, tenantId],
		});

		const row = result.rows[0] as Record<string, any> | undefined;
		if (!row) {
			return new Response(JSON.stringify({ error: true, message: 'Wallet not found.' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const wallet = {
			id: row.id,
			address: row.address,
			label: row.label ?? null,
			chains: safeParseChains(row.chains).filter(
				(chain): chain is (typeof DEFAULT_ERC20_CHAINS)[number] => DEFAULT_ERC20_CHAINS.includes(chain as (typeof DEFAULT_ERC20_CHAINS)[number]),
			),
		};

		console.log('[debug.wallet-value] wallet', wallet);

		const breakdown = await computeWalletValue(tenantId, wallet.id, wallet.address, wallet.chains);

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
		if (err instanceof Response) return err;
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
