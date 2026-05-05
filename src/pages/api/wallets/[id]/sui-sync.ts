import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { getAllActiveWallets } from '@/lib/wallets';
import { syncSuiTransactions } from '@/lib/sync/syncSuiTransactions';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const walletId = params.id ?? '';
		if (!walletId) return respond({ error: true, message: 'Wallet id required.' }, 400);

		await requireWalletOwnedByTenant(walletId, tenantId);

		const wallets = await getAllActiveWallets(tenantId);
		const wallet = wallets.find((w) => w.id === walletId);
		if (!wallet) return respond({ error: true, message: 'Wallet not found.' }, 404);

		if (!wallet.chains.includes('sui')) {
			return respond({ error: true, message: 'Wallet does not have sui chain configured.' }, 400);
		}

		const { inserted, skipped } = await syncSuiTransactions(tenantId, wallet);
		return respond({ ok: true, walletId, inserted, skipped }, 200);
	} catch (err) {
		if (err instanceof Response) return err;
		console.error('[sui-sync] error', err);
		return respond({ error: true, message: 'Sui sync failed.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
