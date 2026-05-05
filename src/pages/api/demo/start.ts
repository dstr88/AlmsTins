/**
 * GET /api/demo/start
 *
 * Wipes any existing demo data, sets the demo session cookie, and redirects
 * the visitor to the vault. Accepts an optional ?address= query param — if
 * provided the wallet is seeded immediately so it appears on the vault page.
 * No auth required — this endpoint is in isPublicPath().
 */

import type { APIRoute } from 'astro';
import { demoCookieSet, DEMO_TENANT_ID, isDemoWalletAddress, DEMO_WALLET_CONFIGS } from '../../../lib/demo';
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
	const rawAddress = url.searchParams.get('address')?.trim() ?? '';
	// Normalize chip labels ("1 — ETH wallet", "2 — Billetera SOL", etc.) → bare key ("1", "2", "3")
	const address = /^([123])\s*[—\-]/.test(rawAddress)
		? (rawAddress.match(/^([123])/)?.[1] ?? rawAddress)
		: rawAddress;

	// Clear all demo data so every visitor starts fresh
	for (const table of DEMO_TABLES) {
		await db
			.execute({ sql: `DELETE FROM ${table} WHERE tenant_id = ?`, args: [DEMO_TENANT_ID] })
			.catch(() => { /* table may not exist in this schema version — ignore */ });
	}

	// Seed the wallet the visitor pasted on the landing page
	if (address) {
		// Known demo addresses use pre-defined chains; real addresses use detection
		const config  = isDemoWalletAddress(address) ? DEMO_WALLET_CONFIGS[address] : null;
		const chains  = config ? config.chains : detectChains(address);

		await db
			.execute({
				sql:  `INSERT INTO wallets (tenant_id, address, label, chains) VALUES (?, ?, ?, ?)`,
				args: [DEMO_TENANT_ID, address.toLowerCase(), config?.label ?? address, JSON.stringify(chains)],
			})
			.catch(() => { /* ignore duplicate or schema issues */ });

		// Pre-seed mock snapshot so the tin renders immediately on vault load
		if (config) {
			const walletRow = await db
				.execute({
					sql:  `SELECT id FROM wallets WHERE tenant_id = ? AND address = ? LIMIT 1`,
					args: [DEMO_TENANT_ID, address.toLowerCase()],
				})
				.catch(() => null);

			const walletId = walletRow?.rows?.[0]?.id;
			if (walletId) {
				const totals = config.tokens.reduce((s, t) => s + t.valueUsd, 0);
				await db
					.execute({
						sql:  `INSERT INTO wallet_snapshots
						         (tenant_id, wallet_id, chain, totals_usd,
						          collateral_usd, debt_usd, collateral_apy_pct,
						          borrow_apy_pct, net_rate_pct, payload_json, captured_at)
						       VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
						args: [DEMO_TENANT_ID, walletId, config.chain, totals, JSON.stringify(config.tokens)],
					})
					.catch(() => {});
			}
		}
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
