/**
 * The warm-address cache: per account, the last addresses its agents' keyed checks screened clean,
 * so a check on one of them a moment later answers at once instead of asking the screening sources
 * (the OFAC mirror and GoPlus, through the public checker's checkWallet) again. Decided Nov 5, 2026;
 * it lives in Almstins, never in the agent, and the agent's code does not change: it calls the check
 * before every payment, and the check decides whether the screening is reused.
 *
 * The rules:
 *   - The only way in is a check: an address is put here only by a keyed check whose fresh
 *     screening passed (./checkScreening.ts). A failed or limited screening never is.
 *   - At most WARM_MAX addresses per account. Each falls out after WARM_IDLE_MS without use, and
 *     the time slides: every hit starts it again. Adding an eleventh drops the one used longest ago.
 *   - A hit says when the screening it reuses was made (`screenedAt`). The check that uses it still
 *     writes its own entry to the ledger, marked cached, with that time and the time it was served.
 *   - Any flag evicts. A failed screening, a flagged answer on any check, and a registered
 *     destination that becomes flagged each evict the address (evictWarm). A sanctions update
 *     evicts without a call: an entry screened before the OFAC mirror last changed is not used
 *     (sanctionsChangedAt), so a newly listed address is screened again on its next check.
 *   - Only the screening is reused. The Verify registry, the agent's own registry and its history
 *     are read on every check, so a proof that lapsed or a destination flagged a second ago is never
 *     answered from here.
 *
 * In the database, not in a process's memory: the app runs more than one process, and a list held in
 * one would let another process answer a check without knowing an address was evicted. One small
 * table, keyed by account and address; it holds no amounts, labels or names, and it is removed with
 * the account (src/lib/accountDeleteTables.ts). The Vault deletes no rows (tests/agentics/guards.test.ts),
 * so leaving the list is a mark, `evicted_at`, never a delete: a row that is evicted, idle too long, or
 * pushed out by newer ones is simply not used, and an address that comes back reuses its row. So the
 * table holds at most one row for each address an account's checks ever screened clean. Schema is
 * created lazily by ensureWarmCacheTable and mirrored in migrations-pg/0067_agent_warm_addresses.sql
 * (the guards keep the pair equal). Times are stored as ISO-8601 UTC text, which sorts and compares as
 * time.
 *
 * Every function here throws on a database error; ./checkScreening.ts treats a failed read as a miss
 * (a fresh screening) and a failed write as nothing kept, so the cache can only ever save a call,
 * never change an answer.
 */
import { db } from '@/lib/db';
import { WARM_IDLE_MS, WARM_MAX, warmEntryUsable, type WarmEntry } from './warmRule';

export { WARM_IDLE_MS, WARM_MAX, warmEntryUsable, type WarmEntry };

