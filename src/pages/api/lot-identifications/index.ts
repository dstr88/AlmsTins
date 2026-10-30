/**
 * /api/lot-identifications
 *
 * GET              the wallets and exchange accounts, the recorded identifications, and how many wallets
 *                  have no identification yet (what the add-wallet prompt and the page read)
 * POST {entries}   record identifications, one dated entry per wallet key:
 *                  [{walletKey, method: earliest|latest|highest_basis, effectiveAt?, note?}]
 * POST {applyAll: true, method, note?}
 *                  one entry per wallet key of every wallet and exchange account, all with the same
 *                  server time
 *
 * Owner only, like every tax record (src/lib/taxAuth.ts), and only for a tenant on the wallet-by-wallet
 * rule. The gate runs before anything is read. The tenant comes from the signed session; created_at is
 * the server's clock and an effective time before it is refused, so nothing can be backdated. There is
 * no PUT or DELETE: a change of mind is a new entry.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireTaxOwner } from '@/lib/taxAuth';
import { invalidateLedger, perWalletEnabled } from '@/lib/tax/computeLedger';
import { createIdentifications } from '@/lib/lotIdentificationStore';
import { stampBatch } from '@/lib/lotIdentificationStamp';
import { loadIdentificationState } from '@/lib/lotIdentificationState';
import { loadWalletGroups } from '@/lib/lotIdentificationWallets';
import { isEntrySource, isExchangeHeld, isIdentificationMethod, type EntrySource } from '@/lib/tax/lotIdentification';
import { deleteCachePrefix } from '@/lib/tursoCache';
import { json } from '@/lib/http';

export const prerender = false;

/** How long a click waits for the first timestamp attempt before answering; the attempt carries on. */
const STAMP_WAIT_MS = 8_000;

export const GET: APIRoute = async ({ request }) => {
	const denied = await requireTaxOwner(request);
	if (denied) return denied;
	const sess = await requireTenantSession(request);
	if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
	try {
		if (!(await perWalletEnabled(sess.tenantId))) return json({ ok: true, enabled: false, groups: [], entries: [], undecidedCount: 0 }, 200, { noStore: true });
		return json({ ok: true, enabled: true, ...(await loadIdentificationState(sess.tenantId)) }, 200, { noStore: true });
	} catch (err) {
		console.error('[lot-identifications] GET error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};

export const POST: APIRoute = async ({ request }) => {
	const denied = await requireTaxOwner(request);
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

		// Only this tenant's own wallets and accounts can be named.
		const groups = await loadWalletGroups(tenantId);
		const known = new Set(groups.flatMap((g) => g.keys));

		let raw: unknown;
		if (b.applyAll === true) {
			if (!isIdentificationMethod(b.method)) return json({ ok: false, error: 'method_invalid' }, 400);
			raw = [...known].sort().map((walletKey) => ({ walletKey, method: b.method, note: b.note ?? null }));
		} else {
			raw = b.entries;
			if (Array.isArray(raw)) {
				for (const item of raw) {
					const key = item && typeof item === 'object' ? (item as Record<string, unknown>).walletKey : undefined;
					if (typeof key !== 'string' || !known.has(key.trim())) return json({ ok: false, error: 'wallet_unknown' }, 400);
				}
			}
		}

		// Where the entries came from: the Apply to all button, the add-wallet prompt, or the rest.
		const source: EntrySource = b.applyAll === true ? 'apply_all' : isEntrySource(b.source) && b.source !== 'apply_all' ? b.source : 'manual';
		const created = await createIdentifications(tenantId, raw, source);
		if (!created.ok) return json({ ok: false, error: created.error }, created.error === 'effective_before_recorded' ? 422 : 400);

		// Figures computed from the old set, and what is cached from them, go.
		invalidateLedger(tenantId);
		await deleteCachePrefix(`t:${tenantId}:`).catch((e) => console.error('[lot-identifications] cache clear failed', e));

		// Stamp at creation. The attempt carries on past the wait; whatever it finds is retried later.
		const stamping = stampBatch(tenantId, created.entries);
		const stamp = await Promise.race([stamping, new Promise<null>((resolve) => setTimeout(() => resolve(null), STAMP_WAIT_MS))]);

		return json({
			ok: true,
			batchId: created.batchId,
			createdAt: created.createdAt,
			count: created.entries.length,
			exchangeHeld: created.entries.filter((e) => isExchangeHeld(e.walletKey)).length,
			stampStatus: stamp?.status ?? 'unstamped',
		});
	} catch (err) {
		console.error('[lot-identifications] POST error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
