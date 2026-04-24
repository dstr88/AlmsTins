/**
 * diagnosePortfolio.mjs
 *
 * Compares two portfolio data sources side-by-side:
 *  1. wallet_snapshots  — what the dashboard "Market Value" shows
 *  2. asset_lifecycle_groups — what portfolio/performance shows (cost-basis P&L view)
 *
 * Also shows held cost basis from lifecycle events and the PnL figure
 * shown in the PortfolioTile.
 *
 * Usage (from project root):
 *   node --import dotenv/config src/scripts/diagnosePortfolio.mjs
 *   TENANT_ID=<uuid> node --import dotenv/config src/scripts/diagnosePortfolio.mjs
 */

import { createClient } from '@libsql/client';

const TURSO_URL        = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;
const TENANT_ID        = process.env.TENANT_ID;

if (!TURSO_URL || !TURSO_AUTH_TOKEN) {
  console.error('Missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN');
  process.exit(1);
}

const db = createClient({ url: TURSO_URL, authToken: TURSO_AUTH_TOKEN });

const fmt  = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const fmtQ = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 });

// ── Resolve tenant ────────────────────────────────────────────────────────────
let tenantId = TENANT_ID;
if (!tenantId) {
  const res = await db.execute('SELECT id, name FROM tenants LIMIT 5');
  if (res.rows.length === 1) {
    tenantId = String(res.rows[0].id);
    console.log(`Auto-selected tenant: ${tenantId} (${res.rows[0].name ?? ''})\n`);
  } else {
    console.error('Multiple tenants found — set TENANT_ID env var:');
    res.rows.forEach((r) => console.error(`  TENANT_ID=${r.id}  # ${r.name}`));
    process.exit(1);
  }
}

// ── 1. Wallet snapshots (Market Value source) ─────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log(' WALLET SNAPSHOTS  (dashboard Market Value)');
console.log('═══════════════════════════════════════════════════════════');

const snapshotResult = await db.execute({
  sql: `WITH latest AS (
          SELECT wallet_id, chain, MAX(captured_at) AS captured_at
          FROM wallet_snapshots WHERE tenant_id = ?
          GROUP BY wallet_id, chain
        )
        SELECT w.label, w.address, ws.chain, ws.totals_usd, ws.captured_at
        FROM wallet_snapshots ws
        JOIN latest l ON l.wallet_id = ws.wallet_id AND l.chain = ws.chain AND l.captured_at = ws.captured_at
        JOIN wallets w ON w.id = ws.wallet_id
        WHERE ws.tenant_id = ? AND w.tenant_id = ?
        ORDER BY ws.totals_usd DESC`,
  args: [tenantId, tenantId, tenantId],
});

let snapshotTotal = 0;
for (const row of snapshotResult.rows) {
  const usd = Number(row.totals_usd ?? 0);
  snapshotTotal += usd;
  const label = String(row.label ?? row.address ?? '?').slice(0, 30).padEnd(30);
  const chain = String(row.chain ?? '').padEnd(10);
  const date  = String(row.captured_at ?? '').slice(0, 16);
  console.log(`  ${label} ${chain} ${fmt(usd).padStart(12)}  (synced ${date})`);
}
console.log(`  ${'TOTAL'.padEnd(30)} ${''.padEnd(10)} ${fmt(snapshotTotal).padStart(12)}`);

// ── 2. Lifecycle groups (portfolio/performance source) ────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log(' LIFECYCLE GROUPS  (portfolio/performance P&L view)');
console.log('═══════════════════════════════════════════════════════════');

const lifecycleResult = await db.execute({
  sql: `SELECT
          alg.asset_symbol,
          alg.total_quantity          AS gross_qty,
          alg.weighted_avg_cost_usd   AS avg_cost,
          alg.latest_acquired_at,
          COALESCE(SUM(
            CASE WHEN ale.direction = 'out'
                  AND ale.transaction_class = 'other'
                  AND (ale.linked_transfer = 0 OR ale.linked_transfer IS NULL)
                 THEN ale.amount ELSE 0 END
          ), 0) AS disposed_qty
        FROM asset_lifecycle_groups alg
        LEFT JOIN asset_lifecycle_events ale ON ale.group_id = alg.id
        WHERE alg.tenant_id = ?
        GROUP BY alg.id, alg.asset_symbol, alg.total_quantity, alg.weighted_avg_cost_usd, alg.latest_acquired_at
        ORDER BY alg.asset_symbol`,
  args: [tenantId],
});

let lifecycleTotal = 0;
let lifecycleHeldCost = 0;
const assetRows = [];

for (const row of lifecycleResult.rows) {
  const sym       = String(row.asset_symbol ?? '');
  const grossQty  = Number(row.gross_qty ?? 0);
  const disposed  = Number(row.disposed_qty ?? 0);
  const netQty    = Math.max(0, grossQty - disposed);
  const avgCost   = Number(row.avg_cost ?? 0);
  const costBasis = netQty * avgCost;

  assetRows.push({ sym, grossQty, disposed, netQty, avgCost, costBasis });
}
assetRows.sort((a, b) => b.costBasis - a.costBasis);

