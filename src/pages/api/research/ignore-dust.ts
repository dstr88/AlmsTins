import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activityLog';

export const prerender = false;

const DUST_THRESHOLD = 0.01; // $0.01

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const result = await db.execute({
		sql: `UPDATE import_transactions
		      SET category = 'dust', notes = COALESCE(NULLIF(notes, ''), 'Auto-dismissed: dust (< $0.01)')
		      WHERE tenant_id = ?
		        AND native_usd IS NOT NULL
		        AND native_usd < ?
		        AND (category IS NULL OR category NOT IN ('legacy_exchange','own_wallet','purchase','income','dust'))
		        AND NOT EXISTS (
		          SELECT 1 FROM transfer_matches tm
		          WHERE (tm.in_tx_id = import_transactions.id OR tm.out_tx_id = import_transactions.id)
		            AND tm.status IN ('confirmed','auto')
		        )`,
		args: [tenantId, DUST_THRESHOLD],
	});

	const dismissed = result.rowsAffected ?? 0;
	logActivity(tenantId, 'ignore_dust', `${dismissed} dust transactions dismissed`, { dismissed, threshold: DUST_THRESHOLD });

	return new Response(JSON.stringify({ ok: true, dismissed }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
