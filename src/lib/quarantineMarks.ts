/**
 * The addresses a user quarantined themselves (src/lib/quarantine.ts), in their own table. Kept
 * apart so the history warnings (poisoningFlags.ts) and the quarantine list can both read it
 * without importing each other.
 */

import { db } from './db';

let tableReady: Promise<void> | null = null;

/** The table of addresses the user quarantined themselves, created on first use. */
export function ensureQuarantineTable(): Promise<void> {
	if (!tableReady) {
		tableReady = db
			.execute({
				sql: `CREATE TABLE IF NOT EXISTS address_quarantine (
				        tenant_id  TEXT NOT NULL,
				        address    TEXT NOT NULL,
				        created_at TEXT NOT NULL,
				        PRIMARY KEY (tenant_id, address)
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

/** The addresses the user quarantined themselves. */
export async function loadQuarantineMarks(tenantId: string): Promise<{ address: string; createdAt: string }[]> {
	await ensureQuarantineTable();
	const res = await db.execute({ sql: 'SELECT address, created_at FROM address_quarantine WHERE tenant_id = ?', args: [tenantId] });
	return (res.rows as Record<string, unknown>[]).map((r) => ({ address: String(r.address ?? ''), createdAt: String(r.created_at ?? '') }));
}