console.log(`  ${'Symbol'.padEnd(8)} ${'Gross Qty'.padStart(14)} ${'Disposed'.padStart(14)} ${'Net Qty'.padStart(14)} ${'Avg Cost'.padStart(10)} ${'Cost Basis'.padStart(12)} Kept?`);
console.log('  ' + '─'.repeat(90));
for (const r of assetRows) {
  const kept = r.netQty > 0 ? '✓' : '✗ filtered';
  lifecycleHeldCost += r.netQty > 0 ? r.costBasis : 0;
  console.log(
    `  ${r.sym.padEnd(8)}` +
    ` ${fmtQ(r.grossQty).padStart(14)}` +
    ` ${fmtQ(r.disposed).padStart(14)}` +
    ` ${fmtQ(r.netQty).padStart(14)}` +
    ` ${fmt(r.avgCost).padStart(10)}` +
    ` ${fmt(r.costBasis).padStart(12)}` +
    ` ${kept}`
  );
}
console.log(`\n  Held cost basis (sum of kept assets): ${fmt(lifecycleHeldCost)}`);

// ── 3. Summary / gap ─────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log(' SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Wallet snapshots total (Market Value): ${fmt(snapshotTotal)}`);
console.log(`  Lifecycle held cost basis:             ${fmt(lifecycleHeldCost)}`);
console.log(`  Gap (snapshots - cost basis):          ${fmt(snapshotTotal - lifecycleHeldCost)}`);
console.log('');
console.log('  The PortfolioTile shows:');
console.log(`    Market Value = ${fmt(snapshotTotal)}`);
console.log(`    PnL          = Market Value - heldCostBasis`);
console.log(`                 = ${fmt(snapshotTotal)} - ${fmt(lifecycleHeldCost)}`);
console.log(`                 = ${fmt(snapshotTotal - lifecycleHeldCost)}`);

// ── 4. Assets in snapshots but not lifecycle ──────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log(' ASSETS IN SNAPSHOTS  (full breakdown from payload_json)');
console.log('═══════════════════════════════════════════════════════════');

const payloadResult = await db.execute({
  sql: `WITH latest AS (
          SELECT wallet_id, chain, MAX(captured_at) AS captured_at
          FROM wallet_snapshots WHERE tenant_id = ?
          GROUP BY wallet_id, chain
        )
        SELECT w.label, ws.chain, ws.payload_json, ws.captured_at
        FROM wallet_snapshots ws
        JOIN latest l ON l.wallet_id = ws.wallet_id AND l.chain = ws.chain AND l.captured_at = ws.captured_at
        JOIN wallets w ON w.id = ws.wallet_id
        WHERE ws.tenant_id = ? AND w.tenant_id = ?`,
  args: [tenantId, tenantId, tenantId],
});

const snapshotAssets = new Map(); // sym → { valueUsd, amount, sources[] }
for (const row of payloadResult.rows) {
  if (!row.payload_json) continue;
  let tokens;
  try { tokens = JSON.parse(String(row.payload_json)); } catch { continue; }
  if (!Array.isArray(tokens)) continue;
  for (const t of tokens) {
    const sym = String(t.symbol ?? '').toUpperCase();
    if (!sym) continue;
    const existing = snapshotAssets.get(sym) ?? { valueUsd: 0, amount: 0, sources: [] };
    existing.valueUsd += Number(t.valueUsd ?? 0);
    existing.amount   += Number(t.amount   ?? 0);
    existing.sources.push(String(row.label ?? row.chain ?? '?'));
    snapshotAssets.set(sym, existing);
  }
}

const lifecycleSyms = new Set(assetRows.filter(r => r.netQty > 0).map(r => r.sym));
const sortedAssets = [...snapshotAssets.entries()].sort((a, b) => b[1].valueUsd - a[1].valueUsd);

console.log(`  ${'Symbol'.padEnd(8)} ${'Amount'.padStart(14)} ${'USD Value'.padStart(12)} ${'In Lifecycle?'.padEnd(15)} Sources`);
console.log('  ' + '─'.repeat(85));
for (const [sym, data] of sortedAssets) {
  if (data.valueUsd < 0.01) continue;
  const inLC = lifecycleSyms.has(sym) ? '✓ yes' : '✗ no (gap!)';
  console.log(
    `  ${sym.padEnd(8)}` +
    ` ${fmtQ(data.amount).padStart(14)}` +
    ` ${fmt(data.valueUsd).padStart(12)}` +
    `  ${inLC.padEnd(15)}` +
    ` ${[...new Set(data.sources)].join(', ')}`
  );
}

console.log('\nDone.');
process.exit(0);