/** The table and its index, in creation order. The migration file holds the same statements. */
export const AGENT_WARM_ADDRESSES_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_warm_addresses (
    tenant_id    TEXT NOT NULL,
    address      TEXT NOT NULL,
    screened_at  TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    evicted_at   TEXT,
    PRIMARY KEY (tenant_id, address)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_warm_addresses_used ON agent_warm_addresses (tenant_id, last_used_at)`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates the table if it is missing. Runs once per process; a failed run is retried by the next call. */
export function ensureWarmCacheTable(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      for (const sql of AGENT_WARM_ADDRESSES_DDL) await db.execute({ sql, args: [] });
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

/**
 * When the OFAC mirror last changed (src/lib/threatLists.ts writes `refreshed_at` only when a list's
 * content changed), or null when it has never loaded. Throws when it cannot be read.
 */
export async function sanctionsChangedAt(): Promise<string | null> {
  const r = await db.execute({ sql: `SELECT refreshed_at FROM threat_meta WHERE source LIKE ?`, args: ['ofac_%'] });
  let latest: string | null = null;
  for (const row of r.rows as unknown as Array<{ refreshed_at: unknown }>) {
    const at = row.refreshed_at == null ? null : String(row.refreshed_at);
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/**
 * The screening time of a warm address that may answer this check, or null. A hit starts the idle
 * time again. An entry that may not be used (idle too long, or screened before the sanctions mirror
 * changed) is evicted.
 */
export async function takeWarm(tenantId: string, address: string, now: Date): Promise<{ screenedAt: string } | null> {
  await ensureWarmCacheTable();
  const r = await db.execute({
    sql: `SELECT screened_at, last_used_at FROM agent_warm_addresses WHERE tenant_id = ? AND address = ? AND evicted_at IS NULL LIMIT 1`,
    args: [tenantId, address],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as unknown as { screened_at: unknown; last_used_at: unknown };
  const entry: WarmEntry = { screenedAt: String(row.screened_at), lastUsedAt: String(row.last_used_at) };
  let sanctionsAt: string | null | undefined;
  try {
    sanctionsAt = await sanctionsChangedAt();
  } catch {
    sanctionsAt = undefined;
  }
  if (!warmEntryUsable(entry, sanctionsAt, now)) {
    await evictWarm(tenantId, address, now);
    return null;
  }
  // Only a row still in the list is touched: one evicted between the read and here stays evicted, and is not served.
  const u = await db.execute({
    sql: `UPDATE agent_warm_addresses SET last_used_at = ? WHERE tenant_id = ? AND address = ? AND evicted_at IS NULL AND last_used_at = ?`,
    args: [now.toISOString(), tenantId, address, entry.lastUsedAt],
  });
  if ((u.rowsAffected ?? 0) === 0) return null;
  return { screenedAt: entry.screenedAt };
}

/**
 * Keeps an address that a fresh screening just passed. Then the account's list is trimmed: entries
 * idle for WARM_IDLE_MS leave it, and of the rest only the WARM_MAX used most recently stay.
 */
export async function putWarm(tenantId: string, address: string, screenedAt: string, now: Date): Promise<void> {
  await ensureWarmCacheTable();
  const at = now.toISOString();
  await db.execute({
    sql: `INSERT INTO agent_warm_addresses (tenant_id, address, screened_at, last_used_at, evicted_at) VALUES (?, ?, ?, ?, NULL)
          ON CONFLICT (tenant_id, address) DO UPDATE SET screened_at = excluded.screened_at, last_used_at = excluded.last_used_at, evicted_at = NULL`,
    args: [tenantId, address, screenedAt, at],
  });
  // The list is at most WARM_MAX + 1 rows here, so it is read whole and trimmed by address.
  const live = await db.execute({
    sql: `SELECT address, last_used_at FROM agent_warm_addresses WHERE tenant_id = ? AND evicted_at IS NULL ORDER BY last_used_at DESC, address ASC`,
    args: [tenantId],
  });
  const idleBefore = new Date(now.getTime() - WARM_IDLE_MS).toISOString();
  const out = (live.rows as unknown as Array<{ address: unknown; last_used_at: unknown }>)
    .filter((row, i) => i >= WARM_MAX || String(row.last_used_at) <= idleBefore)
    .map((row) => String(row.address));
  if (out.length) {
    await db.execute({
      sql: `UPDATE agent_warm_addresses SET evicted_at = ? WHERE tenant_id = ? AND evicted_at IS NULL AND address IN (${out.map(() => '?').join(', ')})`,
      args: [at, tenantId, ...out],
    });
  }
}

/** Takes one address out of an account's list. A flag of any kind calls this. */
export async function evictWarm(tenantId: string, address: string, now: Date = new Date()): Promise<void> {
  await ensureWarmCacheTable();
  await db.execute({
    sql: `UPDATE agent_warm_addresses SET evicted_at = ? WHERE tenant_id = ? AND address = ? AND evicted_at IS NULL`,
    args: [now.toISOString(), tenantId, address],
  });
}
