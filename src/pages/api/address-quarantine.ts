import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../lib/requireTenantSession';
import { json } from '@/lib/http';
import { loadQuarantine, quarantineLabel } from '../../lib/quarantine';

export const prerender = false;

// Quarantine (src/lib/quarantine.ts).
//
// GET  /api/address-quarantine            the account's quarantine
// POST /api/address-quarantine {labelId}  quarantine an address book entry (no prompt); answers
//                                         with the quarantine as it now stands.
// Releasing an address goes through POST /api/address-labels with fromQuarantine: true.

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	return json({ quarantine: await loadQuarantine(session.tenantId) });
};

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json().catch(() => ({}));
	const labelId = typeof body?.labelId === 'string' ? body.labelId.trim() : '';
	if (!labelId) return json({ error: true, message: 'labelId is required' }, 400);

	try {
		const address = await quarantineLabel(tenantId, labelId);
		if (!address) return json({ error: true, message: 'Not found' }, 404);
		return json({ address, quarantine: await loadQuarantine(tenantId) });
	} catch (e) {
		console.error('[address-quarantine]', e instanceof Error ? e.message : 'failed');
		return json({ error: true, message: 'Unable to quarantine the address' }, 500);
	}
};
