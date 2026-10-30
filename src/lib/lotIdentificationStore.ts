/**
 * lotIdentificationStore.ts: the append-only record of lot identifications (lotIdentification.ts says
 * what they mean). Three tenant-scoped tables, created at runtime like the rest of the schema:
 *
 *   lot_identifications           one row per entry. Written once, never updated or deleted here.
 *   lot_identification_stamps     one row per batch: the Bitcoin timestamp of the batch's Merkle root
 *   lot_identification_confirmed  the owner marking an exchange-held entry as confirmed with the exchange
 *
 * created_at is the server's clock at the moment of writing; no request field can set it. Every
 * query is WHERE tenant_id = ?, and the tenant comes from the signed session at the route.
 */

import { randomUUID } from 'node:crypto';
import { db } from './db';
import { parseNewEntries, isEntrySource, type EntrySource, type LotIdentification, type NewEntryError, type IdentificationMethod } from './tax/lotIdentification';

const NOW_SQL = `(to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`;

const ENSURE = [
	`CREATE TABLE IF NOT EXISTS lot_identifications (
		id           TEXT NOT NULL PRIMARY KEY,
		tenant_id    TEXT NOT NULL,
		wallet_key   TEXT NOT NULL,
		method       TEXT NOT NULL,
		effective_at TEXT NOT NULL,
		created_at   TEXT NOT NULL DEFAULT ${NOW_SQL},
		note         TEXT,
		batch_id     TEXT NOT NULL,
		source       TEXT NOT NULL DEFAULT 'manual'
	)`,
	`CREATE INDEX IF NOT EXISTS lot_identifications_tenant_wallet ON lot_identifications (tenant_id, wallet_key, created_at)`,
	`CREATE INDEX IF NOT EXISTS lot_identifications_tenant_batch ON lot_identifications (tenant_id, batch_id)`,
	`CREATE TABLE IF NOT EXISTS lot_identification_stamps (
		batch_id        TEXT NOT NULL PRIMARY KEY,
		tenant_id       TEXT NOT NULL,
		entry_ids_json  TEXT NOT NULL,
		root_hex        TEXT NOT NULL,
		status          TEXT NOT NULL DEFAULT 'unstamped',
		ots_base64      TEXT,
		calendar        TEXT,
		block_height    INTEGER,
		block_time      TEXT,
		attempts        INTEGER NOT NULL DEFAULT 0,
		last_attempt_at TEXT,
		created_at      TEXT NOT NULL DEFAULT ${NOW_SQL}
	)`,
	`CREATE INDEX IF NOT EXISTS lot_identification_stamps_tenant ON lot_identification_stamps (tenant_id, created_at)`,
	`CREATE TABLE IF NOT EXISTS lot_identification_confirmed (
		identification_id TEXT NOT NULL PRIMARY KEY,
		tenant_id         TEXT NOT NULL,
		confirmed_at      TEXT NOT NULL DEFAULT ${NOW_SQL}
	)`,
];

let ensured: Promise<void> | null = null;
export function ensureLotIdentificationTables(): Promise<void> {
	// A run that throws is forgotten so the next call tries again.
	ensured ??= (async () => {
		for (const sql of ENSURE) await db.execute({ sql, args: [] });
	})().catch((e) => {
		ensured = null;
		throw e;
	});
	return ensured;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function toEntry(r: Row): LotIdentification {
	return {
		id: str(r.id),
		walletKey: str(r.wallet_key),
		method: str(r.method) as IdentificationMethod,
		effectiveAt: str(r.effective_at),
		createdAt: str(r.created_at),
		note: r.note == null ? null : str(r.note),
		batchId: str(r.batch_id),
		source: isEntrySource(r.source) ? r.source : 'manual',
	};
}

/**
 * Every entry of the tenant, oldest recorded first. A read that fails throws: figures are never
 * computed as if the owner had recorded nothing.
 */
export async function loadIdentifications(tenantId: string): Promise<LotIdentification[]> {
	await ensureLotIdentificationTables();
	const res = await db.execute({
		sql: `SELECT id, wallet_key, method, effective_at, created_at, note, batch_id, source
		        FROM lot_identifications WHERE tenant_id = ? ORDER BY created_at ASC, id ASC`,
		args: [tenantId],
	});
	return (res.rows as unknown as Row[]).map(toEntry);
}

/** Ids of the exchange-held entries the owner marked confirmed. */
export async function loadConfirmedIds(tenantId: string): Promise<Set<string>> {
	try {
		await ensureLotIdentificationTables();
		const res = await db.execute({ sql: `SELECT identification_id FROM lot_identification_confirmed WHERE tenant_id = ?`, args: [tenantId] });
		return new Set((res.rows as unknown as Row[]).map((r) => str(r.identification_id)));
	} catch {
		return new Set();
	}
}

export interface CreateRequestEntry {
	walletKey: string;
	method: unknown;
	effectiveAt?: unknown;
	note?: unknown;
}

export type CreateResult =
	| { ok: true; batchId: string; createdAt: string; entries: LotIdentification[] }
	| { ok: false; error: NewEntryError };

/**
 * Record entries as one batch. The server's clock is read here, once, and stamps every entry of the
 * batch with the same created_at; an effective time before it is refused. The whole batch is
 * written or none of it. The caller drops what was computed from the old set (invalidateLedger and the
 * tax cache) and stamps the batch on Bitcoin (lotIdentificationStamp.ts).
 */
export async function createIdentifications(tenantId: string, raw: unknown, source: EntrySource = 'manual', now: () => Date = () => new Date()): Promise<CreateResult> {
	await ensureLotIdentificationTables();
	const createdAt = now().toISOString();
	const parsed = parseNewEntries(raw, createdAt);
	if (!parsed.ok) return parsed;

	const batchId = randomUUID();
	const entries: LotIdentification[] = parsed.entries.map((e) => ({
		id: randomUUID(),
		walletKey: e.walletKey,
		method: e.method,
		effectiveAt: e.effectiveAt,
		createdAt,
		note: e.note,
		batchId,
		source,
	}));
	await db.batch(
		entries.map((e) => ({
			sql: `INSERT INTO lot_identifications (id, tenant_id, wallet_key, method, effective_at, created_at, note, batch_id, source)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [e.id, tenantId, e.walletKey, e.method, e.effectiveAt, e.createdAt, e.note, e.batchId, source],
		})),
	);
	return { ok: true, batchId, createdAt, entries };
}

/** Mark an exchange-held entry as confirmed with the exchange. False when the entry is not this tenant's. */
export async function confirmWithExchange(tenantId: string, identificationId: string): Promise<boolean> {
	await ensureLotIdentificationTables();
	const found = await db.execute({
		sql: `SELECT wallet_key FROM lot_identifications WHERE tenant_id = ? AND id = ?`,
		args: [tenantId, identificationId],
	});
	const key = str((found.rows[0] as Row | undefined)?.wallet_key);
	if (!key || !key.toLowerCase().startsWith('cex:')) return false;
	await db.execute({
		sql: `INSERT INTO lot_identification_confirmed (identification_id, tenant_id) VALUES (?, ?)
		      ON CONFLICT (identification_id) DO NOTHING`,
		args: [identificationId, tenantId],
	});
	return true;
}
