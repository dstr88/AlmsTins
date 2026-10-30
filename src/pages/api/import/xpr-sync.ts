/**
 * POST /api/import/xpr-sync
 *
 * Reads XPR Network accounts from public chain servers (no key) and imports any new transfers into
 * import_transactions. Also writes a wallet_snapshot so the Portfolio tin reflects the current
 * balance (the chain's own coin and every other token, listed by contract and symbol).
 *
 * Request body (JSON, optional):
 *   { walletId: "…" }   sync one stored XPR wallet
 *   {}                  sync every XPR wallet stored for this tenant (Sync Tins)
 *
 * An XPR wallet is one the tenant added with the XPR Network chain: an account name has no shape
 * that tells it from other input, so nothing is picked up by its look.
 *
 * A balance no server can read writes no snapshot and counts as failed ("unavailable"), never as
 * zero. A long history is read over several syncs: `complete` is false while more remains.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { logActivity } from '@/lib/activityLog';
import { db } from '@/lib/db';
import { syncXprAddress, XPR_WALLET_SQL } from '@/lib/sync/syncXprAddress';
import { json } from '@/lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json().catch(() => ({}));
	const walletId = typeof body?.walletId === 'string' ? body.walletId.trim() : '';

	const res = await db.execute({
		sql: `SELECT id, address FROM wallets
		      WHERE tenant_id = ?
		        AND ${XPR_WALLET_SQL}
		        ${walletId ? 'AND id = ?' : ''}
		      ORDER BY created_at ASC
		      LIMIT 20`,
		args: walletId ? [tenantId, walletId] : [tenantId],
	});
	const targets = (res.rows as Array<Record<string, unknown>>)
		.map((r) => ({ id: String(r.id ?? ''), address: String(r.address ?? '').trim() }))
		.filter((t) => t.id && t.address);

	if (!targets.length) {
		return json({ error: 'No XPR Network wallet found. Add a wallet with the XPR Network chain first.' }, 400, { noStore: true });
	}

	let inserted = 0;
	let skipped = 0;
	let fetched = 0;
	let snapshots = 0;
	let failed = 0;
	let complete = true;
	const perWallet: Array<{ walletId: string; inserted: number; skipped: number; complete: boolean; snapshot: boolean }> = [];

	for (const t of targets) {
		try {
			const result = await syncXprAddress(tenantId, t.address, t.id);
			inserted += result.inserted;
			skipped += result.skipped;
			fetched += result.txCount;
			if (result.snapshotWritten) snapshots += 1;
			else failed += 1;
			if (!result.complete) complete = false;
			perWallet.push({ walletId: t.id, inserted: result.inserted, skipped: result.skipped, complete: result.complete, snapshot: result.snapshotWritten });
		} catch (err) {
			console.error('[xpr-sync] failed for a wallet', err instanceof Error ? err.message : err);
			failed += 1;
			complete = false;
			perWallet.push({ walletId: t.id, inserted: 0, skipped: 0, complete: false, snapshot: false });
		}
	}

	void runTransferMatching(tenantId);
	void autoClassifyOwnWalletTransfers(tenantId);
	logActivity(tenantId, 'import', `${inserted} imported, ${skipped} skipped`, { inserted, skipped, complete }, { source: 'xpr_sync', chain: 'xpr' });

	return json({ inserted, skipped, fetched, snapshots, failed, complete, wallets: targets.length, perWallet }, 200, { noStore: true });
};
