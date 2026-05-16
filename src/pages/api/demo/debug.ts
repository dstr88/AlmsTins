/**
 * GET /api/demo/debug
 * Diagnostic endpoint — returns raw DB state for the demo tenant.
 * Only accessible when the demo session cookie is active.
 */
import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { requireTenantSession } from '../../../lib/requireTenantSession';
import { DEMO_TENANT_ID } from '../../../lib/demo';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	try {
		const session = await requireTenantSession(request);
		if (!session?.isDemo) {
			return new Response(JSON.stringify({ error: 'Demo only' }), { status: 403 });
		}

		const [
			walletSchema,
			snapshotSchema,
			defiSchema,
			exchangeSchema,
			wallets,
			snapshots,
			defi,
			exchanges,
			notes,
		] = await Promise.all([
			db.execute(`PRAGMA table_info(wallets)`),
			db.execute(`PRAGMA table_info(wallet_snapshots)`),
			db.execute(`PRAGMA table_info(wallet_defi_sync)`),
			db.execute(`PRAGMA table_info(exchange_accounts)`),
			db.execute({ sql: `SELECT id, address, label, wallet_type, is_default FROM wallets WHERE tenant_id = ? LIMIT 20`, args: [DEMO_TENANT_ID] }),
			db.execute({ sql: `SELECT wallet_id, chain, totals_usd, captured_at FROM wallet_snapshots WHERE tenant_id = ? LIMIT 20`, args: [DEMO_TENANT_ID] }),
			db.execute({ sql: `SELECT wallet_id, last_defi_sync_at FROM wallet_defi_sync WHERE tenant_id = ? LIMIT 10`, args: [DEMO_TENANT_ID] }),
			db.execute({ sql: `SELECT id, source, name FROM exchange_accounts WHERE tenant_id = ? LIMIT 10`, args: [DEMO_TENANT_ID] }),
			db.execute({ sql: `SELECT id, body, created_at FROM vault_notes WHERE tenant_id = ? LIMIT 10`, args: [DEMO_TENANT_ID] }),
		]);

		return new Response(
			JSON.stringify({
				walletColumns: walletSchema.rows.map((r: any) => r.name),
				snapshotColumns: snapshotSchema.rows.map((r: any) => r.name),
				defiColumns: defiSchema.rows.map((r: any) => r.name),
				exchangeColumns: exchangeSchema.rows.map((r: any) => r.name),
				wallets: wallets.rows,
				snapshots: snapshots.rows,
				defi: defi.rows,
				exchanges: exchanges.rows,
				notes: notes.rows,
			}, null, 2),
			{ status: 200, headers: { 'Content-Type': 'application/json' } },
		);
	} catch (err: unknown) {
		return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
	}
};
