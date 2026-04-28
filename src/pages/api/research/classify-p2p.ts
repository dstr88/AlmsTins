import type { APIRoute } from 'astro';
import { requireTenantSession } from '@/lib/requireTenantSession';
import { db } from '@/lib/db';
import { logActivity } from '@/lib/activityLog';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	const session = await requireTenantSession(request);
	if (!session) return new Response('Unauthorized', { status: 401 });
	const { tenantId } = session;

	const body = await request.json().catch(() => ({}));
	const disposition = body.disposition === 'disposal' ? 'disposal' : 'own_wallet';

	const note = disposition === 'own_wallet'
		? 'Auto-classified: P2P phone-number transfer to own account. Non-taxable self-transfer.'
		: 'Auto-classified: P2P phone-number transfer to third party. Taxable disposal — verify amount.';

	const result = await db.execute({
		sql: `UPDATE import_transactions
		      SET category = ?, notes = COALESCE(NULLIF(notes, ''), ?)
		      WHERE tenant_id = ?
		        AND direction = 'out'
		        AND (description LIKE 'To +%' OR description LIKE 'From +%')
		        AND (category IS NULL OR category NOT IN ('legacy_exchange','own_wallet','purchase','income','dust','disposal'))
		        AND NOT EXISTS (
		          SELECT 1 FROM transfer_matches tm
		          WHERE (tm.in_tx_id = import_transactions.id OR tm.out_tx_id = import_transactions.id)
		            AND tm.status IN ('confirmed','auto')
		        )`,
		args: [disposition, note, tenantId],
	});

	const classified = result.rowsAffected ?? 0;
	logActivity(tenantId, 'classify_p2p', `${classified} P2P transfers → ${disposition}`, { classified, disposition });

	return new Response(JSON.stringify({ ok: true, classified }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
