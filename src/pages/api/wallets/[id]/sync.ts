import type { APIRoute } from 'astro';
import { getAllActiveWallets } from '../../../../lib/wallets';
import { syncWalletTransactions } from '@/lib/sync/syncTransactions';
import { syncBtcWallet, isBitcoinWallet } from '@/lib/sync/syncBtcAddress';
import { syncSolanaWallet, isSolanaWallet } from '@/lib/sync/syncSolanaTransactions';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireWalletOwnedByTenant } from '@/lib/walletOwnership';
import { logActivity } from '@/lib/activityLog';
import { DEMO_TENANT_ID, isDemoWalletAddress, DEMO_WALLET_CONFIGS } from '@/lib/demo';
import { db } from '@/lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
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

		// Known demo addresses get mock snapshots instead of real chain calls
		if (tenantId === DEMO_TENANT_ID && isDemoWalletAddress(wallet.address)) {
			const config = DEMO_WALLET_CONFIGS[wallet.address]!;
			const totals = config.tokens.reduce((s, t) => s + t.valueUsd, 0);
			await db.execute({
				sql:  `INSERT INTO wallet_snapshots
				         (tenant_id, wallet_id, chain, totals_usd,
				          collateral_usd, debt_usd, collateral_apy_pct,
				          borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				       VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`,
				args: [tenantId, walletId, config.chain, totals, JSON.stringify(config.tokens)],
			});
			return respond({ ok: true, walletId, totalInserted: 0, totalSkipped: 0, chains: [{ chain: config.chain, inserted: 0, skipped: 0 }] }, 200);
		}

		const isBtc = isBitcoinWallet(wallet.chains, wallet.address);
		const stats = isBtc
			? await syncBtcWallet(tenantId, walletId, wallet.address)
			: isSolanaWallet(wallet.chains)
				? await syncSolanaWallet(tenantId, wallet)
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
