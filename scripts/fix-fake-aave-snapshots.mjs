/**
 * fix-fake-aave-snapshots.mjs
 *
 * Removes pricing data for known fake/scam AAVE contract addresses
 * from wallet_snapshot rows, recomputes totals_usd, and busts caches.
 *
 * Usage:
 *   node --import dotenv/config scripts/fix-fake-aave-snapshots.mjs
 */

import { createClient } from '@libsql/client';

// ── Config ────────────────────────────────────────────────────────────────────

const TENANT_ID = 'fc236bc3-f032-4064-aea4-1e5e1fa503b1';

const FAKE_ADDRESSES = new Set([
  '0xb5466ab4f8eff1aab6ba562b2f51f58ebdee23c4',
  '0xd6198855979714255d711a4bb8bf1763d28a473b',
]);

// Chains to scan (polygon is the primary suspect; eth + avax as a safety net)
const CHAINS = ['polygon', 'ethereum', 'avalanche'];

// ── DB client ─────────────────────────────────────────────────────────────────

const tursoUrl   = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

if (!tursoUrl || !tursoToken) {
  console.error('ERROR: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set.');
  process.exit(1);
}

const db = createClient({ url: tursoUrl, authToken: tursoToken });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sum all positive token.valueUsd values in an array of token objects. */
function recomputeTotal(tokens) {
  let total = 0;
  for (const t of tokens) {
    if (typeof t.valueUsd === 'number' && t.valueUsd > 0) {
      total += t.valueUsd;
    }
  }
  return total;
}

/** Process one chain. Returns an array of change-report objects. */
async function processChain(chain) {
  console.log(`\n── Scanning chain: ${chain} ──`);

  const result = await db.execute({
    sql: `
      SELECT id, payload_json, totals_usd
      FROM   wallet_snapshots
      WHERE  tenant_id    = ?
        AND  chain        = ?
        AND  payload_json IS NOT NULL
        AND  totals_usd   > 0
    `,
    args: [TENANT_ID, chain],
  });

  const rows = result.rows;
  console.log(`  Found ${rows.length} candidate snapshot(s).`);

  const changes = [];

  for (const row of rows) {
    const id          = row[0] ?? row.id;
    const payloadRaw  = row[1] ?? row.payload_json;
    const oldTotal    = Number(row[2] ?? row.totals_usd);

    let tokens;
    try {
      tokens = JSON.parse(payloadRaw);
    } catch {
      console.warn(`  [SKIP] id=${id}: payload_json is not valid JSON.`);
      continue;
    }

    if (!Array.isArray(tokens)) {
      console.warn(`  [SKIP] id=${id}: payload_json is not an array.`);
      continue;
    }

    let dirty = false;

    for (const token of tokens) {
      const addr = (token.tokenAddress ?? '').toLowerCase();
      if (FAKE_ADDRESSES.has(addr)) {
        console.log(
          `  [HIT]  id=${id}  addr=${addr}  ` +
          `oldPrice=${token.priceUsd}  oldValue=${token.valueUsd}`
        );
        token.priceUsd = null;
        token.valueUsd = null;
        dirty = true;
      }
    }

    if (!dirty) continue;

    const newTotal      = recomputeTotal(tokens);
    const newPayloadStr = JSON.stringify(tokens);

    changes.push({ id, chain, oldTotal, newTotal, newPayloadStr });
  }

  return changes;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== fix-fake-aave-snapshots ===');
  console.log(`Tenant : ${TENANT_ID}`);
  console.log(`Chains : ${CHAINS.join(', ')}`);
  console.log(`Targets: ${[...FAKE_ADDRESSES].join(', ')}`);

  const allChanges = [];

  for (const chain of CHAINS) {
    const changes = await processChain(chain);
    allChanges.push(...changes);
  }

  if (allChanges.length === 0) {
    console.log('\nNo rows require updating. Exiting.');
    return;
  }

  // ── Apply updates ────────────────────────────────────────────────────────

  console.log(`\n── Applying ${allChanges.length} UPDATE(s) ──`);

  for (const { id, chain, oldTotal, newTotal, newPayloadStr } of allChanges) {
    await db.execute({
      sql: `UPDATE wallet_snapshots SET payload_json = ?, totals_usd = ? WHERE id = ?`,
      args: [newPayloadStr, newTotal, id],
    });
    console.log(
      `  UPDATED id=${id} (${chain})  ` +
      `old_total=${oldTotal.toFixed(2)}  new_total=${newTotal.toFixed(2)}`
    );
  }

  // ── Bust caches ───────────────────────────────────────────────────────────

  console.log('\n── Busting cache ──');
  const cacheResult = await db.execute({
    sql: `DELETE FROM cache WHERE cache_key LIKE ?`,
    args: [`t:${TENANT_ID}%`],
  });
  const deletedCacheRows = cacheResult.rowsAffected ?? 0;
  console.log(`  Deleted ${deletedCacheRows} cache row(s) matching t:${TENANT_ID}%`);

  // ── Report ────────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('══════════════════════════════════════════');
  console.log(`Snapshots changed : ${allChanges.length}`);
  console.log(`Cache rows deleted: ${deletedCacheRows}`);
  console.log('');

  let grandBefore = 0;
  let grandAfter  = 0;

  for (const { id, chain, oldTotal, newTotal } of allChanges) {
    const delta = newTotal - oldTotal;
    console.log(
      `  id=${id}  chain=${chain}` +
      `  before=$${oldTotal.toFixed(2)}` +
      `  after=$${newTotal.toFixed(2)}` +
      `  delta=$${delta.toFixed(2)}`
    );
    grandBefore += oldTotal;
    grandAfter  += newTotal;
  }

  console.log('');
  console.log(`  Grand total before : $${grandBefore.toFixed(2)}`);
  console.log(`  Grand total after  : $${grandAfter.toFixed(2)}`);
  console.log(`  Grand total removed: $${(grandBefore - grandAfter).toFixed(2)}`);
  console.log('══════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
