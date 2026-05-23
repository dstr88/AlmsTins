/**
 * GET /api/demo/start
 *
 * Wipes any existing demo data, sets the demo session cookie, and redirects
 * the visitor to the vault. Seeds 3 self-custody wallets (BTC, ETH, SOL)
 * plus Coinbase and Crypto.com exchange accounts every time.
 */

import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { demoCookieSet, DEMO_TENANT_ID } from '../../../lib/demo';
import { db } from '../../../lib/db';
import { setCache } from '../../../lib/tursoCache';
import { getAuthSession } from '../../../lib/authSession';

const makeExec = (errors: string[]) =>
	async (sql: string, args: (string | number | null)[] = []) => {
		try {
			return await db.execute({ sql, args });
		} catch (e: unknown) {
			const msg = `SQL error: ${String(e)} | SQL: ${sql.slice(0, 120)}`;
			console.error('[demo-seed]', msg);
			errors.push(msg);
			return null;
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
	// If the user is already authenticated, skip demo mode entirely.
	const session = await getAuthSession(request).catch(() => null);
	if (session?.user?.id) {
		return new Response(null, { status: 302, headers: { Location: '/dashboard/vault' } });
	}

	const errors: string[] = [];
	const exec = makeExec(errors);

	// ── 0. Clear ──────────────────────────────────────────────────────────────
	for (const table of DEMO_TABLES) {
		await exec(`DELETE FROM ${table} WHERE tenant_id = ?`, [DEMO_TENANT_ID]);
	}
	// Clear stale caches that could mask freshly seeded data.
	await exec(`DELETE FROM cache WHERE cache_key = ?`, [`aave:health:${ADDR_ETH.toLowerCase()}`]);
	await exec(`DELETE FROM cache WHERE cache_key = ?`, [`t:${DEMO_TENANT_ID}:networth:summary:v3`]);
	await exec(`DELETE FROM cache WHERE cache_key = ?`, [`t:${DEMO_TENANT_ID}:networth:summary:v2`]);

	// ── 1. Seed notepad ───────────────────────────────────────────────────────
	await exec(`CREATE TABLE IF NOT EXISTS vault_notes (
		id TEXT NOT NULL PRIMARY KEY,
		tenant_id TEXT NOT NULL,
		body TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		resolved_at TEXT
	)`);
	await exec(
		`INSERT OR IGNORE INTO vault_notes (id, tenant_id, body, created_at) VALUES (?, ?, ?, ?)`,
		['demo-note-0001', DEMO_TENANT_ID, 'sent 30 cro tokens to sis yesterday', '2026-05-15T18:42:00.000Z'],
	);

	// ── 2. Three self-custody wallets ─────────────────────────────────────────
	// Provide explicit UUIDs — wallets.id is TEXT PRIMARY KEY with no guarantee of auto-gen.
	// Use is_default and wallet_type since both columns exist (migration 0020).
	const W_BTC = randomUUID();
	const W_ETH = randomUUID();
	const W_SOL = randomUUID();

	await exec(
		`INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		 VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
		[W_BTC, DEMO_TENANT_ID, ADDR_BTC, 'Bitcoin Cold Storage', JSON.stringify(['bitcoin'])],
	);
	await exec(
		`INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		 VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
		[W_ETH, DEMO_TENANT_ID, ADDR_ETH, 'Ethereum Main', JSON.stringify(['ethereum', 'polygon', 'avalanche'])],
	);
	await exec(
		`INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		 VALUES (?, ?, ?, ?, ?, 0, 'onchain')`,
		[W_SOL, DEMO_TENANT_ID, ADDR_SOL, 'Solana Wallet', JSON.stringify(['solana'])],
	);

	console.log('[demo-seed] wallet IDs:', { W_BTC, W_ETH, W_SOL });

	// ── 3. Wallet snapshots (token holdings) ──────────────────────────────────
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

	await exec(
		`INSERT INTO wallet_snapshots
		   (tenant_id, wallet_id, chain, totals_usd,
		    collateral_usd, debt_usd, collateral_apy_pct,
		    borrow_apy_pct, net_rate_pct, payload_json, captured_at)
		 VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
		[DEMO_TENANT_ID, W_BTC, 'bitcoin', 59.50, JSON.stringify(btcTokens)],
	);
	await exec(
		`INSERT INTO wallet_snapshots
		   (tenant_id, wallet_id, chain, totals_usd,
		    collateral_usd, debt_usd, collateral_apy_pct,
		    borrow_apy_pct, net_rate_pct, payload_json, captured_at)
		 VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
		[DEMO_TENANT_ID, W_ETH, 'ethereum', 77.50, JSON.stringify(ethTokens)],
	);
	await exec(
		`INSERT INTO wallet_snapshots
		   (tenant_id, wallet_id, chain, totals_usd,
		    collateral_usd, debt_usd, collateral_apy_pct,
		    borrow_apy_pct, net_rate_pct, payload_json, captured_at)
		 VALUES (?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
		[DEMO_TENANT_ID, W_SOL, 'solana', 80.40, JSON.stringify(solTokens)],
	);

	// ── 4. Asset lifecycle groups ─────────────────────────────────────────────
	const groups: [string, string, number, number, string][] = [
		[GRP_BTC,   'BTC',  0.00085, 28_500, '2021-06-15T00:00:00.000Z'],
		[GRP_ETH,   'ETH',  0.025,    3_200, '2021-10-05T00:00:00.000Z'],
		[GRP_SOL,   'SOL',  0.52,       165, '2024-06-01T00:00:00.000Z'],
		// MATIC: bought via ETH wallet (Polygon chain) — 300 remaining after selling 200
		[GRP_MATIC, 'POL',  300,        0.80,    '2021-09-01T00:00:00.000Z'],
		// CRO: only an outbound transfer (sent to family member) — no tracked buy → Needs Attention
		[GRP_CRO,   'CRO',  30,         0.09,    '2026-05-15T09:00:00.000Z'],
		// Tuition coins — fully exited, Grade F, Hall of Fame 🎓
		[GRP_LUNA,  'LUNA', 0,          0.035,   '2022-01-01T00:00:00.000Z'],
		[GRP_SHIB,  'SHIB', 0,          0.00008, '2021-10-29T00:00:00.000Z'],
		[GRP_DOGE,  'DOGE', 0,          0.68,    '2021-05-07T00:00:00.000Z'],
	];
	for (const [id, symbol, qty, avgCost, acqAt] of groups) {
		await exec(
			`INSERT OR IGNORE INTO asset_lifecycle_groups
			   (id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd,
			    latest_acquired_at, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, DEMO_TENANT_ID, symbol, qty, avgCost, acqAt, acqAt, acqAt],
		);
	}

	// ── 5. Asset lifecycle events ─────────────────────────────────────────────
	const events: [string, string, string, string, string, number, number][] = [
		// BTC: buy 0.00085 @ $28,500 = $24.23  (long-term, no sell)
		['demo-evt-btc-buy',   GRP_BTC,   '2021-06-15T14:22:00.000Z', 'in',  'wallet', 0.00085, 24.23],
		// ETH: buy 0.030 @ $3,200 = $96.00
		['demo-evt-eth-buy',   GRP_ETH,   '2021-10-05T11:00:00.000Z', 'in',  'wallet', 0.030,   96.00],
		// MATIC (POL): buy 500 @ $0.80 = $400  (Polygon via ETH wallet)
		['demo-evt-matic-buy', GRP_MATIC, '2021-09-01T10:00:00.000Z', 'in',  'wallet', 500,    400.00],
		// ETH: sell 0.005 @ $1,800 = $9.00 (LT loss — cost basis $16, held 670 days)
		['demo-evt-eth-sell',  GRP_ETH,   '2023-08-10T09:30:00.000Z', 'out', 'wallet', 0.005,    9.00],
		// MATIC (POL): sell 200 @ $1.50 = $300  (LT gain — cost $160, gain +$140, held 591 days)
		['demo-evt-matic-sell',GRP_MATIC, '2023-04-15T14:00:00.000Z', 'out', 'wallet', 200,    300.00],
		// SOL: buy 0.62 @ $165 = $102.30
		['demo-evt-sol-buy',   GRP_SOL,   '2024-06-01T12:00:00.000Z', 'in',  'wallet', 0.62,   102.30],
		// SOL: sell 0.10 @ $130 = $13.00 (ST loss — cost $16.50, held 111 days)
		['demo-evt-sol-sell',  GRP_SOL,   '2024-09-20T15:00:00.000Z', 'out', 'wallet', 0.10,    13.00],
		// CRO: sent 30 to family member — no tracked purchase → shows in Needs Attention (matches vault note)
		['demo-evt-cro-send',  GRP_CRO,   '2026-05-15T09:00:00.000Z', 'out', 'wallet', 30,        2.70],
		// ── Tuition coins — bought high, exited low, fully graduated 🎓 ──────
		// LUNA: bought before the collapse, sold day of the depeg
		['demo-evt-luna-buy',  GRP_LUNA,  '2022-01-01T10:00:00.000Z', 'in',  'wallet', 5000,    175.00],
		['demo-evt-luna-sell', GRP_LUNA,  '2022-05-13T12:00:00.000Z', 'out', 'wallet', 5000,      0.05],
		// SHIB: bought near all-time-high, sold 8 months later
		['demo-evt-shib-buy',  GRP_SHIB,  '2021-10-29T09:00:00.000Z', 'in',  'wallet', 10000000, 800.00],
		['demo-evt-shib-sell', GRP_SHIB,  '2022-06-30T15:00:00.000Z', 'out', 'wallet', 10000000, 110.00],
		// DOGE: bought during the Elon pump, sold 10 months later
		['demo-evt-doge-buy',  GRP_DOGE,  '2021-05-07T08:00:00.000Z', 'in',  'wallet', 2000,   1360.00],
		['demo-evt-doge-sell', GRP_DOGE,  '2022-03-01T14:00:00.000Z', 'out', 'wallet', 2000,    160.00],
	];
	for (const [id, groupId, ts, direction, sourceType, amount, nativeUsd] of events) {
		await exec(
			`INSERT OR IGNORE INTO asset_lifecycle_events
			   (id, tenant_id, group_id, source_type, source_id, timestamp_utc,
			    direction, amount, native_usd, transaction_class, linked_transfer, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'trade', 0, ?)`,
			[id, DEMO_TENANT_ID, groupId, sourceType, id + '-tx', ts, direction, amount, nativeUsd, ts],
		);
	}

	// ── 6. ETH wallet DeFi position (Aave V3 Ethereum) ───────────────────────
	// Seed wallet_defi_sync for the sync history record
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
	await exec(
		`INSERT OR REPLACE INTO wallet_defi_sync
		   (tenant_id, wallet_id, last_defi_sync_at, interest_paid_total,
		    interest_earned_total, net_interest_total, health_payload, positions_payload, updated_at)
		 VALUES (?, ?, CURRENT_TIMESTAMP, 0, 0, 0, ?, ?, CURRENT_TIMESTAMP)`,
		[DEMO_TENANT_ID, W_ETH, ethDefiHealth, ethDefiPositions],
	);

	// Seed the Aave health cache so AaveHealthSummary shows demo DeFi data
	// without hitting the live Aave GraphQL API (fake address has no live positions).
	// Format matches exactly what /api/aave/health returns.
	const aaveCacheKey = `aave:health:${ADDR_ETH.toLowerCase()}`;
	await setCache(aaveCacheKey, {
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
				userSupplies: [
					{
						currency: { symbol: 'WETH' },
						balance: { amount: { value: '0.025' } },
					},
				],
				userBorrows: [
					{
						currency: { symbol: 'USDC' },
						debt: { amount: { value: '20.0' } },
					},
				],
			},
		},
	}, 24 * 60 * 60); // 24h TTL — prevents background refresh from overwriting demo data
	console.log('[demo-seed] Aave health cache seeded for', aaveCacheKey);

	// Seed Solana DeFi cache so SolanaDefiSummary shows demo protocol data
	await setCache(`solana-defi:${W_SOL}`, {
		protocols: ['Kamino Finance', 'Native Staking'],
		recentPrograms: [
			{ programId: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD', name: 'Kamino Finance' },
			{ programId: 'pytS9TFNez6VM5kMon3apkp9zsEFXDfNnGFZ2aSbKbE', name: 'Pyth Staking' },
			{ programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', name: 'Jupiter' },
		],
	}, 24 * 60 * 60);
	console.log('[demo-seed] Solana DeFi cache seeded for wallet', W_SOL);

	// ── 7. Exchange accounts — explicit UUIDs required (id TEXT PRIMARY KEY, no default) ──
	const ACCT_CB  = randomUUID();
	const ACCT_CRY = randomUUID();

	await exec(
		`INSERT INTO exchange_accounts (id, tenant_id, source, name, created_at)
		 VALUES (?, ?, 'coinbase', 'Coinbase', '2021-06-01T10:00:00.000Z')`,
		[ACCT_CB, DEMO_TENANT_ID],
	);
	await exec(
		`INSERT INTO exchange_accounts (id, tenant_id, source, name, created_at)
		 VALUES (?, ?, 'crypto_com', 'Crypto.com', '2021-06-01T10:00:00.000Z')`,
		[ACCT_CRY, DEMO_TENANT_ID],
	);

	console.log('[demo-seed] exchange IDs:', { ACCT_CB, ACCT_CRY });

	// ── CEX wallets + snapshots (so portfolio total includes exchange balances) ──
	// Coinbase: net ~$215 USDC after buys
	const W_CB  = randomUUID();
	const W_CRY = randomUUID();

	await exec(
		`INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		 VALUES (?, ?, ?, ?, '[]', 0, 'exchange')`,
		[W_CB, DEMO_TENANT_ID, `cex:coinbase:${ACCT_CB}`, 'Coinbase'],
	);
	await exec(
		`INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type)
		 VALUES (?, ?, ?, ?, '[]', 0, 'exchange')`,
		[W_CRY, DEMO_TENANT_ID, `cex:crypto_com:${ACCT_CRY}`, 'Crypto.com'],
	);

	const cbTokens  = [{ symbol: 'USDC', amount: 215, priceUsd: 1, valueUsd: 215, tokenAddress: null }];
	const cryTokens = [{ symbol: 'USDC', amount: 124.78, priceUsd: 1, valueUsd: 124.78, tokenAddress: null }];

	await exec(
		`INSERT INTO wallet_snapshots
		   (tenant_id, wallet_id, chain, totals_usd,
		    collateral_usd, debt_usd, collateral_apy_pct,
		    borrow_apy_pct, net_rate_pct, payload_json, captured_at)
		 VALUES (?, ?, 'exchange', ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
		[DEMO_TENANT_ID, W_CB,  215,    JSON.stringify(cbTokens)],
	);
	await exec(
		`INSERT INTO wallet_snapshots
		   (tenant_id, wallet_id, chain, totals_usd,
		    collateral_usd, debt_usd, collateral_apy_pct,
		    borrow_apy_pct, net_rate_pct, payload_json, captured_at)
		 VALUES (?, ?, 'exchange', ?, 0, 0, NULL, NULL, 0, ?, CURRENT_TIMESTAMP)`,
		[DEMO_TENANT_ID, W_CRY, 124.78, JSON.stringify(cryTokens)],
	);

	// Coinbase transactions — net $215 USDC
	const cbTxs: [string, string, string, string, string, number, number, string, string, string][] = [
		['demo-itx-cb-usdc-1', '2022-03-10T09:00:00.000Z', 'Buy USDC', 'USDC', 'in', 150, 150, 'trade', 'USDC', 'demo-rh-cb-usdc-1'],
		['demo-itx-cb-usdc-2', '2023-07-22T14:30:00.000Z', 'Buy USDC', 'USDC', 'in',  65,  65, 'trade', 'USDC', 'demo-rh-cb-usdc-2'],
	];
	for (const [id, ts, desc, currency, direction, amount, nativeUsd, kind, symbol, rowHash] of cbTxs) {
		await exec(
			`INSERT OR IGNORE INTO import_transactions
			   (id, source, import_batch_id, account_id, tenant_id, timestamp_utc,
			    description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at)
			 VALUES (?, 'coinbase', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, BATCH_CB, ACCT_CB, DEMO_TENANT_ID, ts, desc, currency,
			 amount, nativeUsd, direction, kind, symbol, rowHash, ts],
		);
	}

	// Crypto.com transactions (interest income) — net $124.78 USDC
	const cryTxs: [string, string, string, string, string, number, number, string, string, string][] = [
		['demo-itx-cry-usdc-i1', '2024-02-01T00:00:00.000Z', 'Earn Interest', 'USDC', 'in', 24.12, 24.12, 'crypto_earn_interest_paid', 'USDC', 'demo-rh-cry-usdc-i1'],
		['demo-itx-cry-usdc-i2', '2024-05-01T00:00:00.000Z', 'Earn Interest', 'USDC', 'in', 37.84, 37.84, 'crypto_earn_interest_paid', 'USDC', 'demo-rh-cry-usdc-i2'],
		['demo-itx-cry-usdc-i3', '2024-08-01T00:00:00.000Z', 'Earn Interest', 'USDC', 'in', 62.82, 62.82, 'crypto_earn_interest_paid', 'USDC', 'demo-rh-cry-usdc-i3'],
	];
	for (const [id, ts, desc, currency, direction, amount, nativeUsd, kind, symbol, rowHash] of cryTxs) {
		await exec(
			`INSERT OR IGNORE INTO import_transactions
			   (id, source, import_batch_id, account_id, tenant_id, timestamp_utc,
			    description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at)
			 VALUES (?, 'crypto_com', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, BATCH_CRY, ACCT_CRY, DEMO_TENANT_ID, ts, desc, currency,
			 amount, nativeUsd, direction, kind, symbol, rowHash, ts],
		);
	}

	// ── 8. Bookkeeping: SOL staking income (2024–2025) ───────────────────────
	// These are native-staking rewards from the Solana Wallet (self-custody).
	// account_id is null — staking comes from the wallet, not an exchange account.
	type StakingRow = [string, string, number, number, string];
	const stakingTxs: StakingRow[] = [
		['demo-itx-sol-stk-1', '2024-04-15T00:00:00.000Z', 0.032,  6.50, 'demo-rh-sol-stk-1'],
		['demo-itx-sol-stk-2', '2024-08-01T00:00:00.000Z', 0.028,  5.40, 'demo-rh-sol-stk-2'],
		['demo-itx-sol-stk-3', '2024-11-15T00:00:00.000Z', 0.035,  7.20, 'demo-rh-sol-stk-3'],
		['demo-itx-sol-stk-4', '2025-03-01T00:00:00.000Z', 0.029,  6.10, 'demo-rh-sol-stk-4'],
	];
	for (const [id, ts, amount, nativeUsd, rowHash] of stakingTxs) {
		await exec(
			`INSERT OR IGNORE INTO import_transactions
			   (id, source, import_batch_id, account_id, tenant_id, timestamp_utc,
			    description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at)
			 VALUES (?, 'wallet', ?, NULL, ?, ?, 'Staking Reward', 'SOL', ?, ?, 'in', 'Staking Income', 'SOL', ?, ?)`,
			[id, BATCH_SOL_STAKING, DEMO_TENANT_ID, ts, amount, nativeUsd, rowHash, ts],
		);
	}

	// Crypto.com USDC interest — 2025 continuation
	const cry2025Txs: [string, string, number, string][] = [
		['demo-itx-cry-2025-1', '2025-02-01T00:00:00.000Z', 41.56, 'demo-rh-cry-2025-1'],
		['demo-itx-cry-2025-2', '2025-05-01T00:00:00.000Z', 38.92, 'demo-rh-cry-2025-2'],
	];
	for (const [id, ts, usd, rowHash] of cry2025Txs) {
		await exec(
			`INSERT OR IGNORE INTO import_transactions
			   (id, source, import_batch_id, account_id, tenant_id, timestamp_utc,
			    description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at)
			 VALUES (?, 'crypto_com', ?, ?, ?, ?, 'Earn Interest', 'USDC', ?, ?, 'in', 'crypto_earn_interest_paid', 'USDC', ?, ?)`,
			[id, BATCH_CRY_2025, ACCT_CRY, DEMO_TENANT_ID, ts, usd, usd, rowHash, ts],
		);
	}

	// ── 9. Analytics ──────────────────────────────────────────────────────────
	const ua       = request.headers.get('user-agent') ?? null;
	const referrer = request.headers.get('referer')    ?? null;
	await exec(`INSERT INTO demo_sessions (user_agent, referrer) VALUES (?, ?)`, [ua, referrer]);

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
			errors,
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
