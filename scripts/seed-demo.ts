/**
 * scripts/seed-demo.ts
 *
 * One-time seed for the Almstins demo tenant.
 * Run with:  npx tsx scripts/seed-demo.ts
 *
 * Safe to re-run — uses INSERT OR IGNORE everywhere.
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
	// Deterministic-ish IDs so re-runs stay idempotent
	return `demo-${suffix}`.padEnd(36, '0').slice(0, 36);
}

async function exec(sql: string, args: (string | number | null)[] = []) {
	await db.execute({ sql, args });
}

// ── 1. Tenant ─────────────────────────────────────────────────────────────────

console.log('Seeding demo tenant…');
await exec(`
	INSERT OR IGNORE INTO tenants (id, name, created_at)
	VALUES (?, ?, ?)
`, [DEMO_TENANT_ID, 'Demo Portfolio', '2023-01-15T10:00:00.000Z']);

// ── 2. Subscription (unlimited so all features are visible) ───────────────────

console.log('Seeding demo subscription…');
await exec(`
	INSERT OR IGNORE INTO subscriptions (tenant_id, plan_id, status, created_at)
	VALUES (?, 'unlimited', 'active', ?)
`, [DEMO_TENANT_ID, '2023-01-15T10:00:00.000Z']);

// ── 3. Exchange account ───────────────────────────────────────────────────────

const ACCT_COINBASE = uuid('acct-coinbase');
const ACCT_CRYPTO   = uuid('acct-crypto-com');

console.log('Seeding demo exchange accounts…');
await exec(`
	INSERT OR IGNORE INTO exchange_accounts (id, tenant_id, source, name, created_at)
	VALUES (?, ?, 'coinbase', 'Demo Coinbase', ?)
`, [ACCT_COINBASE, DEMO_TENANT_ID, '2023-01-15T10:00:00.000Z']);

await exec(`
	INSERT OR IGNORE INTO exchange_accounts (id, tenant_id, source, name, created_at)
	VALUES (?, ?, 'crypto_com', 'Demo Crypto.com', ?)
`, [ACCT_CRYPTO, DEMO_TENANT_ID, '2023-01-15T10:00:00.000Z']);

// ── 4. Asset lifecycle groups ─────────────────────────────────────────────────

const GRP_BTC  = uuid('grp-btc');
const GRP_ETH  = uuid('grp-eth');
const GRP_USDC = uuid('grp-usdc');

console.log('Seeding lifecycle groups…');
for (const [id, symbol, qty, avgCost] of [
	[GRP_BTC,  'BTC',  0.3,   28_500],
	[GRP_ETH,  'ETH',  1.5,    1_650],
	[GRP_USDC, 'USDC', 0,          1],
] as const) {
	await exec(`
		INSERT OR IGNORE INTO asset_lifecycle_groups
			(id, tenant_id, asset_symbol, total_quantity, weighted_avg_cost_usd, latest_acquired_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, [id, DEMO_TENANT_ID, symbol, qty, avgCost, '2024-02-10T00:00:00.000Z',
		'2023-01-15T00:00:00.000Z', '2024-02-10T00:00:00.000Z']);
}

// ── 5. Asset lifecycle events ─────────────────────────────────────────────────
// Realistic scenario:
//   BTC: bought 0.5 @ $28,500 (Mar 2023) → sold 0.2 @ $43,500 (Jan 2024, LONG-TERM gain ~$3,000)
//        still holding 0.3 BTC cost ~$8,550
//   ETH: bought 2.0 @ $1,650 (Oct 2023) → sold 0.5 @ $2,850 (Aug 2024, SHORT-TERM gain ~$600)
//        still holding 1.5 ETH cost ~$2,475
//   USDC: interest income: $241.17 + $378.44 + $628.22 = $1,247.83 total (2024)

console.log('Seeding lifecycle events…');

const events: [string, string, string, string, string, string, number, number][] = [
	// [id, group_id, source_id, timestamp, direction, source_type, amount, native_usd]
	// BTC acquisition
	[uuid('evt-btc-buy'),   GRP_BTC,  uuid('tx-btc-buy'),  '2023-03-15T14:22:00.000Z', 'in',  'coinbase', 0.5,  14_250.00],
	// BTC disposal (0.2 BTC)
	[uuid('evt-btc-sell'),  GRP_BTC,  uuid('tx-btc-sell'), '2024-01-20T09:15:00.000Z', 'out', 'coinbase', 0.2,   8_700.00],
	// ETH acquisition
	[uuid('evt-eth-buy'),   GRP_ETH,  uuid('tx-eth-buy'),  '2023-10-05T11:00:00.000Z', 'in',  'coinbase', 2.0,   3_300.00],
	// ETH disposal (0.5 ETH)
	[uuid('evt-eth-sell'),  GRP_ETH,  uuid('tx-eth-sell'), '2024-08-15T16:45:00.000Z', 'out', 'coinbase', 0.5,   1_425.00],
	// USDC interest income (3 events in 2024)
	[uuid('evt-usdc-int1'), GRP_USDC, uuid('tx-usdc-i1'), '2024-02-01T00:00:00.000Z', 'in',  'crypto_com', 241.17,  241.17],
	[uuid('evt-usdc-int2'), GRP_USDC, uuid('tx-usdc-i2'), '2024-05-01T00:00:00.000Z', 'in',  'crypto_com', 378.44,  378.44],
	[uuid('evt-usdc-int3'), GRP_USDC, uuid('tx-usdc-i3'), '2024-08-01T00:00:00.000Z', 'in',  'crypto_com', 628.22,  628.22],
];

for (const [id, groupId, sourceId, ts, direction, sourceType, amount, nativeUsd] of events) {
	// Determine transaction_class
	const isInterest = sourceId.includes('usdc-i');
	const txClass = isInterest ? 'crypto_earn_interest_paid' : 'other';

	await exec(`
		INSERT OR IGNORE INTO asset_lifecycle_events
			(id, tenant_id, group_id, source_type, source_id, timestamp_utc,
			 direction, amount, native_usd, transaction_class, linked_transfer, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
	`, [id, DEMO_TENANT_ID, groupId, sourceType, sourceId, ts,
		direction, amount, nativeUsd, txClass, ts]);
}

// ── 6. Import transactions (needed for bookkeeping page detail rows) ───────────

console.log('Seeding import transactions…');

type TxRow = [string, string, string, string, string, string, number, number, string, string, string];
const importTxs: TxRow[] = [
	// [id, account_id, timestamp, description, currency, direction, amount, native_usd, kind, asset_symbol, row_hash]
	[uuid('itx-btc-buy'),   ACCT_COINBASE, '2023-03-15T14:22:00.000Z', 'Buy BTC',        'BTC',  'in',  0.5,    14_250.00, 'trade',                          'BTC',  uuid('rh-btc-buy')],
	[uuid('itx-btc-sell'),  ACCT_COINBASE, '2024-01-20T09:15:00.000Z', 'Sell BTC',       'BTC',  'out', 0.2,     8_700.00, 'trade',                          'BTC',  uuid('rh-btc-sell')],
	[uuid('itx-eth-buy'),   ACCT_COINBASE, '2023-10-05T11:00:00.000Z', 'Buy ETH',        'ETH',  'in',  2.0,     3_300.00, 'trade',                          'ETH',  uuid('rh-eth-buy')],
	[uuid('itx-eth-sell'),  ACCT_COINBASE, '2024-08-15T16:45:00.000Z', 'Sell ETH',       'ETH',  'out', 0.5,     1_425.00, 'trade',                          'ETH',  uuid('rh-eth-sell')],
	[uuid('itx-usdc-i1'),   ACCT_CRYPTO,   '2024-02-01T00:00:00.000Z', 'Earn Interest',  'USDC', 'in',  241.17,    241.17, 'crypto_earn_interest_paid',      'USDC', uuid('rh-usdc-i1')],
	[uuid('itx-usdc-i2'),   ACCT_CRYPTO,   '2024-05-01T00:00:00.000Z', 'Earn Interest',  'USDC', 'in',  378.44,    378.44, 'crypto_earn_interest_paid',      'USDC', uuid('rh-usdc-i2')],
	[uuid('itx-usdc-i3'),   ACCT_CRYPTO,   '2024-08-01T00:00:00.000Z', 'Earn Interest',  'USDC', 'in',  628.22,    628.22, 'crypto_earn_interest_paid',      'USDC', uuid('rh-usdc-i3')],
];

for (const [id, accountId, ts, desc, currency, direction, amount, nativeUsd, kind, symbol, rowHash] of importTxs) {
	const source = accountId === ACCT_COINBASE ? 'coinbase' : 'crypto_com';
	const batchId = uuid(`batch-${source}`);
	await exec(`
		INSERT OR IGNORE INTO import_transactions
			(id, source, import_batch_id, account_id, tenant_id, timestamp_utc,
			 description, currency, amount, native_usd, direction, kind, asset_symbol, row_hash, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, [id, source, batchId, accountId, DEMO_TENANT_ID, ts,
		desc, currency, amount, nativeUsd, direction, kind, symbol, rowHash, ts]);
}

// ── Done ──────────────────────────────────────────────────────────────────────

console.log('\n✅ Demo seed complete!');
console.log(`   Tenant ID : ${DEMO_TENANT_ID}`);
console.log('   Events    : 7 lifecycle events (2 disposals + 3 income + 2 acquisitions still held)');
console.log('   To visit  : /api/demo/start  →  /dashboard/bookkeeping\n');

db.close();
