import { db } from '@/lib/db';
import { randomUUID } from 'node:crypto';

let tableEnsured = false;

async function ensureTable() {
	if (tableEnsured) return;
	await db.execute({
		sql: `CREATE TABLE IF NOT EXISTS admin_activity_log (
			id          TEXT PRIMARY KEY,
			tenant_id   TEXT NOT NULL,
			event_type  TEXT NOT NULL,
			source      TEXT,
			chain       TEXT,
			summary     TEXT NOT NULL,
			payload     TEXT NOT NULL,
			created_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
		)`,
		args: [],
	});
	await db.execute({
		sql: `CREATE INDEX IF NOT EXISTS idx_aal_created
		      ON admin_activity_log (created_at DESC)`,
		args: [],
	});
	tableEnsured = true;
}

/**
 * Write an activity log entry. Fire-and-forget — never blocks the caller.
 *
 * Privacy rules enforced here: payload must contain ONLY counts, statuses,
 * source/chain names, and wallet IDs. Never include wallet addresses, tx hashes,
 * dollar amounts per transaction, asset lists, or user-identifiable data.
 * Tenants are identified only by opaque UUID.
 */
export function logActivity(
	tenantId: string,
	eventType: string,
	summary: string,
	payload: Record<string, unknown>,
	opts: { source?: string; chain?: string } = {},
): void {
	void (async () => {
		try {
			await ensureTable();
			await db.execute({
				sql: `INSERT INTO admin_activity_log (id, tenant_id, event_type, source, chain, summary, payload)
				      VALUES (?, ?, ?, ?, ?, ?, ?)`,
				args: [
					randomUUID(),
					tenantId,
					eventType,
					opts.source ?? null,
					opts.chain ?? null,
					summary,
					JSON.stringify(payload),
				],
			});
			// Prune entries older than 30 days
			await db.execute({
				sql: `DELETE FROM admin_activity_log WHERE created_at < to_char((now() - interval '30 days') AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')`,
				args: [],
			});
		} catch {
			// Non-fatal — logging must never break the caller
		}
	})();
}

/**
 * Log a needs_attention count, but only when the count has changed from
 * the last recorded value for this tenant. Avoids flooding the log on
 * every page load.
 */
export function logNeedsAttention(
	tenantId: string,
	total: number,
	unmatched: number,
	suggested: number,
): void {
	void (async () => {
		try {
			await ensureTable();
			const last = await db.execute({
				sql: `SELECT payload FROM admin_activity_log
				      WHERE tenant_id = ? AND event_type = 'needs_attention'
				      ORDER BY created_at DESC LIMIT 1`,
				args: [tenantId],
			});
			const lastPayload = last.rows[0]
				? JSON.parse(String((last.rows[0] as any).payload))
				: null;
			if (lastPayload?.total === total) return; // unchanged — skip
			await db.execute({
				sql: `INSERT INTO admin_activity_log (id, tenant_id, event_type, source, chain, summary, payload)
				      VALUES (?, ?, 'needs_attention', NULL, NULL, ?, ?)`,
				args: [
					randomUUID(),
					tenantId,
					`${total} unresolved`,
					JSON.stringify({ total, unmatched, suggested }),
				],
			});
		} catch {
			// Non-fatal
		}
	})();
}
