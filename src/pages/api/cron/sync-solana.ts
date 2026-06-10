/**
 * GET /api/cron/sync-solana
 *
 * Called weekly by Render Cron (staggered 1 hour after sync-btc).
 * Re-syncs Solana transactions for every Solana wallet across all tenants.
 * Skips wallets synced within the last 6 days. Requires SOLANA_RPC_URL.
 *
 * Protected by CRON_SECRET header — never exposes user sessions.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { syncSolanaAddress } from '@/lib/sync/syncSolanaTransactions';
import type { Wallet } from '@/lib/wallets';

export const prerender = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GET: APIRoute = async ({ request }) => {
	const secret = import.meta.env.CRON_SECRET;
	const provided = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
	if (!secret || provided !== secret) {
		console.warn('[cron/sync-solana] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401);
	}

	const startedAt = Date.now();
	console.log('[cron/sync-solana] Starting weekly Solana sync');

	const walletsResult = await db.execute(
		`SELECT id, tenant_id, address, label, chains
		 FROM wallets
		 WHERE wallet_type = 'onchain' AND chains LIKE '%solana%'
		 ORDER BY tenant_id, created_at ASC`,
	);
	const wallets = walletsResult.rows as Array<Record<string, unknown>>;
	console.log(`[cron/sync-solana] Found ${wallets.length} Solana wallets`);

	const staleThreshold = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

	const results: Array<{ walletId: string; label: string; status: 'synced' | 'skipped' | 'failed'; inserted?: number; error?: string }> = [];

	for (const row of wallets) {
		const walletId = String(row.id ?? '');
		const tenantId = String(row.tenant_id ?? '');
		const address = String(row.address ?? '');
		const label = String(row.label ?? address.slice(-8));

		// Solana stores cursor + last_run_at in wallet_sync_state.
		const lastRunResult = await db.execute({
			sql: `SELECT last_run_at FROM wallet_sync_state WHERE wallet_id = ? AND tenant_id = ? AND chain = 'solana'`,
			args: [walletId, tenantId],
		});
		const lastRun = (lastRunResult.rows[0] as Record<string, unknown>)?.last_run_at as string | null;
		if (lastRun && lastRun > staleThreshold) {
			results.push({ walletId, label, status: 'skipped' });
			continue;
		}

		try {
			const wallet = { id: walletId, address, chains: ['solana'] } as unknown as Wallet;
			const result = await syncSolanaAddress(tenantId, wallet);
			console.log(`[cron/sync-solana] ${label} done — inserted: ${result.inserted}, txCount: ${result.txCount}`);
			results.push({ walletId, label, status: 'synced', inserted: result.inserted });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[cron/sync-solana] Failed ${label}:`, message);
			results.push({ walletId, label, status: 'failed', error: message });
		}

		await sleep(2_000);
	}

	const elapsed = Date.now() - startedAt;
	const synced = results.filter((r) => r.status === 'synced').length;
	const skipped = results.filter((r) => r.status === 'skipped').length;
	const failed = results.filter((r) => r.status === 'failed').length;

	console.log(`[cron/sync-solana] Done in ${elapsed}ms — synced: ${synced}, skipped: ${skipped}, failed: ${failed}`);

	return json({ ok: true, elapsed_ms: elapsed, total: wallets.length, synced, skipped, failed, results }, 200);
};

function json(body: unknown, status: number) {
	return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
