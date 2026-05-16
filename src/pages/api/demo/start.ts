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

	// Seed demo exchange accounts + transactions so tins aren't empty
	const ACCT_CB  = 'demo-acct-coinbase-000000000000000000';
	const ACCT_CRY = 'demo-acct-crypto-com-00000000000000000';
	const BATCH_CB  = 'demo-batch-coinbase-0000000000000000000';
	const BATCH_CRY = 'demo-batch-crypto-000000000000000000000';

	await db.execute({
		sql:  `INSERT OR IGNORE INTO exchange_accounts (id, tenant_id, source, name, created_at) VALUES (?, ?, 'coinbase', 'Coinbase', '2021-06-01T10:00:00.000Z')`,
		args: [ACCT_CB, DEMO_TENANT_ID],
	}).catch(() => {});
	await db.execute({
		sql:  `INSERT OR IGNORE INTO exchange_accounts (id, tenant_id, source, name, created_at) VALUES (?, ?, 'crypto_com', 'Crypto.com', '2021-06-01T10:00:00.000Z')`,
		args: [ACCT_CRY, DEMO_TENANT_ID],
	}).catch(() => {});

	const demoTxs: [string, string, string, string, string, string, string, number, number, string, string, string][] = [
		['demo-itx-cb-btc-buy',   ACCT_CB,  BATCH_CB,  '2021-06-15T14:22:00.000Z', 'Buy BTC',       'BTC',  'in',  0.042,   1_197.00, 'trade',                     'BTC',  'demo-rh-cb-btc-buy'],
		['demo-itx-cb-eth-buy',   ACCT_CB,  BATCH_CB,  '2021-10-05T11:00:00.000Z', 'Buy ETH',       'ETH',  'in',  0.580,     957.00, 'trade',                     'ETH',  'demo-rh-cb-eth-buy'],
		['demo-itx-cb-eth-sell',  ACCT_CB,  BATCH_CB,  '2024-08-15T16:45:00.000Z', 'Sell ETH',      'ETH',  'out', 0.220,     624.00, 'trade',                     'ETH',  'demo-rh-cb-eth-sell'],
		['demo-itx-cb-btc-sell',  ACCT_CB,  BATCH_CB,  '2024-01-20T09:15:00.000Z', 'Sell BTC',      'BTC',  'out', 0.018,     783.00, 'trade',                     'BTC',  'demo-rh-cb-btc-sell'],
		['demo-itx-cry-usdc-i1',  ACCT_CRY, BATCH_CRY, '2024-02-01T00:00:00.000Z', 'Earn Interest', 'USDC', 'in',  24.12,      24.12, 'crypto_earn_interest_paid', 'USDC', 'demo-rh-cry-usdc-i1'],
		['demo-itx-cry-usdc-i2',  ACCT_CRY, BATCH_CRY, '2024-05-01T00:00:00.000Z', 'Earn Interest', 'USDC', 'in',  37.84,      37.84, 'crypto_earn_interest_paid', 'USDC', 'demo-rh-cry-usdc-i2'],
		['demo-itx-cry-usdc-i3',  ACCT_CRY, BATCH_CRY, '2024-08-01T00:00:00.000Z', 'Earn Interest', 'USDC', 'in',  62.82,      62.82, 'crypto_earn_interest_paid', 'USDC', 'demo-rh-cry-usdc-i3'],
	];

	for (const [id, accountId, batchId, ts, desc, currency, direction, amount, nativeUsd, kind, symbol, rowHash] of demoTxs) {
		const source = accountId === ACCT_CB ? 'coinbase' : 'crypto_com';
		await db.execute({
			sql:  `INSERT OR IGNORE INTO import_transactions
			         (id, source, import_batch_id, account_id, tenant_id, timestamp_utc,
			          description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at)
			       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [id, source, batchId, accountId, DEMO_TENANT_ID, ts, desc, currency, amount, nativeUsd, direction, kind, symbol, rowHash, ts],
		}).catch(() => {});
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

	const lang = (request.headers.get('referer') ?? '').includes('/es') ? 'es' : 'en';
	const langCookie = `almstins-demo-lang=${lang}; Path=/; SameSite=Lax; Max-Age=3600`;

	const headers = new Headers();
	headers.append('Location', '/dashboard/vault');
	headers.append('Set-Cookie', demoCookieSet());
	headers.append('Set-Cookie', langCookie);
	return new Response(null, { status: 302, headers });
};
