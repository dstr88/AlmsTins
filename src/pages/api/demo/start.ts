/**
 * GET /api/demo/start
 *
 * Wipes any existing demo data, sets the demo session cookie, and redirects
 * the visitor to the vault. Each new demo session starts with a clean slate
 * so visitors can add their own wallet addresses.
 * No auth required — this endpoint is in isPublicPath().
 */

import type { APIRoute } from 'astro';
import { demoCookieSet, DEMO_TENANT_ID } from '../../../lib/demo';
import { db } from '../../../lib/db';

/** Tables to clear on each new demo session (order avoids FK issues). */
const DEMO_TABLES = [
	'tax_wash_sales',
	'tax_disposals',
	'tax_lots',
	'tax_classifications',
	'tax_pipeline_runs',
	'import_transactions',
	'wallet_snapshots',
	'exchange_accounts',
	'wallets',
];

export const GET: APIRoute = async () => {
	// Clear all demo data so every visitor starts fresh
	for (const table of DEMO_TABLES) {
		await db
			.execute({ sql: `DELETE FROM ${table} WHERE tenant_id = ?`, args: [DEMO_TENANT_ID] })
			.catch(() => {
				/* table may not exist in this schema version — ignore */
			});
	}

	return new Response(null, {
		status: 302,
		headers: {
			Location: '/dashboard/vault',
			'Set-Cookie': demoCookieSet(),
		},
	});
};
