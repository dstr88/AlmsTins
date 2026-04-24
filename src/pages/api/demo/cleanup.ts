/**
 * POST /api/demo/cleanup
 *
 * Wipes all data for the demo tenant.  Called by:
 *   - navigator.sendBeacon() on beforeunload (vault page)
 *   - the "Delete All" pill in AddAssetTin
 *   - /api/demo/start (fresh slate on every new demo session)
 *
 * No auth required — this endpoint is in isPublicPath(), and the demo
 * middleware allowlist lets POST through without blocking it.
 */

import type { APIRoute } from 'astro';
import { DEMO_TENANT_ID, isDemoRequest } from '../../../lib/demo';
import { db } from '../../../lib/db';

const DEMO_TABLES = [
	'tax_wash_sales',
	'tax_disposals',
	'tax_lots',
	'tax_classifications',
	'tax_pipeline_runs',
	'import_transactions',
	'transactions',
	'wallet_snapshots',
	'exchange_accounts',
	'wallets',
];

export const POST: APIRoute = async ({ request }) => {
	// Only allow demo sessions to call this endpoint
	if (!isDemoRequest(request)) {
		return new Response(JSON.stringify({ error: 'Forbidden' }), {
			status: 403,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	for (const table of DEMO_TABLES) {
		await db
			.execute({ sql: `DELETE FROM ${table} WHERE tenant_id = ?`, args: [DEMO_TENANT_ID] })
			.catch(() => {});
	}

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
