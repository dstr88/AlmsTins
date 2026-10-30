/**
 * GET /api/cron/sync-xpr
 *
 * Called weekly by GitHub Actions (.github/workflows/sync-xpr.yml, Monday 06:00 UTC).
 * Re-syncs the balance snapshot and the transfer history of every XPR Network wallet across all
 * tenants. Skips wallets whose snapshot is less than 6 days old.
 *
 * Protected by CRON_SECRET header — never exposes user sessions.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { syncXprAddress, XPR_WALLET_SQL } from '@/lib/sync/syncXprAddress';
import { json } from '@/lib/http';

export const prerender = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const GET: APIRoute = async ({ request }) => {
	const secret = import.meta.env.CRON_SECRET;
	const provided = request.headers.get('x-cron-secret') ?? new URL(request.url).searchParams.get('secret');
	if (!secret || provided !== secret) {
		console.warn('[cron/sync-xpr] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401, { pretty: true });
	}

	const startedAt = Date.now();
	console.log('[cron/sync-xpr] Starting weekly XPR sync');

	const walletsResult = await db.execute(
		`SELECT id, tenant_id, address, label
		 FROM wallets
		 WHERE wallet_type = 'onchain'
		   AND ${XPR_WALLET_SQL}
		 ORDER BY tenant_id, created_at ASC`,
	);
	const wallets = walletsResult.rows as Array<Record<string, unknown>>;
	console.log(`[cron/sync-xpr] Found ${wallets.length} XPR wallets`);

	const staleThreshold = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

	const results: Array<{ walletId: string; status: 'synced' | 'skipped' | 'failed'; inserted?: number; complete?: boolean; error?: string }> = [];

	for (const row of wallets) {
		const walletId = String(row.id ?? '');
		const tenantId = String(row.tenant_id ?? '');
		const address = String(row.address ?? '');

		const lastSnapResult = await db.execute({
			sql: `SELECT MAX(captured_at) AS last_snap FROM wallet_snapshots
			      WHERE wallet_id = ? AND tenant_id = ? AND chain = 'xpr'`,
			args: [walletId, tenantId],
		});
		const lastSnap = (lastSnapResult.rows[0] as Record<string, unknown>)?.last_snap as string | null;
		if (lastSnap && lastSnap > staleThreshold) {
			results.push({ walletId, status: 'skipped' });
			continue;
		}

		try {
			const result = await syncXprAddress(tenantId, address, walletId);
			console.log(`[cron/sync-xpr] wallet done — inserted: ${result.inserted}, txCount: ${result.txCount}, complete: ${result.complete}`);
			if (!result.snapshotWritten) throw new Error('xpr balance unavailable');
			results.push({ walletId, status: 'synced', inserted: result.inserted, complete: result.complete });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error('[cron/sync-xpr] failed for a wallet:', message);
			results.push({ walletId, status: 'failed', error: message });
		}

		await sleep(2_000);
	}

	const elapsed = Date.now() - startedAt;
	const synced = results.filter((r) => r.status === 'synced').length;
	const skipped = results.filter((r) => r.status === 'skipped').length;
	const failed = results.filter((r) => r.status === 'failed').length;

	console.log(`[cron/sync-xpr] Done in ${elapsed}ms — synced: ${synced}, skipped: ${skipped}, failed: ${failed}`);

	return json({ ok: true, elapsed_ms: elapsed, total: wallets.length, synced, skipped, failed, results }, 200, { pretty: true });
};
