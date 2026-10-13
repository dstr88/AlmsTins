/**
 * GET /api/cron/sync-wallets
 *
 * Called weekly by Render Cron (or any scheduler).
 * Syncs on-chain transactions for every active onchain wallet
 * across all tenants.
 *
 * Protected by CRON_SECRET header — never exposes user sessions.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { syncWalletTransactions } from '@/lib/sync/syncTransactions';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	// ── Auth ────────────────────────────────────────────────────────────────
	const secret = import.meta.env.CRON_SECRET;
	const provided =
		request.headers.get('x-cron-secret') ??
		new URL(request.url).searchParams.get('secret');

	if (!secret || provided !== secret) {
		console.warn('[cron/sync-wallets] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401);
	}

	const startedAt = Date.now();
	console.log('[cron/sync-wallets] Starting weekly wallet sync');

	// ── Fetch all active onchain wallets across all tenants ─────────────────
	const walletsResult = await db.execute(
		`SELECT id, tenant_id, address, label, chains, is_default, created_at, wallet_type
		 FROM wallets
		 WHERE wallet_type = 'onchain' OR wallet_type IS NULL
		 ORDER BY tenant_id, created_at ASC`,
	);

	const wallets = walletsResult.rows as Array<Record<string, unknown>>;
	console.log(`[cron/sync-wallets] Found ${wallets.length} onchain wallets`);

	// ── Check which wallets are actually stale (last synced > 6 days ago) ──
	const staleThreshold = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

	const results: Array<{
		walletId: string;
		tenantId: string;
		label: string;
		skippedFresh: boolean;
		inserted?: number;
		error?: string;
	}> = [];

	for (const row of wallets) {
		const walletId = String(row.id ?? '');
		const tenantId = String(row.tenant_id ?? '');
		const label = String(row.label ?? row.address ?? walletId);

		// Check last sync time
		const syncStateResult = await db.execute({
			sql: `SELECT MAX(last_run_at) as last_run FROM wallet_sync_state
			      WHERE wallet_id = ? AND tenant_id = ?`,
			args: [walletId, tenantId],
		});
		const lastRun = (syncStateResult.rows[0] as Record<string, unknown>)?.last_run as string | null;

		// Skip if synced within last 6 days
		if (lastRun && lastRun > staleThreshold) {
			console.log(`[cron/sync-wallets] Skipping ${label} — synced ${lastRun}`);
			results.push({ walletId, tenantId, label, skippedFresh: true });
			continue;
		}

		try {
			console.log(`[cron/sync-wallets] Syncing ${label} (tenant: ${tenantId})`);

			const chainsRaw = row.chains;
			const chains = Array.isArray(chainsRaw)
				? chainsRaw
				: typeof chainsRaw === 'string'
					? JSON.parse(chainsRaw)
					: ['ethereum', 'polygon'];

			const wallet = {
				id: walletId,
				tenantId,
				address: String(row.address ?? ''),
				label: label,
				chains,
				isDefault: Boolean(row.is_default),
				createdAt: String(row.created_at ?? ''),
				walletType: 'onchain' as const,
			};

			const stats = await syncWalletTransactions(tenantId, wallet);
			console.log(`[cron/sync-wallets] ${label} → inserted ${stats.totalInserted}, skipped ${stats.totalSkipped}`);
			results.push({ walletId, tenantId, label, skippedFresh: false, inserted: stats.totalInserted });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[cron/sync-wallets] Failed to sync ${label}:`, message);
			results.push({ walletId, tenantId, label, skippedFresh: false, error: message });
		}

		// Small pause between wallets to avoid hammering the block explorer APIs
		await new Promise((r) => setTimeout(r, 1000));
	}

	const elapsed = Date.now() - startedAt;
	const synced = results.filter((r) => !r.skippedFresh && !r.error).length;
	const skipped = results.filter((r) => r.skippedFresh).length;
	const failed = results.filter((r) => r.error).length;

	console.log(`[cron/sync-wallets] Done in ${elapsed}ms — synced: ${synced}, skipped fresh: ${skipped}, failed: ${failed}`);

	return json({
		ok: true,
		elapsed_ms: elapsed,
		total: wallets.length,
		synced,
		skipped_fresh: skipped,
		failed,
		results,
	}, 200);
};

function json(body: unknown, status: number) {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
