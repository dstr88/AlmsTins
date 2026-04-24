/**
 * Analyze BTC disposal events for a tenant
 * Run: TENANT_ID=xxx node --import dotenv/config src/scripts/diagnoseBtcDisposals.mjs
 */
import { createClient } from '@libsql/client';

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const tid = process.env.TENANT_ID ?? 'fc236bc3-f032-4064-aea4-1e5e1fa503b1';

// Check disposal events in asset_lifecycle_events
const { rows } = await db.execute({
  sql: `SELECT e.direction, e.transaction_class, e.linked_transfer, e.amount, e.native_usd, e.timestamp_utc, e.source_type, e.source_id
        FROM asset_lifecycle_events e
        JOIN asset_lifecycle_groups g ON e.group_id = g.id
        WHERE g.tenant_id = ? AND UPPER(g.asset_symbol) = 'BTC' AND e.direction = 'out'
        ORDER BY e.timestamp_utc`,
  args: [tid],
});

console.log(`Out-direction BTC lifecycle events: ${rows.length}`);
let totalDisposed = 0;
let linkedDisposed = 0;
for (const r of rows) {
  const amt = r.amount != null ? Number(r.amount) : 0;
  const isLinked = Number(r.linked_transfer) === 1;
  const isOther = r.transaction_class === 'other';
  if (isOther && !isLinked) totalDisposed += amt;
  else if (isLinked) linkedDisposed += amt;
  console.log(`[${String(r.timestamp_utc).slice(0,10)}] class=${r.transaction_class} linked=${r.linked_transfer} amt=${amt.toFixed(8)}`);
}
console.log('\nLifecycle disposal summary:');
console.log(`  Unlinked other (would be subtracted): ${totalDisposed.toFixed(8)} BTC`);
console.log(`  Linked transfers (excluded by SQL):   ${linkedDisposed.toFixed(8)} BTC`);
console.log(`  Net holdings (gross 11.362 - disposed): ${(11.36222386 - totalDisposed).toFixed(8)} BTC`);

// Raw import_transactions out-direction BTC
const imp = await db.execute({
  sql: `SELECT direction, kind, description, amount, to_amount, native_usd, timestamp_utc
        FROM import_transactions
        WHERE tenant_id = ? AND UPPER(asset_symbol) = 'BTC' AND direction = 'out'
        ORDER BY timestamp_utc`,
  args: [tid],
});
console.log(`\nRaw out-direction import_transactions: ${imp.rows.length}`);
let totalOut = 0;
for (const r of imp.rows) {
  const amt = Math.abs(Number(r.amount ?? 0));
  totalOut += amt;
  console.log(`[${String(r.timestamp_utc).slice(0,10)}] kind=${r.kind} amt=${amt.toFixed(8)} usd=${r.native_usd}`);
}
console.log(`\nSum of all out-qty: ${totalOut.toFixed(8)} BTC`);
console.log(`Gross acquisitions: 11.36222386 BTC`);
console.log(`Net if all outs subtracted: ${(11.36222386 - totalOut).toFixed(8)} BTC`);

process.exit(0);
