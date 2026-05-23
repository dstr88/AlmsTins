/**
 * GET /api/cron/sync-btc
 *
 * Called weekly by Render Cron (staggered 1 hour after sync-aave).
 * Re-syncs BTC transactions and balance snapshots for every Bitcoin wallet
 * across all tenants. Skips wallets whose snapshot is less than 6 days old.
 *
 * Protected by CRON_SECRET header — never exposes user sessions.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { syncBtcAddress } from '@/lib/sync/syncBtcAddress';

export const prerender = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GET: APIRoute = async ({ request }) => {
	const secret = import.meta.env.CRON_SECRET;
	const provided = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
	if (!secret || provided !== secret) {
		console.warn('[cron/sync-btc] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401);
	}

	const startedAt = Date.now();
	console.log('[cron/sync-btc] Starting weekly BTC sync');

	const walletsResult = await db.execute(
		`SELECT id, tenant_id, address, label
		 FROM wallets
		 WHERE wallet_type = 'onchain'
		   AND (chains LIKE '%bitcoin%'
		     OR address LIKE 'bc1%'
		     OR (length(address) BETWEEN 26 AND 35 AND (address LIKE '1%' OR address LIKE '3%')))
		 ORDER BY tenant_id, created_at ASC`,
	);
	const wallets = walletsResult.rows as Array<Record<string, unknown>>;
	console.log(`[cron/sync-btc] Found ${wallets.length} Bitcoin wallets`);

	const staleThreshold = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

	const results: Array<{
		walletId: string;
		label: string;
		status: 'synced' | 'skipped' | 'failed';
		inserted?: number;
		error?: string;
	}> = [];

	for (const row of wallets) {
		const walletId = String(row.id ?? '');
		const tenantId = String(row.tenant_id ?? '');
		const address = String(row.address ?? '');
		const label = String(row.label ?? address.slice(-8));

		// BTC doesn't use wallet_sync_state — check wallet_snapshots instead
		const lastSnapResult = await db.execute({
			sql: `SELECT MAX(captured_at) AS last_snap FROM wallet_snapshots
			      WHERE wallet_id = ? AND tenant_id = ? AND chain = 'bitcoin'`,
			args: [walletId, tenantId],
		});
		const lastSnap = (lastSnapResult.rows[0] as Record<string, unknown>)?.last_snap as string | null;
		if (lastSnap && lastSnap > staleThreshold) {
			console.log(`[cron/sync-btc] Skipping ${label} — synced ${lastSnap}`);
			results.push({ walletId, label, status: 'skipped' });
			continue;
		}

		try {
			console.log(`[cron/sync-btc] Syncing ${label} (tenant: ${tenantId})`);
			const result = await syncBtcAddress(tenantId, address.toLowerCase());
			console.log(`[cron/sync-btc] ${label} done — inserted: ${result.inserted}, txCount: ${result.txCount}`);
			results.push({ walletId, label, status: 'synced', inserted: result.inserted });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[cron/sync-btc] Failed ${label}:`, message);
			results.push({ walletId, label, status: 'failed', error: message });
		}

		await sleep(2_000);
	}

	const elapsed = Date.now() - startedAt;
	const synced = results.filter((r) => r.status === 'synced').length;
	const skipped = results.filter((r) => r.status === 'skipped').length;
	const failed = results.filter((r) => r.status === 'failed').length;

	console.log(`[cron/sync-btc] Done in ${elapsed}ms — synced: ${synced}, skipped: ${skipped}, failed: ${failed}`);

	return json({ ok: true, elapsed_ms: elapsed, total: wallets.length, synced, skipped, failed, results }, 200);
};

function json(body: unknown, status: number) {
	return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
