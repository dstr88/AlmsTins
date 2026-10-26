/**
 * GET /api/cron/sync-btc
 *
 * Called weekly by GitHub Actions (.github/workflows/sync-btc.yml, Monday 04:00 UTC).
 * Re-syncs transactions and balance snapshots for every Bitcoin and Litecoin
 * wallet across all tenants.
 * Skips wallets whose snapshot is less than 6 days old.
 *
 * Protected by CRON_SECRET header — never exposes user sessions.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { syncUtxoAddress, utxoChainOf, UTXO_WALLET_SQL } from '@/lib/sync/syncBtcAddress';
import { json } from '@/lib/http';

export const prerender = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GET: APIRoute = async ({ request }) => {
	const secret = import.meta.env.CRON_SECRET;
	const provided = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
	if (!secret || provided !== secret) {
		console.warn('[cron/sync-btc] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401, { pretty: true });
	}

	const startedAt = Date.now();
	console.log('[cron/sync-btc] Starting weekly BTC sync');

	const walletsResult = await db.execute(
		`SELECT id, tenant_id, address, label, chains
		 FROM wallets
		 WHERE wallet_type = 'onchain'
		   AND ${UTXO_WALLET_SQL}
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
		const chain = utxoChainOf(row.chains, address);
		if (!chain) continue;

		// BTC doesn't use wallet_sync_state — check wallet_snapshots instead
		const lastSnapResult = await db.execute({
			sql: `SELECT MAX(captured_at) AS last_snap FROM wallet_snapshots
			      WHERE wallet_id = ? AND tenant_id = ? AND chain = ?`,
			args: [walletId, tenantId, chain],
		});
		const lastSnap = (lastSnapResult.rows[0] as Record<string, unknown>)?.last_snap as string | null;
		if (lastSnap && lastSnap > staleThreshold) {
			console.log(`[cron/sync-btc] Skipping ${label} — synced ${lastSnap}`);
			results.push({ walletId, label, status: 'skipped' });
			continue;
		}

		try {
			console.log(`[cron/sync-btc] Syncing ${label} (tenant: ${tenantId})`);
			// The stored address as is: lowercasing a legacy 1…/3… address makes a different one.
			const result = await syncUtxoAddress(tenantId, chain, address, walletId);
			console.log(`[cron/sync-btc] ${label} done — inserted: ${result.inserted}, txCount: ${result.txCount}`);
			if (!result.snapshotWritten) throw new Error(`${chain} balance unavailable`);
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

	return json({ ok: true, elapsed_ms: elapsed, total: wallets.length, synced, skipped, failed, results }, 200, { pretty: true });
};
