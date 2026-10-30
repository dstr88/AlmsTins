/**
 * POST /api/lot-identifications/confirm {identificationId}
 *
 * The owner marks an exchange-held entry as confirmed with the exchange. It records that the owner
 * says so; Almstins does not check with the exchange. Owner only; the entry must be this tenant's
 * and name an exchange account.
 */

import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { requireTaxOwner } from '@/lib/taxAuth';
import { confirmWithExchange } from '@/lib/lotIdentificationStore';
import { json } from '@/lib/http';

export const prerender = false;

const ID_RE = /^[0-9a-f-]{36}$/i;

export const POST: APIRoute = async ({ request }) => {
	const denied = await requireTaxOwner(request);
	if (denied) return denied;
	const sess = await requireTenantSession(request);
	if (!sess) return json({ ok: false, error: 'Unauthorized' }, 401);
	try {
		const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
		const id = typeof body?.identificationId === 'string' ? body.identificationId.trim() : '';
		if (!ID_RE.test(id)) return json({ ok: false, error: 'id_invalid' }, 400);
		if (!(await confirmWithExchange(sess.tenantId, id))) return json({ ok: false, error: 'not_found' }, 404);
		return json({ ok: true });
	} catch (err) {
		console.error('[lot-identifications] confirm error', err);
		return json({ ok: false, error: 'Internal error' }, 500);
	}
};
