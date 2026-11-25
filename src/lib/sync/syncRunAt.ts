/**
 * wallet_sync_state.last_run_at: when a wallet and chain were last synced, as text, in one format:
 * `YYYY-MM-DD HH:MM:SS`, UTC (what the EVM sync writes, `to_char(now() AT TIME ZONE 'UTC', ...)`).
 *
 * Until Nov 2026 the Solana and Sui syncs wrote ISO instead (`2026-11-23T15:29:41.762Z`). The
 * readers took the largest last_run_at as text, and as text the ISO value sorts above an EVM one from later
 * the same day (`T` comes after a space), so the Bookkeeping strip read the Solana value, added a
 * second `Z`, could not parse it and said "never synced". The weekly jobs compared the same text
 * against an ISO cut-off, so a wallet could be skipped or synced again for the same reason.
 *
 * Now every writer uses syncRunAtNow(); ensureSyncRunAtFormat() rewrites the ISO values already
 * stored, once per process, from the weekly wallet sync, which runs across every account
 * (mirrored by migrations-pg/0081_sync_run_at_format.sql, which tests/sync/syncRunAt.test.ts keeps
 * identical); and every reader takes latestSyncRunSql() and parses with parseSyncRunAt() or
 * syncedSince(), which accept either format, so an ISO value left behind still reads right.
 */

import { db } from '@/lib/db';
import { toDate } from '@/lib/format';

/** `YYYY-MM-DD HH:MM:SS` in UTC, the one format last_run_at holds. */
export function syncRunAtNow(now: Date = new Date()): string {
	return now.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * A last_run_at value in the one format, whichever it was written in: the first 19 characters
 * with `T` read as a space. As SQL, for MAX() and comparisons; `column` defaults to last_run_at.
 */
export function syncRunAtSql(column = 'last_run_at'): string {
	return `replace(substr(CAST(${column} AS TEXT), 1, 19), 'T', ' ')`;
}

/** The newest last_run_at across the rows, in the one format, whatever mix of formats is stored. */
export function latestSyncRunSql(column = 'last_run_at'): string {
	return `MAX(${syncRunAtSql(column)})`;
}

/** Milliseconds since 1970 for a last_run_at value in either format; NaN when there is none. */
export function parseSyncRunAt(value: unknown): number {
	return toDate(value)?.getTime() ?? NaN;
}

/** True when the value is a time later than `cutoffMs`. An unreadable or missing value is not. */
export function syncedSince(value: unknown, cutoffMs: number): boolean {
	const ms = parseSyncRunAt(value);
	return Number.isFinite(ms) && ms > cutoffMs;
}

/** The one-time rewrite of ISO values to the one format. Touches only rows still in ISO. */
export const SYNC_RUN_AT_REWRITE = `UPDATE wallet_sync_state SET last_run_at = ${syncRunAtSql()} WHERE CAST(last_run_at AS TEXT) LIKE '____-__-__T%'`;

let rewritten = false;

/** Rewrites stored ISO values once per process. A failure is logged and tried again next time. */
export async function ensureSyncRunAtFormat(): Promise<void> {
	if (rewritten) return;
	try {
		await db.execute({ sql: SYNC_RUN_AT_REWRITE, args: [] });
		rewritten = true;
	} catch (error) {
		console.warn('[sync] could not rewrite last_run_at to one format', error instanceof Error ? error.message : '');
	}
}

/** For tests: forget that the rewrite ran in this process. */
export function resetSyncRunAtForTests(): void {
	rewritten = false;
}
