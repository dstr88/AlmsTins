/**
 * lotIdentificationStamp.ts: a Bitcoin timestamp (OpenTimestamps) for every new batch of lot
 * identifications.
 *
 * One batch (one click, one created_at) is one Merkle tree over its entries (recordProof/merkle.ts);
 * the root goes to the OpenTimestamps calendars once (otsStamp.ts) and the pending proof is kept.
 * Each entry keeps its own inclusion path, which is recomputed from the stored, immutable entries,
 * so nothing per entry is stored besides the batch's ordered ids. Once Bitcoin confirms, the calendar
 * path is merged in (otsUpgrade.ts) and the block's time is looked up and checked against the proof.
 *
 * What a timestamp shows, and no more: this entry existed unchanged no later than the time of the
 * Bitcoin block. It does not show that the choice is sufficient, that an exchange follows it, or
 * anything about tax.
 *
 * Stamping happens at creation. The calendars can be down, so a batch whose submission failed stays
 * 'unstamped' with its attempts counted and is retried (same root, so a retry is safe) the next time
 * the owner opens the page or asks. The same goes for upgrading a pending proof.
 */

import { db } from './db';
import { fromHex } from './recordProof/merkle';
import { stampDigest } from './otsStamp';
import { upgradeOts } from './otsUpgrade';
import { batchRoot, bitcoinAttestations, lookupBlockTime, type StampStatus } from './tax/lotIdentificationTree';
import { ensureLotIdentificationTables, loadIdentifications } from './lotIdentificationStore';
import type { LotIdentification } from './tax/lotIdentification';

export type { StampStatus };

export interface StampRow {
	batchId: string;
	entryIds: string[];
	rootHex: string;
	status: StampStatus;
	otsBase64: string | null;
	calendar: string | null;
	blockHeight: number | null;
	/** ISO time of the Bitcoin block, once looked up and matched to the proof. */
	blockTime: string | null;
	attempts: number;
	lastAttemptAt: string | null;
	createdAt: string;
}

/** Wait this long before asking a calendar or an explorer again about the same batch. */
export const RETRY_AFTER_MS = 5 * 60_000;
const MAX_BATCHES_PER_REFRESH = 10;

// ── Storage ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function toStamp(r: Row): StampRow {
	let ids: string[] = [];
	try {
		const parsed = JSON.parse(str(r.entry_ids_json));
		if (Array.isArray(parsed)) ids = parsed.map(String);
	} catch {
		ids = [];
	}
	const status = str(r.status);
	return {
		batchId: str(r.batch_id),
		entryIds: ids,
		rootHex: str(r.root_hex),
		status: status === 'pending' || status === 'confirmed' ? status : 'unstamped',
		otsBase64: r.ots_base64 == null ? null : str(r.ots_base64),
		calendar: r.calendar == null ? null : str(r.calendar),
		blockHeight: num(r.block_height),
		blockTime: r.block_time == null ? null : str(r.block_time),
		attempts: num(r.attempts) ?? 0,
		lastAttemptAt: r.last_attempt_at == null ? null : str(r.last_attempt_at),
		createdAt: str(r.created_at),
	};
}

const STAMP_COLUMNS = `batch_id, entry_ids_json, root_hex, status, ots_base64, calendar, block_height, block_time, attempts, last_attempt_at, created_at`;

export async function loadStamps(tenantId: string): Promise<Map<string, StampRow>> {
	try {
		await ensureLotIdentificationTables();
		const res = await db.execute({ sql: `SELECT ${STAMP_COLUMNS} FROM lot_identification_stamps WHERE tenant_id = ?`, args: [tenantId] });
		return new Map((res.rows as unknown as Row[]).map((r) => [str(r.batch_id), toStamp(r)]));
	} catch {
		return new Map();
	}
}

export interface StampDeps {
	fetchImpl?: typeof fetch;
	now?: () => Date;
	stamp?: typeof stampDigest;
	upgrade?: typeof upgradeOts;
}

/**
 * Record the batch's root and submit it. The row is written first, so a crash or an unreachable
 * calendar leaves an 'unstamped' batch to retry, never an entry nobody is tracking. Never throws:
 * the entries are already recorded whether or not the stamp worked.
 */
export async function stampBatch(tenantId: string, entries: readonly LotIdentification[], deps: StampDeps = {}): Promise<StampRow | null> {
	if (entries.length === 0) return null;
	try {
		await ensureLotIdentificationTables();
		const { rootHex, ordered } = batchRoot(entries);
		const batchId = ordered[0].batchId;
		await db.execute({
			sql: `INSERT INTO lot_identification_stamps (batch_id, tenant_id, entry_ids_json, root_hex)
			      VALUES (?, ?, ?, ?) ON CONFLICT (batch_id) DO NOTHING`,
			args: [batchId, tenantId, JSON.stringify(ordered.map((e) => e.id)), rootHex],
		});
		return await attemptSubmit(tenantId, batchId, deps);
	} catch (e) {
		console.error('[lot-identifications] stamp failed', e instanceof Error ? e.message : String(e));
		return null;
	}
}

