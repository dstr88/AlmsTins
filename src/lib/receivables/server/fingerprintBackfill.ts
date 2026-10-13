/**
 * The fingerprint backfill's triggers (S3). The backfill itself is startFingerprintBackfill in
 * src/lib/receivablesRegistry.ts: single-flight, never started by importing anything.
 *
 *   - kickFingerprintBackfill(): fire-and-forget from request paths (the create, precheck and
 *     lookup routes). Does nothing without a key. At most one start per THROTTLE_MS per process,
 *     and the first call in a process always starts one, so rows written by an older build during
 *     a deploy are picked up within minutes.
 *   - backfillWithin(ms): the hourly anchor cron waits for the run up to `ms`, so "complete"
 *     shows up in the workflow log after a deploy. A run still going when the time is up keeps
 *     going in the background and reports "running".
 *
 * Route tests mock this module. Nothing here logs a key, a kid, an ID or a field.
 */
import { startFingerprintBackfill, type FingerprintBackfillResult } from '@/lib/receivablesRegistry';
import { fingerprintKeyAvailable } from '@/lib/receivables/server/fingerprint';

export const THROTTLE_MS = 5 * 60_000;
let lastStart = 0;

/** Start a backfill run in the background, unless one started here within THROTTLE_MS. */
export function kickFingerprintBackfill(now: number = Date.now()): void {
	if (!fingerprintKeyAvailable()) return;
	if (lastStart && now - lastStart < THROTTLE_MS) return;
	lastStart = now;
	try {
		startFingerprintBackfill().catch(() => console.error('[receivables] fingerprint backfill failed to run'));
	} catch {
		console.error('[receivables] fingerprint backfill failed to start');
	}
}

export type BackfillReport =
	| { fingerprints: 'off' }
	| { fingerprints: 'running' }
	| { fingerprints: 'complete' | 'partial' | 'failed'; updated: number; skipped: number };

/** Run (or join) the backfill and wait for it up to `ms`. Never throws. */
export async function backfillWithin(ms: number): Promise<BackfillReport> {
	if (!fingerprintKeyAvailable()) return { fingerprints: 'off' };
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<'running'>((resolve) => {
		timer = setTimeout(() => resolve('running'), ms);
	});
	try {
		const run = startFingerprintBackfill();
		const done = await Promise.race([run, timeout]);
		if (done === 'running') return { fingerprints: 'running' };
		const r = done as FingerprintBackfillResult;
		if (r.state === 'off') return { fingerprints: 'off' };
		return { fingerprints: r.state, updated: r.updated, skipped: r.skipped };
	} catch {
		return { fingerprints: 'failed', updated: 0, skipped: 0 };
	} finally {
		if (timer) clearTimeout(timer);
	}
}
