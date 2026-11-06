/**
 * Where the watcher left off, one row per agent wallet.
 *
 * A cursor says "every transfer of this wallet up to this time has been read", so the next pass
 * starts there instead of at the registration. It is bookkeeping, not evidence: the ledger
 * (./events.ts) is the record, and a lost or rewound cursor costs nothing but a longer read,
 * because a transfer already in the ledger is never written twice. So a cursor only ever moves
 * forward here, and the watcher advances it only after a read that completed.
 *
 * Before slice 8 the cursor was kept per PAIR of a wallet and a watched destination
 * (agent_watch_cursors, migration 0052), because only transfers between the two were kept. Now the
 * whole history of the wallet is kept, so one cursor per wallet is the right unit
 * (agent_wallet_cursors, migration 0065). The pair rows stay where they are, read-only, for one
 * purpose: a wallet's first read under the new cursor starts from the OLDEST of its pair cursors
 * when it has any (every pair was read through at least that moment, so nothing a pair recorded is
 * read again from the start), and from the wallet's registration when it has none. Transfers to
 * addresses that were not on the list before that moment are not back-filled by the transition;
 * removing a wallet's new cursor row makes its next read start at the registration again. The pair
 * rows are never written again and leave with the account (src/lib/accountDeleteTables.ts).
 *
 * A wallet that is no longer live simply stops being read, and its row sits unused until the
 * account is removed.
 *
 * Tenant isolation is the same rule as store.ts: every statement names tenant_id.
 *
 * Schema is created lazily by ensureAgentWatchTables and mirrored in
 * migrations-pg/0052_agent_watch_cursors.sql and migrations-pg/0065_agent_wallet_cursors.sql
 * (tests/agentics/guards.test.ts keeps each pair equal).
 */
import { db } from '@/lib/db';

const TS_DEFAULT = `DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`;

/** The pair table, in creation order. Migration 0052 holds the same statement. Read-only since slice 8. */
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

/** The per-wallet table, in creation order. Migration 0065 holds the same statement. */
export const AGENT_WALLET_CURSORS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_wallet_cursors (
    tenant_id      TEXT NOT NULL,
    tin_id         TEXT NOT NULL,
    wallet_id      TEXT NOT NULL,
    through_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL ${TS_DEFAULT},
    PRIMARY KEY (tenant_id, wallet_id)
  )`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates both cursor tables if they are missing. Runs once per process; a failed run is retried by the next call. */
export function ensureAgentWatchTables(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      for (const sql of [...AGENT_WATCH_DDL, ...AGENT_WALLET_CURSORS_DDL]) await db.execute({ sql, args: [] });
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

/** The key of one pair in the map readPairCursors returns. */
export const pairKey = (walletId: string, destinationId: string): string => `${walletId}|${destinationId}`;

/**
 * Where each pair of one tin was last read through under the old scheme, in milliseconds since
 * the epoch. Read for the transition only (see the top of this file); nothing writes these rows now.
 */
export async function readPairCursors(tenantId: string, tinId: string): Promise<Map<string, number>> {
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

/** The oldest pair cursor of one wallet, in milliseconds, or null when the wallet has none: where its first per-wallet read starts. */
export function oldestPairCursor(pairs: ReadonlyMap<string, number>, walletId: string): number | null {
  let oldest: number | null = null;
  for (const [key, at] of pairs) {
    if (!key.startsWith(`${walletId}|`)) continue;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest;
}

/** Where each wallet of one tin was last read through, by wallet id, in milliseconds since the epoch. */
export async function readWalletCursors(tenantId: string, tinId: string): Promise<Map<string, number>> {
  await ensureAgentWatchTables();
  const r = await db.execute({
    sql: `SELECT wallet_id, through_at FROM agent_wallet_cursors WHERE tenant_id = ? AND tin_id = ?`,
    args: [tenantId, tinId],
  });
  const out = new Map<string, number>();
  for (const row of r.rows as any[]) {
    const at = Date.parse(String(row.through_at));
    if (Number.isFinite(at)) out.set(String(row.wallet_id), at);
  }
  return out;
}

/**
 * Moves one wallet's cursor forward to `throughMs`. A cursor already further along is left where
 * it is: the write is the later of the two, so an older pass finishing late cannot move one back.
 */
export async function advanceWalletCursor(
  tenantId: string,
  tinId: string,
  walletId: string,
  throughMs: number,
  existing: ReadonlyMap<string, number>,
): Promise<void> {
  if (!Number.isFinite(throughMs)) return;
  await ensureAgentWatchTables();
  const updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const at = Math.max(throughMs, existing.get(walletId) ?? 0);
  await db.execute({
    sql: `INSERT INTO agent_wallet_cursors (tenant_id, tin_id, wallet_id, through_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, wallet_id) DO UPDATE SET through_at = excluded.through_at, updated_at = excluded.updated_at`,
    args: [tenantId, tinId, walletId, new Date(at).toISOString(), updatedAt],
  });
}
