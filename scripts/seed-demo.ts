/**
 * scripts/seed-demo.ts
 *
 * Seed for the Almstins demo tenant — high-net-worth portfolio.
 * Run with:  npx tsx scripts/seed-demo.ts
 *
 * Re-run safe — deletes existing demo data first, then re-inserts.
 * The demo tenant is read-only in the app (mutations are blocked at middleware).
 */

import 'dotenv/config';
import { createClient } from '@libsql/client';

const DEMO_TENANT_ID = 'demo-00000000000000000000000000000001';

const db = createClient({
	url: process.env.TURSO_DATABASE_URL ?? '',
	authToken: process.env.TURSO_AUTH_TOKEN,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function uuid(suffix: string): string {
	return `demo-${suffix}`.padEnd(36, '0').slice(0, 36);
}

async function exec(sql: string, args: (string | number | null)[] = []) {
	await db.execute({ sql, args });
}

// ── 0. Clear existing demo data ───────────────────────────────────────────────

console.log('Clearing existing demo data…');
await exec(`DELETE FROM wallet_defi_sync    WHERE tenant_id = ?`, [DEMO_TENANT_ID]);
await exec(`DELETE FROM wallet_snapshots    WHERE tenant_id = ?`, [DEMO_TENANT_ID]);
await exec(`DELETE FROM wallets             WHERE tenant_id = ?`, [DEMO_TENANT_ID]);
await exec(`DELETE FROM asset_lifecycle_events WHERE tenant_id = ?`, [DEMO_TENANT_ID]);
await exec(`DELETE FROM asset_lifecycle_groups WHERE tenant_id = ?`, [DEMO_TENANT_ID]);
await exec(`DELETE FROM import_transactions WHERE tenant_id = ?`, [DEMO_TENANT_ID]);
await exec(`DELETE FROM exchange_accounts   WHERE tenant_id = ?`, [DEMO_TENANT_ID]);
await exec(`DELETE FROM subscriptions       WHERE tenant_id = ?`, [DEMO_TENANT_ID]);
await exec(`DELETE FROM tenants             WHERE id = ?`,         [DEMO_TENANT_ID]);

// ── 1. Tenant ─────────────────────────────────────────────────────────────────

console.log('Seeding demo tenant…');
await exec(`
	INSERT INTO tenants (id, name, created_at)
	VALUES (?, ?, ?)
`, [DEMO_TENANT_ID, 'Titanium Hut Vault', '2021-06-01T10:00:00.000Z']);

// ── 2. Subscription ───────────────────────────────────────────────────────────

console.log('Seeding demo subscription…');
await exec(`
	INSERT INTO subscriptions (tenant_id, plan_id, status, created_at)
	VALUES (?, 'unlimited', 'active', ?)
`, [DEMO_TENANT_ID, '2021-06-01T10:00:00.000Z']);

// ── 3. Exchange accounts ──────────────────────────────────────────────────────

const ACCT_COINBASE = uuid('acct-coinbase');
const ACCT_CRYPTO   = uuid('acct-crypto-com');

console.log('Seeding demo exchange accounts…');
await exec(`
	INSERT INTO exchange_accounts (id, tenant_id, source, name, created_at)
	VALUES (?, ?, 'coinbase', 'Demo Coinbase', ?)
`, [ACCT_COINBASE, DEMO_TENANT_ID, '2021-06-01T10:00:00.000Z']);

await exec(`
	INSERT INTO exchange_accounts (id, tenant_id, source, name, created_at)
	VALUES (?, ?, 'crypto_com', 'Demo Crypto.com', ?)
`, [ACCT_CRYPTO, DEMO_TENANT_ID, '2021-06-01T10:00:00.000Z']);

// ── 4. Asset lifecycle groups ─────────────────────────────────────────────────
//
//  High-net-worth scale:
//    BTC  : bought 50 @ $28,500 → sold 20 @ $43,500 → holding 30 BTC (cost $855,000)
//    ETH  : bought 200 @ $1,650 → sold 50 @ $2,850  → holding 150 ETH (cost $247,500)
//    USDC : staking income ~$124,800 across 3 events

const GRP_BTC  = uuid('grp-btc');
const GRP_ETH  = uuid('grp-eth');
const GRP_USDC = uuid('grp-usdc');

console.log('Seeding lifecycle groups…');
for (const [id, symbol, qty, avgCost] of [
	[GRP_BTC,  'BTC',  30,  28_500],
	[GRP_ETH,  'ETH',  150,  1_650],
	[GRP_USDC, 'USDC', 0,        1],
] as const) {
	await exec(`
		INSERT INTO asset_lifecycle_groups
			(id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, [id, DEMO_TENANT_ID, symbol, qty, avgCost, '2024-02-10T00:00:00.000Z',
		'2021-06-01T00:00:00.000Z', '2024-02-10T00:00:00.000Z']);
}

// ── 5. Asset lifecycle events ─────────────────────────────────────────────────

console.log('Seeding lifecycle events…');

const events: [string, string, string, string, string, string, number, number][] = [
	// BTC: buy 50 @ $28,500 = $1,425,000
	[uuid('evt-btc-buy'),   GRP_BTC,  uuid('tx-btc-buy'),  '2021-06-15T14:22:00.000Z', 'in',  'coinbase',   50,    1_425_000.00],
	// BTC: sell 20 @ $43,500 = $870,000 (long-term gain ~$300,000)
	[uuid('evt-btc-sell'),  GRP_BTC,  uuid('tx-btc-sell'), '2024-01-20T09:15:00.000Z', 'out', 'coinbase',   20,      870_000.00],
	// ETH: buy 200 @ $1,650 = $330,000
	[uuid('evt-eth-buy'),   GRP_ETH,  uuid('tx-eth-buy'),  '2021-10-05T11:00:00.000Z', 'in',  'coinbase',  200,      330_000.00],
	// ETH: sell 50 @ $2,850 = $142,500 (short-term gain ~$60,000)
	[uuid('evt-eth-sell'),  GRP_ETH,  uuid('tx-eth-sell'), '2024-08-15T16:45:00.000Z', 'out', 'coinbase',   50,      142_500.00],
	// USDC staking income
	[uuid('evt-usdc-int1'), GRP_USDC, uuid('tx-usdc-i1'),  '2024-02-01T00:00:00.000Z', 'in',  'crypto_com', 24_117.00, 24_117.00],
	[uuid('evt-usdc-int2'), GRP_USDC, uuid('tx-usdc-i2'),  '2024-05-01T00:00:00.000Z', 'in',  'crypto_com', 37_844.00, 37_844.00],
	[uuid('evt-usdc-int3'), GRP_USDC, uuid('tx-usdc-i3'),  '2024-08-01T00:00:00.000Z', 'in',  'crypto_com', 62_822.00, 62_822.00],
];

for (const [id, groupId, sourceId, ts, direction, sourceType, amount, nativeUsd] of events) {
	const isInterest = sourceId.includes('usdc-i');
	const txClass = isInterest ? 'crypto_earn_interest_paid' : 'other';

	await exec(`
		INSERT INTO asset_lifecycle_events
			(id, tenant_id, group_id, source_type, source_id, timestamp_utc,
			 direction, amount, native_usd, transaction_class, linked_transfer, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
	`, [id, DEMO_TENANT_ID, groupId, sourceType, sourceId, ts,
		direction, amount, nativeUsd, txClass, ts]);
}

// ── 6. Import transactions ────────────────────────────────────────────────────

console.log('Seeding import transactions…');

type TxRow = [string, string, string, string, string, string, number, number, string, string, string];
const importTxs: TxRow[] = [
	[uuid('itx-btc-buy'),   ACCT_COINBASE, '2021-06-15T14:22:00.000Z', 'Buy BTC',       'BTC',  'in',  50,        1_425_000.00, 'trade',                     'BTC',  uuid('rh-btc-buy')],
	[uuid('itx-btc-sell'),  ACCT_COINBASE, '2024-01-20T09:15:00.000Z', 'Sell BTC',      'BTC',  'out', 20,          870_000.00, 'trade',                     'BTC',  uuid('rh-btc-sell')],
	[uuid('itx-eth-buy'),   ACCT_COINBASE, '2021-10-05T11:00:00.000Z', 'Buy ETH',       'ETH',  'in',  200,         330_000.00, 'trade',                     'ETH',  uuid('rh-eth-buy')],
	[uuid('itx-eth-sell'),  ACCT_COINBASE, '2024-08-15T16:45:00.000Z', 'Sell ETH',      'ETH',  'out', 50,          142_500.00, 'trade',                     'ETH',  uuid('rh-eth-sell')],
	[uuid('itx-usdc-i1'),   ACCT_CRYPTO,   '2024-02-01T00:00:00.000Z', 'Earn Interest', 'USDC', 'in',  24_117.00,    24_117.00, 'crypto_earn_interest_paid', 'USDC', uuid('rh-usdc-i1')],
	[uuid('itx-usdc-i2'),   ACCT_CRYPTO,   '2024-05-01T00:00:00.000Z', 'Earn Interest', 'USDC', 'in',  37_844.00,    37_844.00, 'crypto_earn_interest_paid', 'USDC', uuid('rh-usdc-i2')],
	[uuid('itx-usdc-i3'),   ACCT_CRYPTO,   '2024-08-01T00:00:00.000Z', 'Earn Interest', 'USDC', 'in',  62_822.00,    62_822.00, 'crypto_earn_interest_paid', 'USDC', uuid('rh-usdc-i3')],
];

for (const [id, accountId, ts, desc, currency, direction, amount, nativeUsd, kind, symbol, rowHash] of importTxs) {
	const source = accountId === ACCT_COINBASE ? 'coinbase' : 'crypto_com';
	const batchId = uuid(`batch-${source}`);
	await exec(`
		INSERT INTO import_transactions
			(id, source, import_batch_id, account_id, tenant_id, timestamp_utc,
			 description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, [id, source, batchId, accountId, DEMO_TENANT_ID, ts,
		desc, currency, amount, nativeUsd, direction, kind, symbol, rowHash, ts]);
}

// ── 7. DeFi wallets (10 tins) ─────────────────────────────────────────────────
//
//  Each wallet → one tin stack in the vault (Wallet Summary + DeFi + NFTs).
//  Addresses are plausible-looking but fictional.

console.log('Seeding 10 DeFi wallets…');

const WALLETS = [
	{ id: 'DEMO-W01', label: 'Alpha Yield',        address: '0xa100000000000000000000000000000000000001', chains: ['ethereum'] },
	{ id: 'DEMO-W02', label: 'Blue Chip Reserve',  address: '0xa200000000000000000000000000000000000002', chains: ['ethereum'] },
	{ id: 'DEMO-W03', label: 'Stablecoin Vault',   address: '0xa300000000000000000000000000000000000003', chains: ['ethereum'] },
	{ id: 'DEMO-W04', label: 'Polygon DeFi',       address: '0xa400000000000000000000000000000000000004', chains: ['polygon'] },
	{ id: 'DEMO-W05', label: 'Leveraged Long',     address: '0xa500000000000000000000000000000000000005', chains: ['ethereum'] },
	{ id: 'DEMO-W06', label: 'Avalanche Node',     address: '0xa600000000000000000000000000000000000006', chains: ['avalanche'] },
	{ id: 'DEMO-W07', label: 'Delta Neutral',      address: '0xa700000000000000000000000000000000000007', chains: ['ethereum'] },
	{ id: 'DEMO-W08', label: 'Yield Compounder',   address: '0xa800000000000000000000000000000000000008', chains: ['ethereum'] },
	{ id: 'DEMO-W09', label: 'Protocol Treasury',  address: '0xa900000000000000000000000000000000000009', chains: ['ethereum'] },
	{ id: 'DEMO-W10', label: 'Cold Reserve',       address: '0xaa00000000000000000000000000000000000010', chains: ['ethereum'] },
];

for (const w of WALLETS) {
	await exec(`
		INSERT INTO wallets (id, tenant_id, address, label, chains, is_default, wallet_type, created_at)
		VALUES (?, ?, ?, ?, ?, 0, 'onchain', ?)
	`, [w.id, DEMO_TENANT_ID, w.address, w.label, JSON.stringify(w.chains), '2022-01-01T00:00:00.000Z']);
}

// ── 8. DeFi sync data (health + positions per wallet) ─────────────────────────

console.log('Seeding DeFi sync data…');

// [ walletId, chain, healthFactor, collateralUsd, debtUsd, supplyPositions, borrowPositions ]
const DEFI_DATA = [
	{
		walletId: 'DEMO-W01',
		address:  '0xa100000000000000000000000000000000000001',
		chain: 'ethereum',
		health: { healthFactor: 2.14, totalCollateralBase: 1_183_472, totalDebtBase: 473_388, availableBorrowsBase: 296_118 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'WETH',  amount: 591.736,   apy: 0.024 },
			{ side: 'borrow', marketName: 'Aave V3 Ethereum', assetSymbol: 'USDC',  amount: 473_388,   apy: 0.067 },
		],
		tokens: [{ symbol: 'WETH', amount: 591.736, priceUsd: 2000, usdValue: 1_183_472, purchasePriceUsd: 1_647 }],
	},
	{
		walletId: 'DEMO-W02',
		address:  '0xa200000000000000000000000000000000000002',
		chain: 'ethereum',
		health: { healthFactor: 1.95, totalCollateralBase: 2_086_314, totalDebtBase: 834_525, availableBorrowsBase: 207_881 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'WBTC',  amount: 29.804,    apy: 0.011 },
			{ side: 'borrow', marketName: 'Aave V3 Ethereum', assetSymbol: 'USDT',  amount: 834_525,   apy: 0.072 },
		],
		tokens: [{ symbol: 'WBTC', amount: 29.804, priceUsd: 70_000, usdValue: 2_086_314, purchasePriceUsd: 41_837 }],
	},
	{
		walletId: 'DEMO-W03',
		address:  '0xa300000000000000000000000000000000000003',
		chain: 'ethereum',
		health: { healthFactor: 2.50, totalCollateralBase: 497_318, totalDebtBase: 198_927, availableBorrowsBase: 173_562 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'USDC',  amount: 497_318,   apy: 0.058 },
			{ side: 'borrow', marketName: 'Aave V3 Ethereum', assetSymbol: 'DAI',   amount: 198_927,   apy: 0.061 },
		],
		tokens: [{ symbol: 'USDC', amount: 497_318, priceUsd: 1, usdValue: 497_318, purchasePriceUsd: 1 }],
	},
	{
		walletId: 'DEMO-W04',
		address:  '0xa400000000000000000000000000000000000004',
		chain: 'polygon',
		health: { healthFactor: 2.20, totalCollateralBase: 794_613, totalDebtBase: 317_845, availableBorrowsBase: 276_384 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Polygon',  assetSymbol: 'WMATIC', amount: 1_191_337, apy: 0.042 },
			{ side: 'borrow', marketName: 'Aave V3 Polygon',  assetSymbol: 'USDC',   amount: 317_845,   apy: 0.069 },
		],
		tokens: [{ symbol: 'WMATIC', amount: 1_191_337, priceUsd: 0.667, usdValue: 794_613, purchasePriceUsd: 0.419 }],
	},
	{
		walletId: 'DEMO-W05',
		address:  '0xa500000000000000000000000000000000000005',
		chain: 'ethereum',
		health: { healthFactor: 1.42, totalCollateralBase: 2_974_816, totalDebtBase: 1_784_889, availableBorrowsBase: 49_247 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'WETH',  amount: 1_487.408, apy: 0.024 },
			{ side: 'borrow', marketName: 'Aave V3 Ethereum', assetSymbol: 'USDC',  amount: 1_784_889, apy: 0.067 },
		],
		tokens: [{ symbol: 'WETH', amount: 1_487.408, priceUsd: 2000, usdValue: 2_974_816, purchasePriceUsd: 1_648 }],
	},
	{
		walletId: 'DEMO-W06',
		address:  '0xa600000000000000000000000000000000000006',
		chain: 'avalanche',
		health: { healthFactor: 2.05, totalCollateralBase: 596_241, totalDebtBase: 238_496, availableBorrowsBase: 148_903 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Avalanche', assetSymbol: 'WAVAX', amount: 17_887,    apy: 0.036 },
			{ side: 'borrow', marketName: 'Aave V3 Avalanche', assetSymbol: 'USDT',  amount: 238_496,   apy: 0.070 },
		],
		tokens: [{ symbol: 'WAVAX', amount: 17_887, priceUsd: 33.33, usdValue: 596_241, purchasePriceUsd: 18.47 }],
	},
	{
		walletId: 'DEMO-W07',
		address:  '0xa700000000000000000000000000000000000007',
		chain: 'ethereum',
		health: { healthFactor: 2.30, totalCollateralBase: 1_461_538, totalDebtBase: 584_615, availableBorrowsBase: 341_794 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'WBTC',  amount: 20.879,    apy: 0.011 },
			{ side: 'borrow', marketName: 'Aave V3 Ethereum', assetSymbol: 'WETH',  amount: 292.307,   apy: 0.028 },
		],
		tokens: [{ symbol: 'WBTC', amount: 20.879, priceUsd: 70_000, usdValue: 1_461_538, purchasePriceUsd: 41_923 }],
	},
	{
		walletId: 'DEMO-W08',
		address:  '0xa800000000000000000000000000000000000008',
		chain: 'ethereum',
		health: { healthFactor: 2.10, totalCollateralBase: 891_274, totalDebtBase: 356_509, availableBorrowsBase: 196_874 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'stETH', amount: 445.637,   apy: 0.038 },
			{ side: 'borrow', marketName: 'Aave V3 Ethereum', assetSymbol: 'USDC',  amount: 356_509,   apy: 0.067 },
		],
		tokens: [{ symbol: 'stETH', amount: 445.637, priceUsd: 2000, usdValue: 891_274, purchasePriceUsd: 1_649 }],
	},
	{
		walletId: 'DEMO-W09',
		address:  '0xa900000000000000000000000000000000000009',
		chain: 'ethereum',
		health: { healthFactor: 2.40, totalCollateralBase: 743_816, totalDebtBase: 297_526, availableBorrowsBase: 247_638 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'DAI',   amount: 743_816,   apy: 0.055 },
			{ side: 'borrow', marketName: 'Aave V3 Ethereum', assetSymbol: 'USDC',  amount: 297_526,   apy: 0.067 },
		],
		tokens: [{ symbol: 'DAI', amount: 743_816, priceUsd: 1, usdValue: 743_816, purchasePriceUsd: 1 }],
	},
	{
		walletId: 'DEMO-W10',
		address:  '0xaa00000000000000000000000000000000000010',
		chain: 'ethereum',
		health: { healthFactor: 999, totalCollateralBase: 4_963_184, totalDebtBase: 0, availableBorrowsBase: 2_977_910 },
		positions: [
			{ side: 'supply', marketName: 'Aave V3 Ethereum', assetSymbol: 'WETH',  amount: 2_481.592, apy: 0.024 },
		],
		tokens: [{ symbol: 'WETH', amount: 2_481.592, priceUsd: 2000, usdValue: 4_963_184, purchasePriceUsd: 1_197 }],
	},
];

