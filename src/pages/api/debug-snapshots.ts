import type { APIRoute } from 'astro';
import { db } from '@/lib/db';
import { requireTenantSession } from '@/lib/requireTenantSession';

export const GET: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session) return new Response('Unauthorized', { status: 401 });
		const { tenantId } = session;
		const walletTableInfo = await db.execute(/* sql */ `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallets';`);
		const snapshotTableInfo = await db.execute(/* sql */ `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wallet_snapshots';`);

		const wallets = await db.execute({
			sql: `SELECT id, address, label, chains, created_at
        FROM wallets
        WHERE tenant_id = ?
        ORDER BY created_at ASC
        LIMIT 20;`,
			args: [tenantId],
		});
		const snapshots = await db.execute({
			sql: `SELECT wallet_id, chain, totals_usd, collateral_usd, debt_usd, captured_at
        FROM wallet_snapshots
        WHERE tenant_id = ?
        ORDER BY captured_at DESC
        LIMIT 20;`,
			args: [tenantId],
		});

		return new Response(
			JSON.stringify(
				{
					ok: true,
					wallet_table: walletTableInfo,
					snapshot_table: snapshotTableInfo,
					wallets,
					snapshots,
				},
				null,
				2,
			),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	} catch (err: unknown) {
		console.error('GET /api/debug-snapshots error', err);
		const message = err instanceof Error ? err.message : 'debug failed';
		return new Response(
			JSON.stringify({ ok: false, error: message }),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			},
		);
	}
};
