/**
 * cronHeartbeat.ts — a minimal dead-man's-switch for scheduled jobs.
 *
 * A scheduled job cannot notice its own absence: if it stops firing, no code runs to
 * complain. So each job records a heartbeat on success here, and a DIFFERENT, frequently
 * running job checks those heartbeats and alerts the owner when one has gone quiet. This
 * catches the exact failure we've been bitten by before — a single workflow silently
 * failing (or reporting a false green) while the others keep running.
 *
 * It is a belt to the fail-closed suspenders: the Verify watchman already lapses badges to
 * unverified within its max-stale TTL if it stops, so users stay safe either way; this just
 * makes sure the operator finds out and fixes it before everything quietly lapses.
 *
 * Global operator state (not tenant data): a job either ran or it didn't. Fail-soft
 * everywhere — a heartbeat problem must never break the job it is attached to.
 */
import { db } from '@/lib/db';

const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);
const parseUtcMs = (s: string): number => Date.parse(s.replace(' ', 'T') + 'Z');

let ensured = false;
async function ensure(): Promise<void> {
  if (ensured) return;
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS cron_heartbeat (
            name            TEXT PRIMARY KEY,
            last_success_at TEXT,
            last_alerted_at TEXT,
            updated_at      TEXT NOT NULL
          )`,
    args: [],
  });
  ensured = true;
}

/** Record that a scheduled job completed successfully just now. Clears any stale-alert
 *  latch so a job that recovers and later fails again can alert afresh. Fail-soft. */
export async function recordCronSuccess(name: string): Promise<void> {
  try {
    await ensure();
    const now = nowUtc();
    await db.execute({
      sql: `INSERT INTO cron_heartbeat (name, last_success_at, last_alerted_at, updated_at)
            VALUES (?, ?, NULL, ?)
            ON CONFLICT (name) DO UPDATE SET
              last_success_at = excluded.last_success_at,
              last_alerted_at = NULL,
              updated_at      = excluded.updated_at`,
      args: [name, now, now],
    });
  } catch (e) {
    console.error('[cronHeartbeat] record failed:', e instanceof Error ? e.message : e);
  }
}

export interface HeartbeatSpec { name: string; maxAgeHours: number; }
export interface StaleCron { name: string; lastSuccessAt: string | null; ageHours: number | null; }

/**
 * Return the jobs that are overdue (last success older than maxAgeHours, or never recorded)
 * AND have not already been alerted within that same window, stamping last_alerted_at for the
 * ones returned so a caller running every few hours does not re-spam. Fail-soft → [].
 */
export async function claimStaleAlerts(specs: HeartbeatSpec[]): Promise<StaleCron[]> {
  try {
    await ensure();
    const res = await db.execute({ sql: `SELECT name, last_success_at, last_alerted_at FROM cron_heartbeat`, args: [] });
    const rows = new Map<string, { last: string | null; alerted: string | null }>();
    for (const r of res.rows as any[]) {
      rows.set(String(r.name), {
        last: r.last_success_at ? String(r.last_success_at) : null,
        alerted: r.last_alerted_at ? String(r.last_alerted_at) : null,
      });
    }
    const now = nowUtc();
    const nowMs = Date.now();
    const out: StaleCron[] = [];
    for (const spec of specs) {
      const row = rows.get(spec.name);
      const ageHours = row?.last ? (nowMs - parseUtcMs(row.last)) / 3_600_000 : null;
      const stale = ageHours === null || ageHours > spec.maxAgeHours;
      if (!stale) continue;
      const alertedHoursAgo = row?.alerted ? (nowMs - parseUtcMs(row.alerted)) / 3_600_000 : null;
      if (alertedHoursAgo !== null && alertedHoursAgo < spec.maxAgeHours) continue; // already alerted this window
      // Latch the alert so the next run inside the window stays quiet. Preserve last_success_at.
      await db.execute({
        sql: `INSERT INTO cron_heartbeat (name, last_success_at, last_alerted_at, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT (name) DO UPDATE SET last_alerted_at = excluded.last_alerted_at, updated_at = excluded.updated_at`,
        args: [spec.name, row?.last ?? null, now, now],
      });
      out.push({ name: spec.name, lastSuccessAt: row?.last ?? null, ageHours });
    }
    return out;
  } catch (e) {
    console.error('[cronHeartbeat] claimStaleAlerts failed:', e instanceof Error ? e.message : e);
    return [];
  }
}
