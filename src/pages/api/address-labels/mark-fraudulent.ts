import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { logActivity } from '@/lib/activityLog';

export const prerender = false;

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const POST: APIRoute = async ({ request }) => {
	// Tenant id ALWAYS comes from the signed session — never from the request
	// body. This endpoint writes to tenant-scoped tables, so trusting a
	// caller-supplied tenantId would be a cross-tenant write primitive.
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401);
	const { tenantId } = session;

	let body: { address?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, 400);
	}

	const address = typeof body.address === 'string' ? body.address.trim() : '';
	if (!address) return json({ error: 'Missing address' }, 400);

	try {
		// 1. Remove the address from this tenant's own address book.
		await db.execute({
			sql: 'DELETE FROM address_labels WHERE tenant_id = ? AND address = ?',
			args: [tenantId, address],
		});

		// 2. Increment this tenant's fraud counter for the address.
		await db.execute({
			sql: `INSERT INTO address_fraud_reports (tenant_id, address, count, last_reported_at)
			      VALUES (?, ?, 1, datetime('now'))
			      ON CONFLICT(tenant_id, address) DO UPDATE
			      SET count = count + 1, last_reported_at = datetime('now')`,
			args: [tenantId, address],
		});

		// 3. Log activity. Per the activity-log privacy rule, never store the
		//    address (or any fragment of it) in the log.
		logActivity(tenantId, 'address_marked_fraudulent', 'Address reported fraudulent', {});

		return json({ ok: true }, 200);
	} catch (error) {
		console.error('[mark-fraudulent] failed', error instanceof Error ? error.message : String(error));
		return json({ error: 'Internal server error' }, 500);
	}
};
