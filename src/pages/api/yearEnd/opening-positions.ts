/**
 * /api/yearEnd/opening-positions
 *
 * GET                     the January 1, 2025 positions per coin and wallet, rebuilt from the
 *                         tenant's history, with the saved allocations and anything that needs a look
 * POST   {asset, rows}    save the owner's own allocation of one coin's cost basis to wallets; it
 *                         replaces the reconstruction for that coin and is checked first
 * DELETE ?asset=BTC       remove the saved allocation; the reconstruction applies again
 *
 * Owner only, like every tax document (src/lib/taxAuth.ts). The gate runs before anything is read.
 * Nothing here reads a tenant id from the request: it comes from the signed session.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireTaxOwner } from '@/lib/taxAuth';
import { computeLedger, engineForTenant, invalidateLedger, perWalletEnabled } from '@/lib/tax/computeLedger';
import { deleteAllocation, loadAllocationOverrides, loadStoredAllocations, parseAllocationRows, saveAllocation } from '@/lib/tax/allocationOverride';
import { PER_WALLET_FROM } from '@/lib/tax/basisMethod';
import { openingPositionsOf } from '@/lib/tax/openingPositions';
import { normalizeAsset } from '@/lib/tax/normalize';
import { deleteCachePrefix } from '@/lib/tursoCache';
import { json } from '@/lib/http';

export const prerender = false;

const ASSET_RE = /^[A-Za-z0-9._\-]{1,40}$/;

/** A saved allocation changes figures, so what was computed and cached from the old one goes. */
async function dropComputed(tenantId: string): Promise<void> {
	invalidateLedger(tenantId);
	await deleteCachePrefix(`t:${tenantId}:`).catch((e) => console.error('[opening-positions] cache clear failed', e));
}

export const GET: APIRoute = async ({ request }) => {
	const denied = await requireTaxOwner(request); // tax documents: owner only
	if (denied) return denied;
	const sess = await requireTenantSession(request);
	if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
	const { tenantId } = sess;
	try {
		const enabled = await perWalletEnabled(tenantId);
		if (!enabled) return json({ ok: true, enabled: false, from: PER_WALLET_FROM, assets: [], needsReview: [] });
		const ledger = await computeLedger(tenantId, await engineForTenant(tenantId));
		const saved = await loadStoredAllocations(tenantId);
		return json({ ok: true, enabled: true, ...openingPositionsOf(ledger.result, saved, PER_WALLET_FROM) });
	} catch (err) {
		console.error('[opening-positions] GET error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};

export const POST: APIRoute = async ({ request }) => {
	const denied = await requireTaxOwner(request); // tax documents: owner only
	if (denied) return denied;
	const sess = await requireTenantSession(request);
	if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
	const { tenantId } = sess;
	try {
		if (!(await perWalletEnabled(tenantId))) return json({ ok: false, error: 'not_enabled' }, 409);

		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ ok: false, error: 'invalid_json' }, 400);
		}
		const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
		const assetRaw = typeof b.asset === 'string' ? b.asset.trim() : '';
		if (!ASSET_RE.test(assetRaw)) return json({ ok: false, error: 'asset_invalid' }, 400);
		const asset = normalizeAsset(assetRaw);
		const parsed = parseAllocationRows(b.rows);
		if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);

		// Check it against the history before it is stored: the ledger refuses an allocation that does
		// not hold the same units per wallet, or draws on lots that are not there.
		const others = (await loadAllocationOverrides(tenantId)).filter((o) => o.asset !== asset);
		const trial = await computeLedger(tenantId, await engineForTenant(tenantId), 'fifo', undefined, {
			allocationOverrides: [
				...others,
				{ asset, rows: parsed.rows.map((r) => ({ wallet: r.walletKey, acquiredAt: r.lotAcquiredAt, qty: r.quantity, costUsd: r.costBasisUsd ?? null })) },
			],
		});
		const position = trial.result.jan1.find((j) => j.asset === asset);
		if (!position || position.source !== 'override' || position.overrideRejected) {
			const reasons = trial.result.findings.filter((f) => f.asset === asset && f.reason === 'allocation_override_rejected').map((f) => f.detail);
			return json({ ok: false, error: 'allocation_rejected', detail: reasons[0] ?? 'unknown_asset' }, 422);
		}

		await saveAllocation(tenantId, asset, parsed.rows);
		await dropComputed(tenantId);
		return json({ ok: true, asset });
	} catch (err) {
		console.error('[opening-positions] POST error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};

export const DELETE: APIRoute = async ({ request, url }) => {
	const denied = await requireTaxOwner(request); // tax documents: owner only
	if (denied) return denied;
	const sess = await requireTenantSession(request);
	if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
	try {
		const assetRaw = (url.searchParams.get('asset') ?? '').trim();
		if (!ASSET_RE.test(assetRaw)) return json({ ok: false, error: 'asset_invalid' }, 400);
		await deleteAllocation(sess.tenantId, assetRaw);
		await dropComputed(sess.tenantId);
		return json({ ok: true });
	} catch (err) {
		console.error('[opening-positions] DELETE error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
