/**
 * POST /api/lot-identifications/refresh {force?}
 *
 * Retries the Bitcoin timestamps that are waiting: a batch no calendar accepted yet is submitted
 * again, a pending one is checked for its Bitcoin confirmation. Each batch is tried at most every
 * five minutes unless `force` is set. Owner only; reads and writes only this tenant's rows.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireTaxOwner } from '@/lib/taxAuth';
import { refreshAll } from '@/lib/lotIdentificationStamp';
import { json } from '@/lib/http';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const denied = await requireTaxOwner(request);
	if (denied) return denied;
	const sess = await requireTenantSession(request);
	if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
	try {
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		const stamps = await refreshAll(sess.tenantId, { force: body?.force === true });
		return json({
			ok: true,
			batches: [...stamps.values()].map((s) => ({ batchId: s.batchId, status: s.status, blockHeight: s.blockHeight, blockTime: s.blockTime })),
		}, 200, { noStore: true });
	} catch (err) {
		console.error('[lot-identifications] refresh error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
