/**
 * Where the watcher left off, one row per pair of an agent wallet and a watched destination.
 *
 * A cursor says "every transfer between this wallet and this destination up to this time has been
 * read", so the next pass starts there instead of at the registration. It is bookkeeping, not
 * evidence: the ledger (./events.ts) is the record, and a lost or rewound cursor costs nothing
 * but a longer read, because a transfer already in the ledger is never written twice. So a cursor
 * only ever moves forward here, and the watcher advances it only after a read that completed.
 *
 * A pair that is no longer watched (the destination was removed, the wallet was removed) simply
 * stops being read, and its row sits unused until the account is removed
 * (src/lib/accountDeleteTables.ts).
 *
 * Tenant isolation is the same rule as store.ts: every statement names tenant_id.
 *
 * Schema is created lazily by ensureAgentWatchTables and mirrored in
 * migrations-pg/0052_agent_watch_cursors.sql (tests/agentics/guards.test.ts keeps the two equal).
 */
import { db } from '@/lib/db';

const TS_DEFAULT = `DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`;

/** The table, in creation order. The migration file holds the same statement. */
export const AGENT_WATCH_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_watch_cursors (
    tenant_id      TEXT NOT NULL,
    tin_id         TEXT NOT NULL,
    wallet_id      TEXT NOT NULL,
    destination_id TEXT NOT NULL,
    through_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL ${TS_DEFAULT},
    PRIMARY KEY (tenant_id, wallet_id, destination_id)
  )`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates the cursor table if it is missing. Runs once per process; a failed run is retried by the next call. */
export function ensureAgentWatchTables(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      for (const sql of AGENT_WATCH_DDL) await db.execute({ sql, args: [] });
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

/** The key of one pair in the map readCursors returns. */
export const pairKey = (walletId: string, destinationId: string): string => `${walletId}|${destinationId}`;

/** Where each pair of one tin was last read through, in milliseconds since the epoch. */
export async function readCursors(tenantId: string, tinId: string): Promise<Map<string, number>> {
  await ensureAgentWatchTables();
  const r = await db.execute({
    sql: `SELECT wallet_id, destination_id, through_at FROM agent_watch_cursors WHERE tenant_id = ? AND tin_id = ?`,
    args: [tenantId, tinId],
  });
  const out = new Map<string, number>();
  for (const row of r.rows as any[]) {
    const at = Date.parse(String(row.through_at));
    if (Number.isFinite(at)) out.set(pairKey(String(row.wallet_id), String(row.destination_id)), at);
  }
  return out;
}

/**
 * Moves the cursors of one wallet's pairs forward to `throughMs`. A cursor already further along
 * is left where it is: the write is the later of the two, so an older pass finishing late cannot
 * move one back.
 */
export async function advanceCursors(
  tenantId: string,
  tinId: string,
  walletId: string,
  destinationIds: readonly string[],
  throughMs: number,
  existing: ReadonlyMap<string, number>,
): Promise<void> {
  if (!destinationIds.length || !Number.isFinite(throughMs)) return;
  await ensureAgentWatchTables();
  const updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const statements = destinationIds.map((destinationId) => {
    const at = Math.max(throughMs, existing.get(pairKey(walletId, destinationId)) ?? 0);
    return {
      sql: `INSERT INTO agent_watch_cursors (tenant_id, tin_id, wallet_id, destination_id, through_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (tenant_id, wallet_id, destination_id) DO UPDATE SET through_at = excluded.through_at, updated_at = excluded.updated_at`,
      args: [tenantId, tinId, walletId, destinationId, new Date(at).toISOString(), updatedAt],
    };
  });
  await db.batch(statements, 'write');
}