async function loadStamp(tenantId: string, batchId: string): Promise<StampRow | null> {
	const res = await db.execute({ sql: `SELECT ${STAMP_COLUMNS} FROM lot_identification_stamps WHERE tenant_id = ? AND batch_id = ?`, args: [tenantId, batchId] });
	const row = res.rows[0] as unknown as Row | undefined;
	return row ? toStamp(row) : null;
}

async function attemptSubmit(tenantId: string, batchId: string, deps: StampDeps): Promise<StampRow | null> {
	const row = await loadStamp(tenantId, batchId);
	if (!row || row.status !== 'unstamped') return row;
	const nowIso = (deps.now?.() ?? new Date()).toISOString();
	try {
		const { calendar, ots } = await (deps.stamp ?? stampDigest)(Buffer.from(fromHex(row.rootHex)), { fetchImpl: deps.fetchImpl });
		// Only the first writer wins; a second attempt at the same moment changes nothing.
		await db.execute({
			sql: `UPDATE lot_identification_stamps
			         SET status = 'pending', ots_base64 = ?, calendar = ?, attempts = attempts + 1, last_attempt_at = ?
			       WHERE tenant_id = ? AND batch_id = ? AND status = 'unstamped'`,
			args: [ots.toString('base64'), calendar, nowIso, tenantId, batchId],
		});
	} catch {
		await db.execute({
			sql: `UPDATE lot_identification_stamps SET attempts = attempts + 1, last_attempt_at = ?
			       WHERE tenant_id = ? AND batch_id = ? AND status = 'unstamped'`,
			args: [nowIso, tenantId, batchId],
		});
	}
	return loadStamp(tenantId, batchId);
}

async function attemptUpgrade(tenantId: string, row: StampRow, deps: StampDeps): Promise<void> {
	if (!row.otsBase64) return;
	const nowIso = (deps.now?.() ?? new Date()).toISOString();
	let ots = Buffer.from(row.otsBase64, 'base64');
	try {
		if (row.status === 'pending') {
			const up = await (deps.upgrade ?? upgradeOts)(ots, { fetchImpl: deps.fetchImpl });
			if (up.upgraded > 0) ots = Buffer.from(up.ots);
		}
		const atts = bitcoinAttestations(ots);
		if (atts.length === 0) {
			await db.execute({
				sql: `UPDATE lot_identification_stamps SET last_attempt_at = ? WHERE tenant_id = ? AND batch_id = ? AND status = 'pending'`,
				args: [nowIso, tenantId, row.batchId],
			});
			return;
		}
		const first = atts[0];
		const blockTime = row.blockTime ?? (await lookupBlockTime(first, deps.fetchImpl));
		await db.execute({
			sql: `UPDATE lot_identification_stamps
			         SET status = 'confirmed', ots_base64 = ?, block_height = ?, block_time = ?, last_attempt_at = ?
			       WHERE tenant_id = ? AND batch_id = ? AND status IN ('pending', 'confirmed')`,
			args: [ots.toString('base64'), first.height, blockTime, nowIso, tenantId, row.batchId],
		});
	} catch {
		await db.execute({
			sql: `UPDATE lot_identification_stamps SET last_attempt_at = ? WHERE tenant_id = ? AND batch_id = ?`,
			args: [nowIso, tenantId, row.batchId],
		});
	}
}

/**
 * Retry what is waiting: unstamped batches are submitted again, pending ones are asked whether Bitcoin
 * has confirmed them, and a confirmed one without a block time looks it up again. Each batch is tried
 * at most once per RETRY_AFTER_MS, and at most MAX_BATCHES_PER_REFRESH per call. `force` skips the wait
 * (the owner pressing the button).
 */
export async function refreshStamps(tenantId: string, opts: StampDeps & { force?: boolean } = {}): Promise<Map<string, StampRow>> {
	const stamps = await loadStamps(tenantId);
	const nowMs = (opts.now?.() ?? new Date()).getTime();
	let tried = 0;
	for (const row of stamps.values()) {
		const waiting = row.status !== 'confirmed' || row.blockTime === null;
		if (!waiting) continue;
		const last = row.lastAttemptAt ? Date.parse(row.lastAttemptAt) : 0;
		if (!opts.force && Number.isFinite(last) && nowMs - last < RETRY_AFTER_MS) continue;
		if (tried++ >= MAX_BATCHES_PER_REFRESH) break;
		if (row.status === 'unstamped') await attemptSubmit(tenantId, row.batchId, opts).catch(() => null);
		else await attemptUpgrade(tenantId, row, opts);
	}
	return tried > 0 ? loadStamps(tenantId) : stamps;
}

/**
 * Everything the page needs fresh: any batch that has entries but no stamp row (its first attempt died
 * before the row was written) is registered and submitted, then the waiting ones are retried.
 */
export async function refreshAll(tenantId: string, opts: StampDeps & { force?: boolean } = {}): Promise<Map<string, StampRow>> {
	const [entries, stamps] = await Promise.all([loadIdentifications(tenantId), loadStamps(tenantId)]);
	const missing = new Map<string, LotIdentification[]>();
	for (const e of entries) {
		if (stamps.has(e.batchId)) continue;
		const list = missing.get(e.batchId);
		if (list) list.push(e);
		else missing.set(e.batchId, [e]);
	}
	for (const batch of missing.values()) await stampBatch(tenantId, batch, opts);
	return refreshStamps(tenantId, opts);
}
