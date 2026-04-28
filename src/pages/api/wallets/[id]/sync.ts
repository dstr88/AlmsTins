import type { APIRoute } from 'astro';
import { getAllActiveWallets } from '../../../../lib/wallets';
import { syncWalletTransactions } from '@/lib/sync/syncTransactions';
import { syncBtcWallet, isBitcoinWallet } from '@/lib/sync/syncBtcAddress';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { logActivity } from '@/lib/activityLog';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
	try {
		const { tenantId } = await requireTenantSession(request);
		const walletId = params.id;
		if (!walletId) {
			return respond({ error: true, message: 'Wallet id is required.' }, 400);
		}

		await requireWalletOwnedByTenant(walletId, tenantId);

		const wallets = await getAllActiveWallets(tenantId);
		const wallet = wallets.find((candidate) => candidate.id === walletId);
		if (!wallet) {
			return respond({ error: true, message: 'Wallet not found.' }, 404);
		}

		const isBtc = isBitcoinWallet(wallet.chains, wallet.address);
		const stats = isBtc
			? await syncBtcWallet(tenantId, walletId, wallet.address)
			: await syncWalletTransactions(tenantId, wallet);
		const primaryChain = Array.isArray(stats.chains) ? (stats.chains[0]?.chain ?? undefined) : undefined;
		logActivity(
			tenantId,
			'sync',
			`${stats.totalInserted} new, ${stats.totalSkipped} skipped`,
			{ walletId, chains: stats.chains, inserted: stats.totalInserted, skipped: stats.totalSkipped },
			{ source: 'wallet_sync', chain: primaryChain },
		);
		return respond(
			{
				ok: true,
				walletId,
				totalInserted: stats.totalInserted,
				totalSkipped: stats.totalSkipped,
				chains: stats.chains,
			},
			200,
		);
	} catch (error) {
		if (error instanceof Response) return error;
		console.error('Wallet sync failed:', error);
		return respond({ error: true, message: 'Failed to sync wallet history.' }, 500);
	}
};

function respond(body: Record<string, unknown>, status: number) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	});
}
