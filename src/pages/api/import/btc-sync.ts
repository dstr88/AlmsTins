/**
 * POST /api/import/btc-sync
 *
 * Fetches native BTC transactions for one or more wallet addresses from the
 * Blockstream API (free, no key required) and imports any new rows into
 * import_transactions.  Also writes a wallet_snapshot so the Portfolio tin
 * reflects the current BTC balance.
 *
 * Request body (JSON, optional):
 *   { address: "bc1q…" }   — sync a specific address
 *   {}                      — sync all bitcoin wallets stored for this tenant
 *
 * Blockstream API used:
 *   GET https://blockstream.info/api/address/{addr}
 *   GET https://blockstream.info/api/address/{addr}/txs
 *   GET https://blockstream.info/api/address/{addr}/txs/chain/{last_seen_txid}
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { runTransferMatching } from '@/lib/transferMatcher';
import { autoClassifyOwnWalletTransfers } from '@/lib/autoClassify';
import { detectAndAlertBounces } from '@/lib/bounceDetector';
import { logActivity } from '@/lib/activityLog';
import { db } from '@/lib/db';
import { syncBtcAddress } from '@/lib/sync/syncBtcAddress';

// ── Main handler ──────────────────────────────────────────────────────────────

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json().catch(() => ({}));
	let addresses: string[] = [];

	const requestedAddr = (body?.address as string | undefined)?.trim().toLowerCase() ?? '';
	if (requestedAddr) {
		addresses = [requestedAddr];
	} else {
		// Look up all Bitcoin wallets stored for this tenant:
		// either tagged with the 'bitcoin' chain, or whose address looks like BTC.
		const res = await db.execute({
			sql: `SELECT address FROM wallets
			      WHERE tenant_id = ?
			        AND (chains LIKE '%bitcoin%'
			          OR address LIKE 'bc1%'
			          OR (length(address) BETWEEN 26 AND 35 AND (address LIKE '1%' OR address LIKE '3%')))
			      LIMIT 20`,
			args: [tenantId],
		});
		addresses = (res.rows as any[])
			.map(r => String(r.address ?? '').toLowerCase())
			.filter(a => a.startsWith('bc1') || /^[13]/.test(a));
	}

	if (!addresses.length) {
		return new Response(JSON.stringify({
			error: 'No Bitcoin wallet found. Add a wallet with a bc1… address first, or pass { address: "bc1q…" } in the request body.',
		}), { status: 400 });
	}

	let totalInserted = 0;
	let totalSkipped  = 0;
	let totalTxCount  = 0;
	const perWallet: Array<{ address: string; inserted: number; skipped: number }> = [];

	for (const addr of addresses) {
		try {
			const result = await syncBtcAddress(tenantId, addr);
			totalInserted += result.inserted;
			totalSkipped  += result.skipped;
			totalTxCount  += result.txCount;
			perWallet.push({ address: addr, inserted: result.inserted, skipped: result.skipped });
		} catch (err) {
			console.error('[btc-sync] failed for address', addr, err);
			perWallet.push({ address: addr, inserted: 0, skipped: 0 });
		}
	}

	// Run transfer matching tenant-wide so BTC OUTs/INs can match CEX sends/receives
	void runTransferMatching(tenantId);
	void autoClassifyOwnWalletTransfers(tenantId);
	void detectAndAlertBounces(tenantId);
	logActivity(tenantId, 'import', `${totalInserted} imported, ${totalSkipped} skipped`, { inserted: totalInserted, skipped: totalSkipped }, { source: 'btc_sync', chain: 'bitcoin' });

	return new Response(JSON.stringify({
		inserted:  totalInserted,
		skipped:   totalSkipped,
		fetched:   totalTxCount,
		wallets:   addresses,
		perWallet,
	}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
