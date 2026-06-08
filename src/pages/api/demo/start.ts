/**
 * GET /api/demo/start
 *
 * Wipes any existing demo data, sets the demo session cookie, and redirects
 * the visitor to the vault. Seeds 3 self-custody wallets (BTC, ETH, SOL)
 * plus Coinbase and Crypto.com exchange accounts every time.
 *
 * Performance: uses db.batch() for single-round-trip grouped inserts and
 * Promise.all() for independent phases — ~5 network round-trips vs ~60.
 */

import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { demoCookieSet, DEMO_TENANT_ID } from '../../../lib/demo';
import { db } from '../../../lib/db';
import { setCache } from '../../../lib/tursoCache';
import { getAuthSession } from '../../../lib/authSession';

type Stmt = { sql: string; args?: (string | number | null)[] };

/** Run a batch of statements in a single round-trip. Logs errors but never throws. */
const batch = async (label: string, stmts: Stmt[]): Promise<boolean> => {
	try {
		await db.batch(stmts.map((s) => ({ sql: s.sql, args: s.args ?? [] })));
		return true;
	} catch (e) {
		console.error(`[demo-seed] batch "${label}" failed:`, String(e));
		return false;
	}
};

/** Tables to clear on each new demo session (order avoids FK issues). */
const DEMO_TABLES = [
	'vault_notes',
	'wallet_defi_sync',
	'asset_lifecycle_events',
	'asset_lifecycle_groups',
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

const ADDR_BTC  = 'bc1qbtcdemo0wallet000000000000000000000000';
const ADDR_LTC  = 'ltc1qltcdemo0wallet00000000000000000000000';
const ADDR_ETH  = '0xe1000000000000000000000000000000000000e1';
const ADDR_POL  = '0xde000000000000000000000000000000000000de';
const ADDR_AVAX = '0xab000000000000000000000000000000000000ab';

const GRP_BTC  = 'DEMO-GRP-BTC-000000000000000000000001';
const GRP_LTC  = 'DEMO-GRP-LTC-000000000000000000000001';
const GRP_ETH  = 'DEMO-GRP-ETH-000000000000000000000001';
const GRP_AVAX = 'DEMO-GRP-AVX-000000000000000000000001';
const GRP_MATIC = 'DEMO-GRP-MAT-000000000000000000000001';
const GRP_CRO  = 'DEMO-GRP-CRO-000000000000000000000001';
const GRP_LUNA = 'DEMO-GRP-LUN-000000000000000000000001';
const GRP_SHIB = 'DEMO-GRP-SHI-000000000000000000000001';
const GRP_DOGE = 'DEMO-GRP-DOG-000000000000000000000001';

const BATCH_CB       = 'demo-batch-coinbase-0000000000000000000';
const BATCH_CRY      = 'demo-batch-crypto-000000000000000000000';
const BATCH_CRY_2025 = 'demo-batch-cry-2025-0000000000000000000';

export const GET: APIRoute = async ({ request }) => {
	// If the user is already authenticated, log them out first so demo mode
	// starts with a clean session — useful when showing the app to someone else.
	const session = await getAuthSession(request).catch(() => null);
	if (session?.user?.id) {
		return new Response(null, { status: 302, headers: { Location: '/api/logout?next=/api/demo/start' } });
	}

	// ── Pre-generate all UUIDs synchronously ─────────────────────────────────
	const W_BTC   = randomUUID();
	const W_ETH   = randomUUID();
	const W_POL   = randomUUID();
	const W_AVAX  = randomUUID();
	const ACCT_CB  = randomUUID();
	const ACCT_CRY = randomUUID();
	const W_CB    = randomUUID();
	const W_CRY   = randomUUID();

	// ── Phase 0: Clear all demo data (1 round-trip) ───────────────────────────
	await batch('clear', [
		...DEMO_TABLES.map((t) => ({
			sql: `DELETE FROM ${t} WHERE tenant_id = ?`,
			args: [DEMO_TENANT_ID],
		})),
		{ sql: `DELETE FROM cache WHERE cache_key = ?`, args: [`aave:health:${ADDR_ETH.toLowerCase()}`] },
		{ sql: `DELETE FROM cache WHERE cache_key = ?`, args: [`aave:health:${ADDR_AVAX.toLowerCase()}`] },
		{ sql: `DELETE FROM cache WHERE cache_key = ?`, args: [`aave:health:${ADDR_POL.toLowerCase()}`] },
		{ sql: `DELETE FROM cache WHERE cache_key = ?`, args: [`t:${DEMO_TENANT_ID}:networth:summary:v3`] },
		{ sql: `DELETE FROM cache WHERE cache_key = ?`, args: [`t:${DEMO_TENANT_ID}:networth:summary:v2`] },
	]);

	// ── Phase 1: Independent inserts + cache — all run concurrently ───────────
	// ── Demo portfolio: total wallet value ~$542 (well under $500 cap per tin) ──
	// BTC: 0.0015 × $70k = $105
	const btcTokens = [
		{ symbol: 'BTC', amount: 0.0015, priceUsd: 70_000, valueUsd: 105.00, tokenAddress: null },
	];
	// LTC: 1.5 × $80 = $120 — shares the BTC / LTC tin
	const ltcTokens = [
		{ symbol: 'LTC', amount: 1.5, priceUsd: 80, valueUsd: 120.00, tokenAddress: null },
	];
	// ETH wallet (ethereum chain): 0.018 ETH + 8 USDC = $53
	const ethTokens = [
		{ symbol: 'ETH',  amount: 0.018, priceUsd: 2_500, valueUsd: 45.00, tokenAddress: null },
		{ symbol: 'USDC', amount: 8,     priceUsd: 1,     valueUsd:  8.00, tokenAddress: null },
	];
	// Polygon wallet: WBTC + WETH + USDC = $14 + $20 + $20 = $54
	const polTokens = [
		{ symbol: 'WBTC', amount: 0.0002, priceUsd: 70_000, valueUsd: 14.00, tokenAddress: null },
		{ symbol: 'WETH', amount: 0.008,  priceUsd: 2_500,  valueUsd: 20.00, tokenAddress: null },
		{ symbol: 'USDC', amount: 20,     priceUsd: 1,      valueUsd: 20.00, tokenAddress: null },
	];
	// AVAX wallet: AVAX + USDC.e + WAVAX = $42 + $8 + $14 = $64
	// Aave V3 Avalanche: 50 USDC.e collateral, 45 USDC.e borrowed → health factor 1.05
	const avaxTokens = [
		{ symbol: 'AVAX',   amount: 1.5,  priceUsd: 28, valueUsd: 42.00, tokenAddress: null },
		{ symbol: 'USDC',   amount: 8,    priceUsd: 1,  valueUsd:  8.00, tokenAddress: null },
		{ symbol: 'WAVAX',  amount: 0.5,  priceUsd: 28, valueUsd: 14.00, tokenAddress: null },
	];

	// Aave V3 Avalanche — USDC.e collateral only, very close to liquidation
	// HF = (50 × 0.90) / 45 = 1.00 → using 1.05 with slight buffer
	const avaxAaveCachePayload = {
		ok: true,
		address: ADDR_AVAX.toLowerCase(),
		asOf: new Date().toISOString(),
		chains: {
			avalanche: {
				chainId: 43114,
				market: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
				healthFactor: 1.05,
				totalCollateralBase: 50.00,
				totalDebtBase: 45.00,
				userSupplies: [{ currency: { symbol: 'USDC' }, balance: { amount: { value: '50' } } }],
				userBorrows:  [{ currency: { symbol: 'USDC' }, debt:    { amount: { value: '45' } } }],
			},
		},
	};
	// Aave V3 Polygon — healthy position, HF 2.88 (green zone)
	// Collateral: WBTC $14 + WETH $20 + USDC $20 = $54 | Debt: 15 USDC
	const polAaveCachePayload = {
		ok: true,
		address: ADDR_POL.toLowerCase(),
		asOf: new Date().toISOString(),
		chains: {
			polygon: {
				chainId: 137,
				market: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
				healthFactor: 2.88,
				totalCollateralBase: 54.00,
				totalDebtBase: 15.00,
				userSupplies: [
					{ currency: { symbol: 'WBTC' }, balance: { amount: { value: '0.0002' } } },
					{ currency: { symbol: 'WETH' }, balance: { amount: { value: '0.008'  } } },
					{ currency: { symbol: 'USDC' }, balance: { amount: { value: '20'     } } },
				],
				userBorrows: [{ currency: { symbol: 'USDC' }, debt: { amount: { value: '15.0' } } }],
			},
		},
	};

	const cbTokens  = [{ symbol: 'USDC', amount: 85, priceUsd: 1, valueUsd: 85, tokenAddress: null }];
	const cryTokens = [{ symbol: 'USDC', amount: 72, priceUsd: 1, valueUsd: 72, tokenAddress: null }];

	// Aave V3 Ethereum — WBTC + WETH + USDC as collateral, USDC borrow
	// Collateral: 0.0003 WBTC ($21) + 0.012 WETH ($30) + 15 USDC ($15) = $66 total
	// Debt: 35 USDC | Health factor: ($66 × 0.80) / $35 ≈ 1.51
	const aaveCachePayload = {
		ok: true,
		address: ADDR_ETH.toLowerCase(),
		asOf: new Date().toISOString(),
		chains: {
			ethereum: {
				chainId: 1,
				market: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
				healthFactor: 1.51,
				totalCollateralBase: 66.00,
				totalDebtBase: 35.00,
				userSupplies: [
					{ currency: { symbol: 'WBTC' }, balance: { amount: { value: '0.0003' } } },
					{ currency: { symbol: 'WETH' }, balance: { amount: { value: '0.012'  } } },
					{ currency: { symbol: 'USDC' }, balance: { amount: { value: '15'     } } },
				],
				userBorrows: [{ currency: { symbol: 'USDC' }, debt: { amount: { value: '35.0' } } }],
			},
		},
	};

	await Promise.all([
		// 4 self-custody wallets
		batch('wallets', [
			{
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
				args: [W_BTC, DEMO_TENANT_ID, ADDR_BTC, 'BTC / LTC Cold Storage', JSON.stringify(['bitcoin', 'litecoin'])],
			},
			{
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
				args: [W_ETH, DEMO_TENANT_ID, ADDR_ETH, 'Ethereum Main', JSON.stringify(['ethereum'])],
			},
			{
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
				args: [W_POL, DEMO_TENANT_ID, ADDR_POL, 'Polygon DeFi', JSON.stringify(['polygon'])],
			},
			{
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
				args: [W_AVAX, DEMO_TENANT_ID, ADDR_AVAX, 'Avalanche DeFi', JSON.stringify(['avalanche'])],
			},
		]),

		// 8 asset lifecycle groups (no wallet dependency)
		batch('lifecycle-groups', [
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_BTC,  DEMO_TENANT_ID, 'BTC',  0.0015,     28_500, '2021-06-15T00:00:00.000Z', '2021-06-15T00:00:00.000Z', '2021-06-15T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_LTC,  DEMO_TENANT_ID, 'LTC',  1.5,           55, '2022-11-01T00:00:00.000Z', '2022-11-01T00:00:00.000Z', '2022-11-01T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_ETH,  DEMO_TENANT_ID, 'ETH',  0.018,       3_200, '2021-10-05T00:00:00.000Z', '2021-10-05T00:00:00.000Z', '2021-10-05T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_AVAX, DEMO_TENANT_ID, 'AVAX', 1.5,            18, '2024-03-10T00:00:00.000Z', '2024-03-10T00:00:00.000Z', '2024-03-10T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_MATIC,DEMO_TENANT_ID, 'POL',  300,          0.80, '2021-09-01T00:00:00.000Z', '2021-09-01T00:00:00.000Z', '2021-09-01T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_CRO,  DEMO_TENANT_ID, 'CRO',  30,           0.09, '2026-05-15T09:00:00.000Z', '2026-05-15T09:00:00.000Z', '2026-05-15T09:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_LUNA, DEMO_TENANT_ID, 'LUNA', 0,           0.035, '2022-01-01T00:00:00.000Z', '2022-01-01T00:00:00.000Z', '2022-01-01T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_SHIB, DEMO_TENANT_ID, 'SHIB', 0,         0.00008, '2021-10-29T00:00:00.000Z', '2021-10-29T00:00:00.000Z', '2021-10-29T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_DOGE, DEMO_TENANT_ID, 'DOGE', 0,            0.68, '2021-05-07T00:00:00.000Z', '2021-05-07T00:00:00.000Z', '2021-05-07T00:00:00.000Z'] },
		]),

		// 2 exchange accounts (no wallet dependency)
		batch('exchange-accounts', [
			{
				sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name, created_at)
				      VALUES (?, ?, 'coinbase', 'Coinbase', '2021-06-01T10:00:00.000Z')`,
				args: [ACCT_CB, DEMO_TENANT_ID],
			},
			{
				sql: `INSERT INTO exchange_accounts (id, tenant_id, source, name, created_at)
				      VALUES (?, ?, 'crypto_com', 'Crypto.com', '2021-06-01T10:00:00.000Z')`,
				args: [ACCT_CRY, DEMO_TENANT_ID],
			},
		]),

		// vault note (no dependency)
		batch('vault-notes', [
			{
				sql: `CREATE TABLE IF NOT EXISTS vault_notes (
					id TEXT NOT NULL PRIMARY KEY,
					tenant_id TEXT NOT NULL,
					body TEXT NOT NULL,
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					resolved_at TEXT
				)`,
			},
			{
				sql: `INSERT OR IGNORE INTO vault_notes (id, tenant_id, body, created_at) VALUES (?, ?, ?, ?)`,
				args: ['demo-note-0001', DEMO_TENANT_ID, 'sent 30 cro tokens to sis yesterday', '2026-05-15T18:42:00.000Z'],
			},
		]),

		// cache seeds (no DB dependency)
		setCache(`aave:health:${ADDR_ETH.toLowerCase()}`, aaveCachePayload, 24 * 60 * 60),
		// Avalanche Aave position — health factor 1.05, near liquidation
		setCache(`aave:health:${ADDR_AVAX.toLowerCase()}`, avaxAaveCachePayload, 24 * 60 * 60),
		// Polygon Aave position — health factor 2.88, healthy (green)
		setCache(`aave:health:${ADDR_POL.toLowerCase()}`, polAaveCachePayload, 24 * 60 * 60),
	]);

	console.log('[demo-seed] phase 1 done — wallets:', { W_BTC, W_ETH, W_POL, W_AVAX }, 'accounts:', { ACCT_CB, ACCT_CRY });

	// ── Phase 2: Things that depend on wallets/groups/accounts — all concurrent ─
	const ethDefiHealth = JSON.stringify({
		ok: true, address: ADDR_ETH,
		chains: { ethereum: { healthFactor: 1.51, totalCollateralBase: 66.00, totalDebtBase: 35.00, availableBorrowsBase: 0 } },
	});
	const ethDefiPositions = JSON.stringify({
		ok: true, address: ADDR_ETH,
		chains: { ethereum: {
			chainId: 1,
			market: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
			positions: [
				{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'WBTC', amount: 0.0003, apy: 0.009 },
				{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'WETH', amount: 0.012,  apy: 0.024 },
				{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'USDC', amount: 15,     apy: 0.048 },
				{ side: 'borrow', marketName: 'Aave V3 Ethereum', assetSymbol: 'USDC', amount: 35.00,  apy: 0.067 },
			],
		}},
	});

	await Promise.all([
		// wallet snapshots (need wallet IDs)
		batch('wallet-snapshots', [
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_BTC, 'bitcoin',  105.00, JSON.stringify(btcTokens)],
			},
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_BTC, 'litecoin', 120.00, JSON.stringify(ltcTokens)],
			},
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_ETH, 'ethereum', 53.00, JSON.stringify(ethTokens)],
			},
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_POL, 'polygon',  54.00, JSON.stringify(polTokens)],
			},
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_AVAX, 'avalanche', 64.00, JSON.stringify(avaxTokens)],
			},
		]),

		// lifecycle events (need group IDs)
		batch('lifecycle-events', [
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-btc-buy',    GRP_BTC,   '2021-06-15T14:22:00.000Z', 'in',  'wallet', 'demo-evt-btc-buy-tx',    0.0015,     42.75, '2021-06-15T14:22:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-ltc-buy',    GRP_LTC,   '2022-11-01T10:00:00.000Z', 'in',  'wallet', 'demo-evt-ltc-buy-tx',    1.5,        82.50, '2022-11-01T10:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-eth-buy',    GRP_ETH,   '2021-10-05T11:00:00.000Z', 'in',  'wallet', 'demo-evt-eth-buy-tx',    0.023,      73.60, '2021-10-05T11:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-matic-buy',  GRP_MATIC, '2021-09-01T10:00:00.000Z', 'in',  'wallet', 'demo-evt-matic-buy-tx',  500,       400.00, '2021-09-01T10:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-eth-sell',   GRP_ETH,   '2023-08-10T09:30:00.000Z', 'out', 'wallet', 'demo-evt-eth-sell-tx',   0.005,       9.00, '2023-08-10T09:30:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-matic-sell', GRP_MATIC, '2023-04-15T14:00:00.000Z', 'out', 'wallet', 'demo-evt-matic-sell-tx', 200,       300.00, '2023-04-15T14:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-avax-buy',   GRP_AVAX,  '2024-03-10T12:00:00.000Z', 'in',  'wallet', 'demo-evt-avax-buy-tx',   2.0,        36.00, '2024-03-10T12:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-avax-sell',  GRP_AVAX,  '2024-11-05T15:00:00.000Z', 'out', 'wallet', 'demo-evt-avax-sell-tx',  0.5,        12.00, '2024-11-05T15:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-cro-send',   GRP_CRO,   '2026-05-15T09:00:00.000Z', 'out', 'wallet', 'demo-evt-cro-send-tx',   30,          2.70, '2026-05-15T09:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-luna-buy',   GRP_LUNA,  '2022-01-01T10:00:00.000Z', 'in',  'wallet', 'demo-evt-luna-buy-tx',   5000,      175.00, '2022-01-01T10:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-luna-sell',  GRP_LUNA,  '2022-05-13T12:00:00.000Z', 'out', 'wallet', 'demo-evt-luna-sell-tx',  5000,        0.05, '2022-05-13T12:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-shib-buy',   GRP_SHIB,  '2021-10-29T09:00:00.000Z', 'in',  'wallet', 'demo-evt-shib-buy-tx',   10000000,  800.00, '2021-10-29T09:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-shib-sell',  GRP_SHIB,  '2022-06-30T15:00:00.000Z', 'out', 'wallet', 'demo-evt-shib-sell-tx',  10000000,  110.00, '2022-06-30T15:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-doge-buy',   GRP_DOGE,  '2021-05-07T08:00:00.000Z', 'in',  'wallet', 'demo-evt-doge-buy-tx',   2000,     1360.00, '2021-05-07T08:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-doge-sell',  GRP_DOGE,  '2022-03-01T14:00:00.000Z', 'out', 'wallet', 'demo-evt-doge-sell-tx',  2000,      160.00, '2022-03-01T14:00:00.000Z'] },
		]),

		// DeFi sync (needs W_ETH and W_AVAX)
		batch('defi-sync', [
			{
				sql: `INSERT OR REPLACE INTO wallet_defi_sync
				      (tenant_id, wallet_id, last_defi_sync_at, interest_paid_total, interest_earned_total, net_interest_total, health_payload, positions_payload, updated_at)
				      VALUES (?, ?, CURRENT_TIMESTAMP, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_ETH, ethDefiHealth, ethDefiPositions],
			},
			{
				sql: `INSERT OR REPLACE INTO wallet_defi_sync
				      (tenant_id, wallet_id, last_defi_sync_at, interest_paid_total, interest_earned_total, net_interest_total, health_payload, positions_payload, updated_at)
				      VALUES (?, ?, CURRENT_TIMESTAMP, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP)`,
				args: [
					DEMO_TENANT_ID, W_POL,
					JSON.stringify({ ok: true, address: ADDR_POL, chains: { polygon: { healthFactor: 2.88, totalCollateralBase: 54.00, totalDebtBase: 15.00, availableBorrowsBase: 0 } } }),
					JSON.stringify({ ok: true, address: ADDR_POL, chains: { polygon: {
						chainId: 137,
						market: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
						positions: [
							{ side: 'supply', marketName: 'Aave V3 Polygon', assetSymbol: 'WBTC', amount: 0.0002, apy: 0.009 },
							{ side: 'supply', marketName: 'Aave V3 Polygon', assetSymbol: 'WETH', amount: 0.008,  apy: 0.024 },
							{ side: 'supply', marketName: 'Aave V3 Polygon', assetSymbol: 'USDC', amount: 20,     apy: 0.048 },
							{ side: 'borrow', marketName: 'Aave V3 Polygon', assetSymbol: 'USDC', amount: 15.00,  apy: 0.060 },
						],
					}}}),
				],
			},
			{
				sql: `INSERT OR REPLACE INTO wallet_defi_sync
				      (tenant_id, wallet_id, last_defi_sync_at, interest_paid_total, interest_earned_total, net_interest_total, health_payload, positions_payload, updated_at)
				      VALUES (?, ?, CURRENT_TIMESTAMP, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP)`,
				args: [
					DEMO_TENANT_ID, W_AVAX,
					JSON.stringify({ ok: true, address: ADDR_AVAX, chains: { avalanche: { healthFactor: 1.05, totalCollateralBase: 50.00, totalDebtBase: 45.00, availableBorrowsBase: 0 } } }),
					JSON.stringify({ ok: true, address: ADDR_AVAX, chains: { avalanche: {
						chainId: 43114,
						market: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
						positions: [
							{ side: 'supply', marketName: 'Aave V3 Avalanche', assetSymbol: 'USDC', amount: 50, apy: 0.052 },
							{ side: 'borrow', marketName: 'Aave V3 Avalanche', assetSymbol: 'USDC', amount: 45, apy: 0.071 },
						],
					}}}),
				],
			},
		]),

		// exchange CEX wallets (need ACCT_CB, ACCT_CRY)
		batch('exchange-wallets', [
			{
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, '[]', 0, 'exchange')`,
				args: [W_CB,  DEMO_TENANT_ID, `cex:coinbase:${ACCT_CB}`,    'Coinbase'],
			},
			{
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, '[]', 0, 'exchange')`,
				args: [W_CRY, DEMO_TENANT_ID, `cex:crypto_com:${ACCT_CRY}`, 'Crypto.com'],
			},
		]),
	]);

	console.log('[demo-seed] phase 2 done — exchange wallets:', { W_CB, W_CRY });

	// ── Phase 3: Things that depend on exchange wallets — all concurrent ──────
	await Promise.all([
		// exchange wallet snapshots (need W_CB, W_CRY)
		batch('exchange-snapshots', [
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, 'exchange', ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_CB,  85, JSON.stringify(cbTokens)],
			},
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, 'exchange', ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_CRY, 72, JSON.stringify(cryTokens)],
			},
		]),

		// all import transactions (need ACCT_CB, ACCT_CRY)
		batch('import-transactions', [
			// Coinbase USDC buys
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'coinbase', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: ['demo-itx-cb-usdc-1',  BATCH_CB, ACCT_CB, DEMO_TENANT_ID, '2022-03-10T09:00:00.000Z', 'Buy USDC', 'USDC', 150, 150, 'in', 'trade', 'USDC', 'demo-rh-cb-usdc-1',  '2022-03-10T09:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'coinbase', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: ['demo-itx-cb-usdc-2',  BATCH_CB, ACCT_CB, DEMO_TENANT_ID, '2023-07-22T14:30:00.000Z', 'Buy USDC', 'USDC',  65,  65, 'in', 'trade', 'USDC', 'demo-rh-cb-usdc-2',  '2023-07-22T14:30:00.000Z'] },
			// Crypto.com interest income
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'crypto_com', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: ['demo-itx-cry-usdc-i1', BATCH_CRY, ACCT_CRY, DEMO_TENANT_ID, '2024-02-01T00:00:00.000Z', 'Earn Interest', 'USDC', 24.12, 24.12, 'in', 'crypto_earn_interest_paid', 'USDC', 'demo-rh-cry-usdc-i1', '2024-02-01T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'crypto_com', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: ['demo-itx-cry-usdc-i2', BATCH_CRY, ACCT_CRY, DEMO_TENANT_ID, '2024-05-01T00:00:00.000Z', 'Earn Interest', 'USDC', 37.84, 37.84, 'in', 'crypto_earn_interest_paid', 'USDC', 'demo-rh-cry-usdc-i2', '2024-05-01T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'crypto_com', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: ['demo-itx-cry-usdc-i3', BATCH_CRY, ACCT_CRY, DEMO_TENANT_ID, '2024-08-01T00:00:00.000Z', 'Earn Interest', 'USDC', 62.82, 62.82, 'in', 'crypto_earn_interest_paid', 'USDC', 'demo-rh-cry-usdc-i3', '2024-08-01T00:00:00.000Z'] },
			// AVAX staking income
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'wallet', ?, NULL, ?, ?, 'Staking Reward', 'AVAX', ?, ?, 'in', 'Staking Income', 'AVAX', ?, ?)`, args: ['demo-itx-avax-stk-1', 'demo-batch-avax-staking-000000000000000', DEMO_TENANT_ID, '2024-05-01T00:00:00.000Z', 0.12, 2.16, 'demo-rh-avax-stk-1', '2024-05-01T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'wallet', ?, NULL, ?, ?, 'Staking Reward', 'AVAX', ?, ?, 'in', 'Staking Income', 'AVAX', ?, ?)`, args: ['demo-itx-avax-stk-2', 'demo-batch-avax-staking-000000000000000', DEMO_TENANT_ID, '2024-08-01T00:00:00.000Z', 0.10, 1.80, 'demo-rh-avax-stk-2', '2024-08-01T00:00:00.000Z'] },
			// Crypto.com 2025 continuation
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'crypto_com', ?, ?, ?, ?, 'Earn Interest', 'USDC', ?, ?, 'in', 'crypto_earn_interest_paid', 'USDC', ?, ?)`, args: ['demo-itx-cry-2025-1', BATCH_CRY_2025, ACCT_CRY, DEMO_TENANT_ID, '2025-02-01T00:00:00.000Z', 41.56, 41.56, 'demo-rh-cry-2025-1', '2025-02-01T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'crypto_com', ?, ?, ?, ?, 'Earn Interest', 'USDC', ?, ?, 'in', 'crypto_earn_interest_paid', 'USDC', ?, ?)`, args: ['demo-itx-cry-2025-2', BATCH_CRY_2025, ACCT_CRY, DEMO_TENANT_ID, '2025-05-01T00:00:00.000Z', 38.92, 38.92, 'demo-rh-cry-2025-2', '2025-05-01T00:00:00.000Z'] },
		]),
	]);

	// ── Phase 4: Analytics (fire and forget) ──────────────────────────────────
	const ua       = request.headers.get('user-agent') ?? null;
	const referrer = request.headers.get('referer')    ?? null;
	db.execute({ sql: `INSERT INTO demo_sessions (user_agent, referrer) VALUES (?, ?)`, args: [ua, referrer] })
		.catch((e) => console.error('[demo-seed] analytics insert failed:', String(e)));

	console.log('[demo-seed] seeding complete');

	// ── Debug mode ────────────────────────────────────────────────────────────
	const url = new URL(request.url);
	if (url.searchParams.get('debug') === '1') {
		const walletRows = await db.execute({
			sql: `SELECT id, address, label, wallet_type FROM wallets WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20`,
			args: [DEMO_TENANT_ID],
		}).catch(() => ({ rows: [] }));
		const snapshotRows = await db.execute({
			sql: `SELECT wallet_id, chain, totals_usd FROM wallet_snapshots WHERE tenant_id = ? LIMIT 20`,
			args: [DEMO_TENANT_ID],
		}).catch(() => ({ rows: [] }));
		return new Response(JSON.stringify({
			wallets: walletRows.rows,
			snapshots: snapshotRows.rows,
			walletCount: walletRows.rows.length,
			snapshotCount: snapshotRows.rows.length,
		}, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
	}

	// ── Seed PetroTins sample data for demo tenant ──────────────────────────
	const SAMPLE = '__sample__';
	const thisMonth = (d: number) => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
	};
	await db.batch([
		{ sql: `CREATE TABLE IF NOT EXISTS petro_tins (id TEXT NOT NULL PRIMARY KEY, tenant_id TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'debt', name TEXT NOT NULL, balance REAL, credit_limit REAL, apr REAL, min_payment REAL, goal_revenue REAL, notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
		{ sql: `DELETE FROM petro_tins WHERE tenant_id = ?`, args: [DEMO_TENANT_ID] },
	]).catch(() => {});
	const budgetId = randomUUID();
	const bizId = randomUUID();
	const cards = [
		{ name: 'Chase Freedom',           balance: 247.83, limit: 3000, apr: 0.2499, min: 25 },
		{ name: 'Capital One Quicksilver', balance: 183.41, limit: 2500, apr: 0.2999, min: 25 },
		{ name: 'Citi Double Cash',        balance: 298.17, limit: 5000, apr: 0.2199, min: 25 },
		{ name: 'Discover it',             balance: 156.55, limit: 2000, apr: 0.2724, min: 25 },
		{ name: 'Amex Blue Cash',          balance: 289.22, limit: 6000, apr: 0.1999, min: 25 },
	];
	const tinStmts = [
		...cards.map((c, i) => ({
			sql: `INSERT INTO petro_tins (id, tenant_id, type, name, balance, credit_limit, apr, min_payment, notes, sort_order) VALUES (?, ?, 'debt', ?, ?, ?, ?, ?, ?, ?)`,
			args: [randomUUID(), DEMO_TENANT_ID, c.name, c.balance, c.limit, c.apr, c.min, SAMPLE, i],
		})),
		{ sql: `INSERT INTO petro_tins (id, tenant_id, type, name, notes, sort_order) VALUES (?, ?, 'budget', 'Home Budget', ?, 10)`, args: [budgetId, DEMO_TENANT_ID, SAMPLE] },
		{ sql: `INSERT INTO petro_tins (id, tenant_id, type, name, goal_revenue, notes, sort_order) VALUES (?, ?, 'business', 'Side Business', 1500, ?, 20)`, args: [bizId, DEMO_TENANT_ID, SAMPLE] },
	];
	await db.batch(tinStmts).catch(() => {});
	// Entries
	await db.batch([
		{ sql: `CREATE TABLE IF NOT EXISTS petro_tin_entries (id TEXT NOT NULL PRIMARY KEY, tin_id TEXT NOT NULL, tenant_id TEXT NOT NULL, entry_date TEXT NOT NULL, kind TEXT NOT NULL, amount REAL NOT NULL, description TEXT, splits_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
		{ sql: `DELETE FROM petro_tin_entries WHERE tenant_id = ?`, args: [DEMO_TENANT_ID] },
	]).catch(() => {});
	const entryStmts = [
		{ sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description) VALUES (?, ?, ?, ?, 'income', 5000, 'Paycheck')`,         args: [randomUUID(), budgetId, DEMO_TENANT_ID, thisMonth(1)] },
		{ sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description) VALUES (?, ?, ?, ?, 'income', 1500, 'Business income')`,   args: [randomUUID(), budgetId, DEMO_TENANT_ID, thisMonth(3)] },
		{ sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description) VALUES (?, ?, ?, ?, 'expense', 1000, 'Rent')`,             args: [randomUUID(), budgetId, DEMO_TENANT_ID, thisMonth(2)] },
		{ sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description) VALUES (?, ?, ?, ?, 'expense', 1500, 'Crypto placeholder')`, args: [randomUUID(), budgetId, DEMO_TENANT_ID, thisMonth(5)] },
		{ sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description) VALUES (?, ?, ?, ?, 'income', 1500, 'Monthly revenue')`,   args: [randomUUID(), bizId, DEMO_TENANT_ID, thisMonth(3)] },
		{ sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description) VALUES (?, ?, ?, ?, 'expense', 120, 'Software subscriptions')`, args: [randomUUID(), bizId, DEMO_TENANT_ID, thisMonth(4)] },
		{ sql: `INSERT INTO petro_tin_entries (id, tin_id, tenant_id, entry_date, kind, amount, description) VALUES (?, ?, ?, ?, 'expense', 45, 'Domain & hosting')`,   args: [randomUUID(), bizId, DEMO_TENANT_ID, thisMonth(4)] },
	];
	await db.batch(entryStmts).catch(() => {});

	const lang = (request.headers.get('referer') ?? '').includes('/es') ? 'es' : 'en';
	const langCookie = `almstins-demo-lang=${lang}; Path=/; SameSite=Lax; Max-Age=3600`;

	// Respect ?next= param for PetroTins demo link; whitelist internal paths only
	const nextParam = url.searchParams.get('next') ?? '';
	const destination = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard/vault';

	const headers = new Headers();
	headers.append('Location', destination);
	headers.append('Set-Cookie', demoCookieSet());
	headers.append('Set-Cookie', langCookie);
	return new Response(null, { status: 302, headers });
};
