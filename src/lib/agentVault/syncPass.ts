/**
 * The day's read of the chain, in as many calls as it takes.
 *
 * The daily job is a web request with a ten-minute limit on the host, and one call reads about nine
 * minutes of wallets. So the day is one logical PASS, named by its UTC date, made of repeated calls:
 * each call reads the wallets the pass has not read yet, least recently read first, until its
 * deadline, and answers how many are left. The workflow calls again until none are (`done`). Every
 * wallet is read once in a pass before any is read twice, and a later call knows what is left
 * without being told: it is whatever has no read for today yet.
 *
 * What a pass keeps is one row per wallet (agent_wallet_reads): the pass it was last read in, when
 * its last finished read ended, how the read ended, and how many transfers it newly recorded in the
 * pass. The order comes from the same row: the wallet read longest ago goes first, and a wallet never
 * read goes before all of them. A tin's wallets that come up one after another are read in one tin
 * pass, so its registry is loaded once.
 *
 * When a read counts as done for the pass:
 *   - complete, idle, partial for a page limit, unavailable, failed: done. A wallet the explorer
 *     could not answer for, or read only part of the way, is picked up from its cursor in tomorrow's
 *     pass, as before; a failed one goes red (the pass's `failed` count) and is not read again today.
 *   - cut by a call's deadline: not done (status `cut`). It keeps its place in the order, and the
 *     next call reads on from its cursor; what it recorded before the cut stays counted.
 * Reading a wallet twice changes nothing: the cursor only moves forward and a transfer is written
 * once (./watchState.ts, ./events.ts).
 *
 * The health rule judges the pass, not a call: the answer carries the pass's totals (pass_*), read
 * from these rows, so a wallet cut by one call and finished by the next counts once, by how it ended.
 *
 * Bookkeeping only, not evidence: the ledger is the record. Rows are keyed by tenant_id and leave
 * with the account (src/lib/accountDeleteTables.ts). The listing here is the job's own, across
 * accounts, like store.ts listWatchTargets before it. Schema is created lazily by
 * ensureAgentWalletReadsTable and mirrored in migrations-pg/0071_agent_wallet_reads.sql
 * (tests/agentics/guards.test.ts keeps the two equal).
 */
import { db } from '@/lib/db';
import { ensureAgentVaultTables, getTin } from './store';
import { defaultWatchDeps, runTinPass, type PassOptions, type WalletStatus, type WatchDeps } from './watcher';

/** The most due wallets one call lists; a call that reads them all lists again on the next call. */
export const MAX_DUE_ROWS = 5_000;

