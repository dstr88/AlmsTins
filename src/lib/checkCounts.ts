/**
 * How many times the public pre-send check (/api/verify/check) answered, per UTC day.
 *
 * One number per day, per kind of caller (anonymous or keyed) and per answer (proven, mismatch,
 * unanchored, unknown). Nothing else: no address, no payment link, no IP, no key, nothing that
 * says who asked or what about. An anonymous call is still never recorded as a call; it only adds
 * one to a day's total, which is what lets the admin page say whether anyone uses the free check.
 *
 * Counting never changes or delays the check's answer: the endpoint does not wait for it, and a
 * failure here is swallowed.
 *
 * The table is created lazily by ensureCheckCountsTable and mirrored in
 * migrations-pg/0078_verify_check_counts.sql (tests/verify/checkCounts.test.ts keeps the two equal).
 */
import { db } from '@/lib/db';

export const CHECK_STATUSES = ['proven', 'mismatch', 'unanchored', 'unknown'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export type CheckCaller = 'anonymous' | 'keyed';

/** The table, in creation order. The migration file holds the same statements. */
export const CHECK_COUNTS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS verify_check_counts (
    day    TEXT NOT NULL,
    caller TEXT NOT NULL,
    status TEXT NOT NULL,
    n      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, caller, status)
  )`,
];

let ensurePromise: Promise<void> | null = null;

export function ensureCheckCountsTable(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      for (const sql of CHECK_COUNTS_DDL) await db.execute({ sql, args: [] });
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

/** The UTC day a check is counted under: YYYY-MM-DD. */
export function checkDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Add one to the day's total for this kind of caller and answer. Never throws. */
export async function countCheck(input: { caller: CheckCaller; status: string; now?: Date }): Promise<void> {
  const status = (CHECK_STATUSES as readonly string[]).includes(input.status) ? input.status : null;
  if (!status) return;
  try {
    await ensureCheckCountsTable();
    await db.execute({
      sql: `INSERT INTO verify_check_counts (day, caller, status, n) VALUES (?, ?, ?, 1)
            ON CONFLICT (day, caller, status) DO UPDATE SET n = verify_check_counts.n + 1`,
      args: [checkDay(input.now ?? new Date()), input.caller, status],
    });
  } catch {
    // A missed count is a smaller number on the admin page, never a changed answer.
  }
}

export interface CheckCountDay {
  day: string;
  anonymous: number;
  keyed: number;
  byStatus: Record<CheckStatus, number>;
}

export interface CheckCountSummary {
  days: CheckCountDay[];
  totals: { anonymous: number; keyed: number; byStatus: Record<CheckStatus, number> };
  unavailable: boolean;
}

const zeroStatuses = (): Record<CheckStatus, number> => ({ proven: 0, mismatch: 0, unanchored: 0, unknown: 0 });

/** Pure: rows from the table, folded into the last `days` UTC days ending with `now` (oldest first). */
export function summarizeCheckCounts(
  rows: Array<{ day: unknown; caller: unknown; status: unknown; n: unknown }>,
  days: number,
  now: Date,
): Omit<CheckCountSummary, 'unavailable'> {
  const list: CheckCountDay[] = [];
  const index = new Map<string, CheckCountDay>();
  for (let i = days - 1; i >= 0; i--) {
    const day = checkDay(new Date(now.getTime() - i * 86_400_000));
    const entry: CheckCountDay = { day, anonymous: 0, keyed: 0, byStatus: zeroStatuses() };
    list.push(entry);
    index.set(day, entry);
  }
  const totals = { anonymous: 0, keyed: 0, byStatus: zeroStatuses() };
  for (const r of rows) {
    const entry = index.get(String(r.day));
    const n = Number(r.n);
    if (!entry || !Number.isFinite(n) || n <= 0) continue;
    const caller = r.caller === 'keyed' ? 'keyed' : r.caller === 'anonymous' ? 'anonymous' : null;
    const status = (CHECK_STATUSES as readonly string[]).includes(String(r.status)) ? (String(r.status) as CheckStatus) : null;
    if (!caller || !status) continue;
    entry[caller] += n;
    entry.byStatus[status] += n;
    totals[caller] += n;
    totals.byStatus[status] += n;
  }
  return { days: list, totals };
}

/** The last `days` UTC days of counts for the admin page. A read failure shows as zeros, flagged. */
export async function loadCheckCounts(days: number, now: Date = new Date()): Promise<CheckCountSummary> {
  const since = checkDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  try {
    await ensureCheckCountsTable();
    const r = await db.execute({
      sql: `SELECT day, caller, status, n FROM verify_check_counts WHERE day >= ?`,
      args: [since],
    });
    return { ...summarizeCheckCounts(r.rows as Array<{ day: unknown; caller: unknown; status: unknown; n: unknown }>, days, now), unavailable: false };
  } catch {
    return { ...summarizeCheckCounts([], days, now), unavailable: true };
  }
}
