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
 *                             (Sync Tins), and snapshot every litecoin wallet's balance
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
import { logActivity } from '@/lib/activityLog';
import { db } from '@/lib/db';
import { snapshotUtxoBalance, syncBtcAddress, utxoChainOf, UTXO_WALLET_SQL } from '@/lib/sync/syncBtcAddress';
import { canonicalAddress } from '@/lib/wallets-service';

// ── Main handler ──────────────────────────────────────────────────────────────

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json().catch(() => ({}));
	// walletId is set for a stored wallet, so the sync never looks it up (or creates it) by address.
	let targets: Array<{ address: string; walletId?: string; chain: 'bitcoin' | 'litecoin' }> = [];

	// Exact as given, apart from bech32: a legacy 1…/3… address is case-sensitive base58.
	const requestedAddr = canonicalAddress(typeof body?.address === 'string' ? body.address : '');
	if (requestedAddr) {
		targets = [{ address: requestedAddr, chain: 'bitcoin' }];
	} else {
		// Every Bitcoin and Litecoin wallet stored for this tenant: tagged with the chain, or
		// whose address looks like one.
		const res = await db.execute({
			sql: `SELECT id, address, chains FROM wallets
			      WHERE tenant_id = ?
			        AND ${UTXO_WALLET_SQL}
			      ORDER BY created_at ASC
			      LIMIT 20`,
			args: [tenantId],
		});
		for (const r of res.rows as any[]) {
			const address = String(r.address ?? '').trim();
			const chain = utxoChainOf(r.chains, address);
			if (chain) targets.push({ address, walletId: String(r.id ?? '') || undefined, chain });
		}
	}
	const addresses = targets.filter(t => t.chain === 'bitcoin').map(t => t.address);

	if (!targets.length) {
		return new Response(JSON.stringify({
			error: 'No Bitcoin wallet found. Add a wallet with a bc1… address first, or pass { address: "bc1q…" } in the request body.',
		}), { status: 400 });
	}

	let totalInserted = 0;
	let totalSkipped  = 0;
	let totalTxCount  = 0;
	const perWallet: Array<{ address: string; inserted: number; skipped: number }> = [];

	let snapshots = 0;
	let failed    = 0;

	for (const t of targets) {
		try {
			if (t.chain === 'litecoin') {
				if (t.walletId && await snapshotUtxoBalance(tenantId, t.walletId, 'litecoin', t.address)) snapshots += 1;
				else failed += 1;
				continue;
			}
			const result = await syncBtcAddress(tenantId, t.address, t.walletId);
			totalInserted += result.inserted;
			totalSkipped  += result.skipped;
			totalTxCount  += result.txCount;
			if (result.snapshotWritten) snapshots += 1;
			else failed += 1;
			perWallet.push({ address: t.address, inserted: result.inserted, skipped: result.skipped });
		} catch (err) {
			console.error('[btc-sync] failed for address', t.address, err);
			failed += 1;
			perWallet.push({ address: t.address, inserted: 0, skipped: 0 });
		}
	}

	// Run transfer matching tenant-wide so BTC OUTs/INs can match CEX sends/receives
	void runTransferMatching(tenantId);
	void autoClassifyOwnWalletTransfers(tenantId);
	logActivity(tenantId, 'import', `${totalInserted} imported, ${totalSkipped} skipped`, { inserted: totalInserted, skipped: totalSkipped }, { source: 'btc_sync', chain: 'bitcoin' });

	return new Response(JSON.stringify({
		inserted:  totalInserted,
		skipped:   totalSkipped,
		fetched:   totalTxCount,
		snapshots,
		failed,
		wallets:   addresses,
		perWallet,
	}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
