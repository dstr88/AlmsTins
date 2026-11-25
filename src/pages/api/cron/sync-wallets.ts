/**
 * GET /api/cron/sync-wallets
 *
 * Called weekly by Render Cron (or any scheduler).
 * Syncs on-chain transactions for every active onchain wallet
 * across all tenants, then rebuilds the lifecycle (cost basis) of each
 * account that got new rows, with the same rebuild the Bookkeeping page's
 * Sync now button runs. A wallet whose address is not an EVM address (a
 * custom wallet, a Solana or Bitcoin address) is skipped: the explorers
 * cannot read it, and skipping it is not a failure.
 *
 * Protected by CRON_SECRET header — never exposes user sessions.
 */

import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { syncWalletTransactions } from '@/lib/sync/syncTransactions';
import { SYNC_CRON_FALLBACK_CHAINS } from '@/lib/chains';
import { isXprWallet } from '@/lib/sync/syncXprAddress';
import { json } from '@/lib/http';
import { isEvmAddress } from '@/lib/addressFormats';
import { ensureSyncRunAtFormat, latestSyncRunSql, syncedSince } from '@/lib/sync/syncRunAt';
import { rebuildLifecycleAndCaches } from '@/lib/lifecycleRebuild';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	// ── Auth ────────────────────────────────────────────────────────────────
	const secret = import.meta.env.CRON_SECRET;
	const provided =
		request.headers.get('x-cron-secret') ??
		new URL(request.url).searchParams.get('secret');

	if (!secret || provided !== secret) {
		console.warn('[cron/sync-wallets] Unauthorized attempt');
		return json({ error: 'Unauthorized' }, 401, { pretty: true });
	}

	const startedAt = Date.now();
	console.log('[cron/sync-wallets] Starting weekly wallet sync');

	// last_run_at once held two formats; rewrite any ISO value left (src/lib/sync/syncRunAt.ts).
	await ensureSyncRunAtFormat();

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
	// Compared as times, not as text: last_run_at was once written in two formats.
	const staleCutoffMs = Date.now() - 6 * 24 * 60 * 60 * 1000;

	const results: Array<{
		walletId: string;
		tenantId: string;
		label: string;
		skippedFresh: boolean;
		skippedNotEvm?: boolean;
		inserted?: number;
		error?: string;
	}> = [];
	// Accounts that got new or changed rows: their lifecycle is rebuilt after the loop.
	const tenantsWithNewRows = new Set<string>();

	for (const row of wallets) {
		const walletId = String(row.id ?? '');
		const tenantId = String(row.tenant_id ?? '');
		const label = String(row.label ?? row.address ?? walletId);

		// XPR Network accounts have their own cron (sync-xpr); an account name means nothing to the EVM sync.
		if (isXprWallet(row.chains)) continue;

		// The explorers read only 0x addresses: a custom wallet (custom_…) or a Solana, Bitcoin or Sui
		// address got "Invalid address format" back every week. Skipped, and not counted as a failure.
		if (!isEvmAddress(row.address)) {
			results.push({ walletId, tenantId, label, skippedFresh: false, skippedNotEvm: true });
			continue;
		}

		// Check last sync time
		const syncStateResult = await db.execute({
			sql: `SELECT ${latestSyncRunSql()} as last_run FROM wallet_sync_state
			      WHERE wallet_id = ? AND tenant_id = ?`,
			args: [walletId, tenantId],
		});
		const lastRun = (syncStateResult.rows[0] as Record<string, unknown>)?.last_run as string | null;

		// Skip if synced within last 6 days
		if (syncedSince(lastRun, staleCutoffMs)) {
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
					: [...SYNC_CRON_FALLBACK_CHAINS];

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
			if (stats.totalInserted > 0) tenantsWithNewRows.add(tenantId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[cron/sync-wallets] Failed to sync ${label}:`, message);
			results.push({ walletId, tenantId, label, skippedFresh: false, error: message });
		}

		// Small pause between wallets to avoid hammering the block explorer APIs
		await new Promise((r) => setTimeout(r, 1000));
	}

	// ── Rebuild the lifecycle of each account that got new rows ─────────────
	// The same rebuild as the Sync now button, so the cost basis catches up with the weekly sync
	// instead of waiting for the customer to press it. One account failing does not stop the rest.
	let rebuilt = 0;
	let rebuildFailed = 0;
	for (const tenantId of tenantsWithNewRows) {
		try {
			await rebuildLifecycleAndCaches(tenantId);
			rebuilt += 1;
		} catch (err) {
			rebuildFailed += 1;
			console.error(`[cron/sync-wallets] Lifecycle rebuild failed for tenant ${tenantId}:`, err instanceof Error ? err.message : String(err));
		}
	}

	const elapsed = Date.now() - startedAt;
	const synced = results.filter((r) => !r.skippedFresh && !r.skippedNotEvm && !r.error).length;
	const skipped = results.filter((r) => r.skippedFresh).length;
	const skippedNotEvm = results.filter((r) => r.skippedNotEvm).length;
	const failed = results.filter((r) => r.error).length;

	console.log(`[cron/sync-wallets] Done in ${elapsed}ms — synced: ${synced}, skipped fresh: ${skipped}, skipped (not an EVM address): ${skippedNotEvm}, failed: ${failed}, lifecycles rebuilt: ${rebuilt}, rebuilds failed: ${rebuildFailed}`);

	return json({
		ok: true,
		elapsed_ms: elapsed,
		total: wallets.length,
		synced,
		skipped_fresh: skipped,
		skipped_not_evm: skippedNotEvm,
		failed,
		lifecycles_rebuilt: rebuilt,
		lifecycle_rebuilds_failed: rebuildFailed,
		results,
	}, 200, { pretty: true });
};
