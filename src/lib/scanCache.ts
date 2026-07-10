/**
 * Persistent, privacy-preserving cache for public safety-check results.
 *
 * Keyed on the SAME one-way hash the usage log uses (`hashWithSalt(subject)`),
 * NOT the raw address/URL. This is deliberate: the public policy commitment is
 * that "the raw address is never stored". Exact-match caching only needs to know
 * "have I seen this exact subject before, and what was the verdict?" — a
 * question a hash answers perfectly (same input → same hash), so we get real
 * cross-request cache hits without ever persisting a raw subject.
 *
 * Why a DB cache (vs. the in-memory ones): it survives deploys/restarts, so it
 * actually protects paid upstream API quota (VirusTotal / Google Safe Browsing)
 * across the day instead of cold-starting on every deploy. A cache HIT returns a
 * stored verdict with ZERO external API calls.
 *
 * All operations are fail-soft: any cache error is swallowed so a live check
 * never breaks because the cache is unavailable.
 */
import { db } from '@/lib/db';
import { hashWithSalt } from '@/lib/analytics/hash';

export type ScanKind = 'wallet' | 'dapp';

let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
	if (!tableReady) {
		tableReady = db
			.execute({
				sql: `CREATE TABLE IF NOT EXISTS scan_cache (
				        kind         TEXT NOT NULL,
				        subject_hash TEXT NOT NULL,
				        verdict_json TEXT NOT NULL,
				        checked_at   TEXT NOT NULL,
				        PRIMARY KEY (kind, subject_hash)
				      )`,
			})
			.then(() => {})
			.catch((e) => {
				tableReady = null;
				throw e;
			});
	}
	return tableReady;
}

/**
 * Look up a cached verdict by hashed subject. Returns the stored payload and its
 * age in ms, or null on miss / error. The caller decides whether the age is
 * within its freshness window (which can vary by verdict).
 */
export async function getCachedScan(
	kind: ScanKind,
	subject: string,
): Promise<{ value: any; ageMs: number } | null> {
	try {
		await ensureTable();
		const r = await db.execute({
			sql: `SELECT verdict_json, checked_at FROM scan_cache WHERE kind = ? AND subject_hash = ?`,
			args: [kind, hashWithSalt(subject)],
		});
		const row = r.rows[0] as { verdict_json?: string; checked_at?: string } | undefined;
		if (!row?.verdict_json || !row.checked_at) return null;
		const ageMs = Date.now() - Date.parse(row.checked_at);
		if (!Number.isFinite(ageMs)) return null;
		return { value: JSON.parse(row.verdict_json), ageMs };
	} catch (e) {
		console.warn('[scanCache] read failed:', e instanceof Error ? e.message : e);
		return null; // fail-soft: a cache miss is always safe
	}
}

/** Store (or refresh) a verdict for a subject. Fire-and-forget; never throws. */
export async function putCachedScan(kind: ScanKind, subject: string, value: unknown): Promise<void> {
	try {
		await ensureTable();
		await db.execute({
			sql: `INSERT INTO scan_cache (kind, subject_hash, verdict_json, checked_at)
			      VALUES (?, ?, ?, ?)
			      ON CONFLICT (kind, subject_hash) DO UPDATE SET
			        verdict_json = excluded.verdict_json,
			        checked_at   = excluded.checked_at`,
			args: [kind, hashWithSalt(subject), JSON.stringify(value), new Date().toISOString()],
		});
	} catch (e) {
		console.warn('[scanCache] write failed:', e instanceof Error ? e.message : e);
	}
}
