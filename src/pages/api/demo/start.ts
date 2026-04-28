/**
 * GET /api/demo/start
 *
 * Wipes any existing demo data, sets the demo session cookie, and redirects
 * the visitor to the vault. Accepts an optional ?address= query param — if
 * provided the wallet is seeded immediately so it appears on the vault page.
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
	'transactions',
	'wallet_snapshots',
	'exchange_accounts',
	'wallets',
];

function detectChains(address: string): string[] {
	if (/^0x[a-fA-F0-9]{40}$/.test(address))               return ['ethereum', 'polygon', 'avalanche'];
	if (/^bc1[a-zA-HJ-NP-Z0-9]{25,}$/.test(address))       return ['bitcoin'];
	if (/^[13][a-zA-HJ-NP-Z0-9]{25,34}$/.test(address))    return ['bitcoin'];
	if (/^ltc1[a-zA-HJ-NP-Z0-9]{25,}$/.test(address))      return ['litecoin'];
	if (/^[LM][a-zA-HJ-NP-Z0-9]{25,34}$/.test(address))    return ['litecoin'];
	if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))     return ['solana'];
	return ['ethereum', 'polygon', 'avalanche']; // default to EVM
}

export const GET: APIRoute = async ({ request }) => {
	const url     = new URL(request.url);
	const address = url.searchParams.get('address')?.trim() ?? '';

	// Clear all demo data so every visitor starts fresh
	for (const table of DEMO_TABLES) {
		await db
			.execute({ sql: `DELETE FROM ${table} WHERE tenant_id = ?`, args: [DEMO_TENANT_ID] })
			.catch(() => { /* table may not exist in this schema version — ignore */ });
	}

	// Seed the wallet the visitor pasted on the landing page
	if (address) {
		const chains = detectChains(address);
		await db
			.execute({
				sql:  `INSERT INTO wallets (tenant_id, address, chains) VALUES (?, ?, ?)`,
				args: [DEMO_TENANT_ID, address.toLowerCase(), JSON.stringify(chains)],
			})
			.catch(() => { /* ignore duplicate or schema issues */ });
	}

	// Increment demo session counter (best-effort — never blocks the redirect)
	const ua       = request.headers.get('user-agent') ?? null;
	const referrer = request.headers.get('referer')    ?? null;
	await db
		.execute({
			sql:  `INSERT INTO demo_sessions (user_agent, referrer) VALUES (?, ?)`,
			args: [ua, referrer],
		})
		.catch(() => { /* table may not exist yet — ignore */ });

	return new Response(null, {
		status: 302,
		headers: {
			Location: '/dashboard/vault',
			'Set-Cookie': demoCookieSet(),
		},
	});
};