/** The table, in creation order. Migration 0071 holds the same statement. */
export const AGENT_WALLET_READS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_wallet_reads (
    tenant_id      TEXT NOT NULL,
    tin_id         TEXT NOT NULL,
    wallet_id      TEXT NOT NULL,
    pass_day       TEXT NOT NULL,
    read_at        TEXT,
    status         TEXT NOT NULL,
    recorded       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, wallet_id)
  )`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates the table if it is missing. Runs once per process; a failed run is retried by the next call. */
export function ensureAgentWalletReadsTable(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      await ensureAgentVaultTables();
      for (const sql of AGENT_WALLET_READS_DDL) await db.execute({ sql, args: [] });
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

/** The pass a time belongs to: its UTC date, YYYY-MM-DD. */
export const passDayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** How a wallet's read ended in a pass: as the watcher said, or `cut` by a call's deadline (not done). */
export type ReadStatus = WalletStatus | 'cut';

export interface DueWallet {
  tenantId: string;
  tinId: string;
  walletId: string;
  /** What this wallet recorded earlier in the same pass, before a deadline cut its read; 0 otherwise. */
  carried: number;
}

/** Live wallets of live tins that have no finished read in this pass (FROM and WHERE of the two queries below). */
const DUE = `FROM agent_wallets w LEFT JOIN agent_wallet_reads r ON r.tenant_id = w.tenant_id AND r.wallet_id = w.id
          WHERE w.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM agent_tins t WHERE t.id = w.tin_id AND t.tenant_id = w.tenant_id AND t.deleted_at IS NULL)
            AND (r.pass_day IS NULL OR r.pass_day <> ? OR r.status = 'cut')`;

/** The wallets this pass has not read yet, least recently read first (never read before all), at most `limit`. */
export async function listDueWallets(passDay: string, limit: number): Promise<DueWallet[]> {
  await ensureAgentWalletReadsTable();
  const r = await db.execute({
    sql: `SELECT w.tenant_id, w.tin_id, w.id, r.pass_day, r.status, r.recorded ${DUE}
          ORDER BY r.read_at ASC NULLS FIRST, w.tenant_id ASC, w.tin_id ASC, w.created_at ASC, w.id ASC LIMIT ?`,
    args: [passDay, limit],
  });
  return (r.rows as any[]).map((row) => ({
    tenantId: String(row.tenant_id),
    tinId: String(row.tin_id),
    walletId: String(row.id),
    carried: row.pass_day === passDay && row.status === 'cut' ? Number(row.recorded) || 0 : 0,
  }));
}

/** How many wallets this pass has not read yet. */
export async function countDueWallets(passDay: string): Promise<number> {
  await ensureAgentWalletReadsTable();
  const r = await db.execute({ sql: `SELECT COUNT(*) AS n ${DUE}`, args: [passDay] });
  return Number((r.rows as any[])[0]?.n ?? 0);
}

/**
 * Records how one wallet's read ended in this pass and what it newly recorded in the pass (`recorded`
 * includes what was carried from before a cut). A finished read sets when it ended; a cut one leaves
 * that as it was, so the wallet keeps its place at the front of the order.
 */
export async function markWalletRead(
  w: Pick<DueWallet, 'tenantId' | 'tinId' | 'walletId'>,
  passDay: string,
  read: { status: ReadStatus; recorded: number; atMs: number },
): Promise<void> {
  await ensureAgentWalletReadsTable();
  if (read.status === 'cut') {
    await db.execute({
      sql: `INSERT INTO agent_wallet_reads (tenant_id, tin_id, wallet_id, pass_day, read_at, status, recorded)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tenant_id, wallet_id) DO UPDATE SET tin_id = excluded.tin_id, pass_day = excluded.pass_day, status = excluded.status, recorded = excluded.recorded`,
      args: [w.tenantId, w.tinId, w.walletId, passDay, null, read.status, read.recorded],
    });
    return;
  }
  await db.execute({
    sql: `INSERT INTO agent_wallet_reads (tenant_id, tin_id, wallet_id, pass_day, read_at, status, recorded)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, wallet_id) DO UPDATE SET tin_id = excluded.tin_id, pass_day = excluded.pass_day, read_at = excluded.read_at, status = excluded.status, recorded = excluded.recorded`,
    args: [w.tenantId, w.tinId, w.walletId, passDay, new Date(read.atMs).toISOString(), read.status, read.recorded],
  });
}

export interface PassTotals {
  wallets: number;
  complete: number;
  partial: number;
  unavailable: number;
  failed: number;
  recorded: number;
}

const emptyTotals = (): PassTotals => ({ wallets: 0, complete: 0, partial: 0, unavailable: 0, failed: 0, recorded: 0 });

/**
 * Adds one read to a set of totals. An idle wallet (nothing to read yet) counts as complete, as the job
 * always has; one a deadline cut counts as partial until a later call finishes it.
 */
function addRead(t: PassTotals, status: ReadStatus, recorded: number): void {
  t.wallets += 1;
  t.recorded += recorded;
  if (status === 'complete' || status === 'idle') t.complete += 1;
  else if (status === 'partial' || status === 'cut') t.partial += 1;
  else if (status === 'unavailable') t.unavailable += 1;
  else t.failed += 1;
}

/** The pass's totals so far: every wallet read in it, counted once, by how its read ended. */
export async function readPassTotals(passDay: string): Promise<PassTotals> {
  await ensureAgentWalletReadsTable();
  const r = await db.execute({ sql: `SELECT status, recorded FROM agent_wallet_reads WHERE pass_day = ?`, args: [passDay] });
  const out = emptyTotals();
  for (const row of r.rows as any[]) addRead(out, String(row.status) as ReadStatus, Number(row.recorded) || 0);
  return out;
}

export interface SyncCallSummary {
  /** True when this pass has no wallet left to read. */
  done: boolean;
  /** Wallets this pass has not read yet. */
  remaining: number;
  /** Tins this call read. */
  tins: number;
  /** This call's reads, counted the way the pass counts them; a wallet the deadline cut counts as partial here. */
  wallets: number;
  complete: number;
  partial: number;
  unavailable: number;
  failed: number;
  recorded: number;
  /** True when this call's deadline came before every due wallet was read. Normal: the next call goes on. */
  truncated: boolean;
  /** The whole pass so far (readPassTotals): what the health rule judges. A wallet still cut counts as partial. */
  pass_wallets: number;
  pass_complete: number;
  pass_partial: number;
  pass_unavailable: number;
  pass_failed: number;
  pass_recorded: number;
}

function logFailure(stage: string, err: unknown): void {
  const e = err as { name?: unknown; code?: unknown } | null;
  console.error('[agent-vault] sync call failed', { stage, name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
}

/**
 * One call of the day's pass: read the due wallets, least recently read first, until the deadline,
 * then answer what is left and the pass's totals. Numbers and true/false only, so the answer can be
 * printed in a public log without naming anyone.
 */
export async function runSyncCall(deps: WatchDeps = defaultWatchDeps, opts: Pick<PassOptions, 'deadlineAt'> = {}): Promise<SyncCallSummary> {
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;
  const passDay = passDayOf(deps.now());
  const call = emptyTotals();
  let tins = 0;
  let truncated = false;

  // Due wallets in order, with one tin's wallets that come up together kept together.
  const groups: DueWallet[][] = [];
  for (const w of await listDueWallets(passDay, MAX_DUE_ROWS)) {
    const last = groups[groups.length - 1];
    if (last && last[0].tenantId === w.tenantId && last[0].tinId === w.tinId) last.push(w);
    else groups.push([w]);
  }

  for (const group of groups) {
    if (deps.now() >= deadlineAt) {
      truncated = true;
      break;
    }
    const { tenantId, tinId } = group[0];
    const tin = await getTin(tenantId, tinId);
    if (!tin) continue; // removed since the listing; the next listing leaves it out
    let reads: Array<{ wallet: DueWallet; status: ReadStatus; recorded: number }>;
    try {
      const pass = await runTinPass(tenantId, tin, deps, { deadlineAt, walletIds: group.map((w) => w.walletId) });
      const byId = new Map(pass.wallets.map((r) => [r.walletId, r]));
      reads = group.flatMap((wallet) => {
        const r = byId.get(wallet.walletId);
        if (!r) return [];
        const cut = r.status === 'partial' && r.reason === 'deadline';
        return [{ wallet, status: cut ? ('cut' as const) : r.status, recorded: r.recorded }];
      });
    } catch (err) {
      // The tin could not be read at all (its registry, its cursors): each of its wallets failed for this pass.
      logFailure('tin', err);
      reads = group.map((wallet) => ({ wallet, status: 'failed' as const, recorded: 0 }));
    }
    tins += 1;
    for (const r of reads) {
      addRead(call, r.status, r.recorded);
      if (r.status === 'cut') truncated = true;
      await markWalletRead(r.wallet, passDay, { status: r.status, recorded: r.wallet.carried + r.recorded, atMs: deps.now() });
    }
  }

  const remaining = await countDueWallets(passDay);
  const pass = await readPassTotals(passDay);
  return {
    done: remaining === 0,
    remaining,
    tins,
    ...call,
    truncated,
    pass_wallets: pass.wallets,
    pass_complete: pass.complete,
    pass_partial: pass.partial,
    pass_unavailable: pass.unavailable,
    pass_failed: pass.failed,
    pass_recorded: pass.recorded,
  };
}
