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

const ADDR_BTC = 'bc1qbtcdemo0wallet000000000000000000000000';
const ADDR_ETH  = '0xe1000000000000000000000000000000000000e1';
const ADDR_SOL  = 'demolsolwallet1111111111111111111111111111';

const GRP_BTC  = 'DEMO-GRP-BTC-000000000000000000000001';
const GRP_ETH  = 'DEMO-GRP-ETH-000000000000000000000001';
const GRP_SOL  = 'DEMO-GRP-SOL-000000000000000000000001';
const GRP_MATIC = 'DEMO-GRP-MAT-000000000000000000000001';
const GRP_CRO  = 'DEMO-GRP-CRO-000000000000000000000001';
const GRP_LUNA = 'DEMO-GRP-LUN-000000000000000000000001';
const GRP_SHIB = 'DEMO-GRP-SHI-000000000000000000000001';
const GRP_DOGE = 'DEMO-GRP-DOG-000000000000000000000001';

const BATCH_CB          = 'demo-batch-coinbase-0000000000000000000';
const BATCH_CRY         = 'demo-batch-crypto-000000000000000000000';
const BATCH_SOL_STAKING = 'demo-batch-sol-staking-00000000000000000';
const BATCH_CRY_2025    = 'demo-batch-cry-2025-0000000000000000000';

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
	const W_SOL   = randomUUID();
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
		{ sql: `DELETE FROM cache WHERE cache_key = ?`, args: [`t:${DEMO_TENANT_ID}:networth:summary:v3`] },
		{ sql: `DELETE FROM cache WHERE cache_key = ?`, args: [`t:${DEMO_TENANT_ID}:networth:summary:v2`] },
	]);

	// ── Phase 1: Independent inserts + cache — all run concurrently ───────────
	const btcTokens = [
		{ symbol: 'BTC', amount: 0.00085, priceUsd: 70_000, valueUsd: 59.50, tokenAddress: null },
	];
	const ethTokens = [
		{ symbol: 'ETH',  amount: 0.025, priceUsd: 2_500, valueUsd: 62.50, tokenAddress: null },
		{ symbol: 'USDC', amount: 15,    priceUsd: 1,     valueUsd: 15.00, tokenAddress: null },
	];
	const solTokens = [
		{ symbol: 'SOL',  amount: 0.52,  priceUsd: 145,   valueUsd: 75.40, tokenAddress: null },
		{ symbol: 'USDC', amount: 5,     priceUsd: 1,     valueUsd: 5.00,  tokenAddress: null },
	];
	const cbTokens  = [{ symbol: 'USDC', amount: 215,    priceUsd: 1, valueUsd: 215,    tokenAddress: null }];
	const cryTokens = [{ symbol: 'USDC', amount: 124.78, priceUsd: 1, valueUsd: 124.78, tokenAddress: null }];

	const aaveCachePayload = {
		ok: true,
		address: ADDR_ETH.toLowerCase(),
		asOf: new Date().toISOString(),
		chains: {
			ethereum: {
				chainId: 1,
				market: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
				healthFactor: 1.15,
				totalCollateralBase: 62.50,
				totalDebtBase: 54.35,
				userSupplies: [{ currency: { symbol: 'WETH' }, balance: { amount: { value: '0.025' } } }],
				userBorrows:  [{ currency: { symbol: 'USDC' }, debt:    { amount: { value: '20.0'  } } }],
			},
		},
	};

	await Promise.all([
		// 3 self-custody wallets
		batch('wallets', [
			{
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
				args: [W_BTC, DEMO_TENANT_ID, ADDR_BTC, 'Bitcoin Cold Storage', JSON.stringify(['bitcoin'])],
			},
			{
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
				args: [W_ETH, DEMO_TENANT_ID, ADDR_ETH, 'Ethereum Main', JSON.stringify(['ethereum', 'polygon', 'avalanche'])],
			},
			{
				sql: `INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
				      VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
				args: [W_SOL, DEMO_TENANT_ID, ADDR_SOL, 'Solana Wallet', JSON.stringify(['solana'])],
			},
		]),

		// 8 asset lifecycle groups (no wallet dependency)
		batch('lifecycle-groups', [
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_BTC,  DEMO_TENANT_ID, 'BTC',  0.00085,    28_500, '2021-06-15T00:00:00.000Z', '2021-06-15T00:00:00.000Z', '2021-06-15T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_ETH,  DEMO_TENANT_ID, 'ETH',  0.025,       3_200, '2021-10-05T00:00:00.000Z', '2021-10-05T00:00:00.000Z', '2021-10-05T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_groups (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [GRP_SOL,  DEMO_TENANT_ID, 'SOL',  0.52,          165, '2024-06-01T00:00:00.000Z', '2024-06-01T00:00:00.000Z', '2024-06-01T00:00:00.000Z'] },
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
		setCache(`solana-defi:${W_SOL}`, {
			protocols: ['Kamino Finance', 'Native Staking'],
			recentPrograms: [
				{ programId: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', name: 'Kamino Finance' },
				{ programId: 'pytS9TFNez6VM5kMon3apkp9zsEFXDfNnGFZ2aSbKbE', name: 'Pyth Staking' },
				{ programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', name: 'Jupiter' },
			],
		}, 24 * 60 * 60),
	]);

	console.log('[demo-seed] phase 1 done — wallets:', { W_BTC, W_ETH, W_SOL }, 'accounts:', { ACCT_CB, ACCT_CRY });

	// ── Phase 2: Things that depend on wallets/groups/accounts — all concurrent ─
	const ethDefiHealth = JSON.stringify({
		ok: true, address: ADDR_ETH,
		chains: { ethereum: { healthFactor: 1.15, totalCollateralBase: 62.50, totalDebtBase: 54.35, availableBorrowsBase: 0 } },
	});
	const ethDefiPositions = JSON.stringify({
		ok: true, address: ADDR_ETH,
		chains: { ethereum: {
			chainId: 1,
			market: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
			positions: [
				{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'WETH', amount: 0.025, apy: 0.024 },
				{ side: 'borrow', marketName: 'Aave V3 Ethereum', assetSymbol: 'USDC', amount: 20.00, apy: 0.067 },
			],
		}},
	});

	await Promise.all([
		// wallet snapshots (need wallet IDs)
		batch('wallet-snapshots', [
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_BTC, 'bitcoin',  59.50, JSON.stringify(btcTokens)],
			},
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_ETH, 'ethereum', 77.50, JSON.stringify(ethTokens)],
			},
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_SOL, 'solana',   80.40, JSON.stringify(solTokens)],
			},
		]),

		// lifecycle events (need group IDs)
		batch('lifecycle-events', [
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-btc-buy',    GRP_BTC,   '2021-06-15T14:22:00.000Z', 'in',  'wallet', 'demo-evt-btc-buy-tx',    0.00085,    24.23, '2021-06-15T14:22:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-eth-buy',    GRP_ETH,   '2021-10-05T11:00:00.000Z', 'in',  'wallet', 'demo-evt-eth-buy-tx',    0.030,      96.00, '2021-10-05T11:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-matic-buy',  GRP_MATIC, '2021-09-01T10:00:00.000Z', 'in',  'wallet', 'demo-evt-matic-buy-tx',  500,       400.00, '2021-09-01T10:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-eth-sell',   GRP_ETH,   '2023-08-10T09:30:00.000Z', 'out', 'wallet', 'demo-evt-eth-sell-tx',   0.005,       9.00, '2023-08-10T09:30:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-matic-sell', GRP_MATIC, '2023-04-15T14:00:00.000Z', 'out', 'wallet', 'demo-evt-matic-sell-tx', 200,       300.00, '2023-04-15T14:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-sol-buy',    GRP_SOL,   '2024-06-01T12:00:00.000Z', 'in',  'wallet', 'demo-evt-sol-buy-tx',    0.62,      102.30, '2024-06-01T12:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-sol-sell',   GRP_SOL,   '2024-09-20T15:00:00.000Z', 'out', 'wallet', 'demo-evt-sol-sell-tx',   0.10,       13.00, '2024-09-20T15:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-cro-send',   GRP_CRO,   '2026-05-15T09:00:00.000Z', 'out', 'wallet', 'demo-evt-cro-send-tx',   30,          2.70, '2026-05-15T09:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-luna-buy',   GRP_LUNA,  '2022-01-01T10:00:00.000Z', 'in',  'wallet', 'demo-evt-luna-buy-tx',   5000,      175.00, '2022-01-01T10:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-luna-sell',  GRP_LUNA,  '2022-05-13T12:00:00.000Z', 'out', 'wallet', 'demo-evt-luna-sell-tx',  5000,        0.05, '2022-05-13T12:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-shib-buy',   GRP_SHIB,  '2021-10-29T09:00:00.000Z', 'in',  'wallet', 'demo-evt-shib-buy-tx',   10000000,  800.00, '2021-10-29T09:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-shib-sell',  GRP_SHIB,  '2022-06-30T15:00:00.000Z', 'out', 'wallet', 'demo-evt-shib-sell-tx',  10000000,  110.00, '2022-06-30T15:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-doge-buy',   GRP_DOGE,  '2021-05-07T08:00:00.000Z', 'in',  'wallet', 'demo-evt-doge-buy-tx',   2000,     1360.00, '2021-05-07T08:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO asset_lifecycle_events (id, tenant_id, group_id, source_type, source_id, timestamp_utc, direction, amount, native_usd, transaction_class, linked_transfer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`, args: ['demo-evt-doge-sell',  GRP_DOGE,  '2022-03-01T14:00:00.000Z', 'out', 'wallet', 'demo-evt-doge-sell-tx',  2000,      160.00, '2022-03-01T14:00:00.000Z'] },
		]),

		// DeFi sync (needs W_ETH)
		batch('defi-sync', [
			{
				sql: `INSERT OR REPLACE INTO wallet_defi_sync
				      (tenant_id, wallet_id, last_defi_sync_at, interest_paid_total, interest_earned_total, net_interest_total, health_payload, positions_payload, updated_at)
				      VALUES (?, ?, CURRENT_TIMESTAMP, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_ETH, ethDefiHealth, ethDefiPositions],
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
				args: [DEMO_TENANT_ID, W_CB,  215,    JSON.stringify(cbTokens)],
			},
			{
				sql: `INSERT INTO wallet_snapshots (tenant_id, wallet_id, chain, totals_usd, collateral_usd, debt_usd, collateral_apy_pct, borrow_apy_pct, net_rate_pct, payload_json, captured_at)
				      VALUES (?, ?, 'exchange', ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
				args: [DEMO_TENANT_ID, W_CRY, 124.78, JSON.stringify(cryTokens)],
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
			// SOL staking income
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'wallet', ?, NULL, ?, ?, 'Staking Reward', 'SOL', ?, ?, 'in', 'Staking Income', 'SOL', ?, ?)`, args: ['demo-itx-sol-stk-1', BATCH_SOL_STAKING, DEMO_TENANT_ID, '2024-04-15T00:00:00.000Z', 0.032,  6.50, 'demo-rh-sol-stk-1', '2024-04-15T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'wallet', ?, NULL, ?, ?, 'Staking Reward', 'SOL', ?, ?, 'in', 'Staking Income', 'SOL', ?, ?)`, args: ['demo-itx-sol-stk-2', BATCH_SOL_STAKING, DEMO_TENANT_ID, '2024-08-01T00:00:00.000Z', 0.028,  5.40, 'demo-rh-sol-stk-2', '2024-08-01T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'wallet', ?, NULL, ?, ?, 'Staking Reward', 'SOL', ?, ?, 'in', 'Staking Income', 'SOL', ?, ?)`, args: ['demo-itx-sol-stk-3', BATCH_SOL_STAKING, DEMO_TENANT_ID, '2024-11-15T00:00:00.000Z', 0.035,  7.20, 'demo-rh-sol-stk-3', '2024-11-15T00:00:00.000Z'] },
			{ sql: `INSERT OR IGNORE INTO import_transactions (id, source, import_batch_id, account_id, tenant_id, timestamp_utc, description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at) VALUES (?, 'wallet', ?, NULL, ?, ?, 'Staking Reward', 'SOL', ?, ?, 'in', 'Staking Income', 'SOL', ?, ?)`, args: ['demo-itx-sol-stk-4', BATCH_SOL_STAKING, DEMO_TENANT_ID, '2025-03-01T00:00:00.000Z', 0.029,  6.10, 'demo-rh-sol-stk-4', '2025-03-01T00:00:00.000Z'] },
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

	const lang = (request.headers.get('referer') ?? '').includes('/es') ? 'es' : 'en';
	const langCookie = `almstins-demo-lang=${lang}; Path=/; SameSite=Lax; Max-Age=3600`;

	const headers = new Headers();
	headers.append('Location', '/dashboard/vault');
	headers.append('Set-Cookie', demoCookieSet());
	headers.append('Set-Cookie', langCookie);
	return new Response(null, { status: 302, headers });
};
