import type { APIRoute } from 'astro';
import { requireTenantSession } from '../../lib/requireTenantSession';
import { json } from '@/lib/http';
import { loadDangerZone, sendToDangerZone } from '../../lib/dangerZone';

export const prerender = false;

// The Danger Zone on the Addresses page (src/lib/dangerZone.ts).
//
// GET  /api/address-danger            the account's Danger Zone
// POST /api/address-danger {labelId}  send an address book entry to the Danger Zone (no prompt);
//                                     answers with the Danger Zone as it now stands.
// Moving an address OUT goes through POST /api/address-labels with fromDangerZone: true.

export const GET: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	return json({ dangerZone: await loadDangerZone(session.tenantId) });
};

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json().catch(() => ({}));
	const labelId = typeof body?.labelId === 'string' ? body.labelId.trim() : '';
	if (!labelId) return json({ error: true, message: 'labelId is required' }, 400);

	try {
		const address = await sendToDangerZone(tenantId, labelId);
		if (!address) return json({ error: true, message: 'Not found' }, 404);
		return json({ address, dangerZone: await loadDangerZone(tenantId) });
	} catch (e) {
		console.error('[address-danger]', e instanceof Error ? e.message : 'failed');
		return json({ error: true, message: 'Unable to move the address' }, 500);
	}
};