const MARKET_ADDRESSES: Record<string, string> = {
	ethereum:  '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
	polygon:   '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
	avalanche: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
};

const CHAIN_IDS: Record<string, number> = { ethereum: 1, polygon: 137, avalanche: 43114 };

const MARKET_NAMES: Record<string, string> = {
	ethereum:  'Aave V3 Ethereum',
	polygon:   'Aave V3 Polygon',
	avalanche: 'Aave V3 Avalanche',
};

const NOW = new Date().toISOString();

for (const w of DEFI_DATA) {
	const chainId   = CHAIN_IDS[w.chain]   ?? 1;
	const market    = MARKET_ADDRESSES[w.chain] ?? MARKET_ADDRESSES.ethereum;

	const healthPayload = JSON.stringify({
		ok: true,
		address: w.address,
		chains: {
			[w.chain]: w.health,
		},
	});

	const positionsPayload = JSON.stringify({
		ok: true,
		address: w.address,
		chains: {
			[w.chain]: {
				chainId,
				market,
				positions: w.positions,
			},
		},
	});

	// wallet_defi_sync PRIMARY KEY is wallet_id
	await exec(`
		INSERT OR REPLACE INTO wallet_defi_sync
			(tenant_id, wallet_id, last_defi_sync_at, interest_paid_total,
			 interest_earned_total, net_interest_total, health_payload, positions_payload, updated_at)
		VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?)
	`, [DEMO_TENANT_ID, w.walletId, NOW, healthPayload, positionsPayload, NOW]);

	// Token snapshot so the Wallet Summary tin shows holdings
	// wallet_snapshots PRIMARY KEY is id (auto or explicit)
	const snapshotPayload = JSON.stringify(w.tokens);
	const totalUsd = w.tokens.reduce((sum, t) => sum + t.usdValue, 0);
	const snapshotId = `snap-${w.walletId}`;

	await exec(`
		INSERT OR REPLACE INTO wallet_snapshots
			(id, tenant_id, wallet_id, chain, captured_at, totals_usd, payload_json)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, [snapshotId, DEMO_TENANT_ID, w.walletId, w.chain, NOW, totalUsd, snapshotPayload]);
}

// ── Done ──────────────────────────────────────────────────────────────────────

console.log('\n✅ Demo seed complete!');
console.log(`   Tenant ID  : ${DEMO_TENANT_ID}`);
console.log('   BTC held   : 30 BTC  (cost basis $855,000)');
console.log('   ETH held   : 150 ETH (cost basis $247,500)');
console.log('   USDC income: $124,783');
console.log('   DeFi tins  : 10 wallets across Ethereum / Polygon / Avalanche');
console.log('   To visit   : /api/demo/start  →  /dashboard/bookkeeping\n');

db.close();
