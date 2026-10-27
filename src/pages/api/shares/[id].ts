/**
 * DELETE /api/shares/:id   revoke a share: the link stops working and the stored file is removed.
 *
 * Scoped to the owner's tenant. A share that belongs to another tenant answers 404, the same as one
 * that does not exist.
 */
import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { ensureShareTables, logShareEvent } from '@/lib/fileShares';
import { json } from '@/lib/http';

export const prerender = false;

export const DELETE: APIRoute = async ({ request, params }) => {
	const session = await requireTenantSession(request);
	if (!session) return json({ error: 'Unauthorized' }, 401, { noStore: true });
	if (session.isDemo) return json({ error: 'Not available in the demo.' }, 403, { noStore: true });

	const id = String(params.id ?? '');
	if (!id) return json({ error: 'Not found' }, 404, { noStore: true });
	await ensureShareTables();

	const now = new Date();
	const r = await db.execute({
		sql: `UPDATE file_shares SET revoked_at = ?, data = NULL
		      WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL`,
		args: [now.toISOString(), id, session.tenantId],
	});
	if ((r.rowsAffected ?? 0) === 0) return json({ error: 'Not found' }, 404, { noStore: true });

	await logShareEvent(id, session.tenantId, 'revoked', now);
	return json({ ok: true }, 200, { noStore: true });
};
