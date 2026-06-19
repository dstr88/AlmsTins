/**
 * Unified safety-tool usage counter.
 *
 * One append-only `check_log` table backs every public safety check (wallet
 * address checker, dApp/URL checker, and any future tool) via a `kind`
 * discriminator. The subject is hashed (same one-way salt as the address log),
 * so this counts *how many* unique things were checked without recording *what*
 * anyone looked up — consistent with the no-attribution boundary.
 *
 *   recordCheck({ kind: 'wallet', subject: address, request })   // write (fire-and-forget)
 *   recordCheck({ kind: 'dapp',   subject: domain,  request })
 *   await countUniqueChecksByKind()  // → { wallet, dapp }  (one query, for the admin cards)
 */
import { db } from '@/lib/db';
import { hashWithSalt } from '@/lib/analytics/hash';
import { getClientIp } from '@/lib/analytics/ip';

export type CheckKind = 'wallet' | 'dapp';

// Created lazily on first use (the app's ensureTable pattern). Global, no
// tenant_id — the safety tools are public and unauthenticated, so this is
// platform analytics, never tenant data. Memoised per process; resets on failure
// so a transient error doesn't permanently wedge logging.
let tableReady: Promise<void> | null = null;
function ensureTable(): Promise<void> {
	if (!tableReady) {
		tableReady = db
			.execute({
				sql: `CREATE TABLE IF NOT EXISTS check_log (
				        created_at   TEXT    NOT NULL,
				        kind         TEXT    NOT NULL,
				        subject_hash TEXT    NOT NULL,
				        ip_hash      TEXT,
				        chain        TEXT,
				        cache_hit    INTEGER DEFAULT 0
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
 * Record one safety check. Fire-and-forget: never blocks or throws into the
 * caller (a logging failure must never break the actual check response).
 */
export function recordCheck(opts: {
	kind: CheckKind;
	subject: string;
	request: Request;
	fallbackIp?: string;
	chain?: string | null;
	cacheHit?: boolean;
}): void {
	const subjectHash = hashWithSalt(opts.subject);
	const ipHash = hashWithSalt(getClientIp(opts.request) ?? opts.fallbackIp ?? 'unknown');
	void ensureTable()
		.then(() =>
			db.execute({
				sql: `INSERT INTO check_log (created_at, kind, subject_hash, ip_hash, chain, cache_hit)
				      VALUES (?, ?, ?, ?, ?, ?)`,
				args: [new Date().toISOString(), opts.kind, subjectHash, ipHash, opts.chain ?? null, opts.cacheHit ? 1 : 0],
			}),
		)
		.catch((e) => console.warn('[checkLog] log failed:', e instanceof Error ? e.message : e));
}

/**
 * Unique subjects checked, per kind — one GROUP BY for all the admin cards.
 * Throws on query failure; callers (the admin dashboard) wrap it in a fallback.
 */
export async function countUniqueChecksByKind(): Promise<Record<CheckKind, number>> {
	await ensureTable();
	const r = await db.execute({
		sql: `SELECT kind, COUNT(DISTINCT subject_hash) AS n FROM check_log GROUP BY kind`,
	});
	const out: Record<CheckKind, number> = { wallet: 0, dapp: 0 };
	for (const row of r.rows as unknown as Array<{ kind: string; n: number | string }>) {
		if (row.kind === 'wallet' || row.kind === 'dapp') out[row.kind] = Number(row.n);
	}
	return out;
}
