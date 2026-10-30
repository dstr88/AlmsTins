/**
 * allocationOverride.ts: the owner's own January 1, 2025 allocation of a coin's cost basis to the
 * wallets and accounts that held it, stored per tenant. When one is saved for a coin it replaces
 * the reconstruction for that coin, all or nothing; the ledger core (lotLedger.ts) checks that it
 * holds the same units per wallet as the history does and draws only on the lots left at the end
 * of 2024, and refuses it (with a finding) otherwise.
 *
 * Every query is scoped by tenant_id. The table is created at runtime the way wallet_identity is
 * (migrations-pg/0063_tax_wallet_allocation_override.sql is the durable mirror).
 */

import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { normalizeAsset } from './normalize';
import type { AllocationOverride, AllocationOverrideRow } from './lotLedger';

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS tax_wallet_allocation_override (
	id               TEXT PRIMARY KEY,
	tenant_id        TEXT NOT NULL,
	asset_symbol     TEXT NOT NULL,
	wallet_key       TEXT NOT NULL,
	lot_acquired_at  TEXT NOT NULL,
	quantity         DOUBLE PRECISION NOT NULL,
	cost_basis_usd   DOUBLE PRECISION,
	note             TEXT,
	created_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
	updated_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
)`;
const CREATE_INDEX = `CREATE INDEX IF NOT EXISTS idx_tax_wallet_alloc_override_tenant_asset ON tax_wallet_allocation_override (tenant_id, asset_symbol)`;

export const NOTE_MAX = 200;

let ensurePromise: Promise<void> | null = null;

/** Single-flight; a run that throws is forgotten so the next call tries again. */
export function ensureWalletAllocationOverrideTable(): Promise<void> {
	if (!ensurePromise) {
		const run = (async () => {
			await db.execute({ sql: CREATE_TABLE, args: [] });
			await db.execute({ sql: CREATE_INDEX, args: [] });
		})();
		ensurePromise = run;
		run.catch(() => {
			if (ensurePromise === run) ensurePromise = null;
		});
	}
	return ensurePromise;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? '' : String(v));

export interface StoredAllocationRow extends AllocationOverrideRow {
	note: string | null;
}

export interface StoredAllocation {
	asset: string;
	rows: StoredAllocationRow[];
}

/** The tenant's saved allocations, one per coin. A missing table or a failed read is no allocation, never an error. */
export async function loadStoredAllocations(tenantId: string): Promise<StoredAllocation[]> {
	let res;
	try {
		res = await db.execute({
			sql: `/* tax:allocation-overrides */ SELECT asset_symbol, wallet_key, lot_acquired_at, quantity, cost_basis_usd, note
			        FROM tax_wallet_allocation_override WHERE tenant_id = ?
			       ORDER BY asset_symbol, wallet_key, lot_acquired_at`,
			args: [tenantId],
		});
	} catch {
		return [];
	}
	const byAsset = new Map<string, StoredAllocationRow[]>();
	for (const r of res.rows as unknown as Row[]) {
		const asset = normalizeAsset(str(r.asset_symbol));
		const qty = typeof r.quantity === 'number' ? r.quantity : Number(r.quantity);
		if (!asset || !Number.isFinite(qty) || qty <= 0) continue;
		const list = byAsset.get(asset) ?? [];
		list.push({
			wallet: str(r.wallet_key),
			acquiredAt: str(r.lot_acquired_at),
			qty,
			costUsd: typeof r.cost_basis_usd === 'number' ? r.cost_basis_usd : null,
			note: str(r.note) || null,
		});
		byAsset.set(asset, list);
	}
	return [...byAsset].map(([asset, rows]) => ({ asset, rows }));
}

/** What the ledger takes: the saved allocations without the notes. */
export async function loadAllocationOverrides(tenantId: string): Promise<AllocationOverride[]> {
	return (await loadStoredAllocations(tenantId)).map(({ asset, rows }) => ({
		asset,
		rows: rows.map(({ wallet, acquiredAt, qty, costUsd }) => ({ wallet, acquiredAt, qty, costUsd })),
	}));
}

export interface AllocationInputRow {
	walletKey: string;
	lotAcquiredAt: string;
	quantity: number;
	costBasisUsd?: number | null;
	note?: string | null;
}

/** Rows as the API accepts them, or the first thing wrong with them. Pure. */
export function parseAllocationRows(input: unknown): { ok: true; rows: AllocationInputRow[] } | { ok: false; error: string } {
	if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'rows_required' };
	if (input.length > 500) return { ok: false, error: 'too_many_rows' };
	const rows: AllocationInputRow[] = [];
	for (const raw of input) {
		if (!raw || typeof raw !== 'object') return { ok: false, error: 'row_invalid' };
		const r = raw as Record<string, unknown>;
		const walletKey = typeof r.walletKey === 'string' ? r.walletKey.trim() : '';
		const lotAcquiredAt = typeof r.lotAcquiredAt === 'string' ? r.lotAcquiredAt.trim() : '';
		const quantity = typeof r.quantity === 'number' ? r.quantity : NaN;
		if (!walletKey || walletKey.length > 200) return { ok: false, error: 'wallet_key_invalid' };
		if (!lotAcquiredAt || lotAcquiredAt.length > 40 || !Number.isFinite(Date.parse(lotAcquiredAt.includes('T') ? lotAcquiredAt : `${lotAcquiredAt.replace(' ', 'T')}Z`))) {
			return { ok: false, error: 'lot_date_invalid' };
		}
		if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: 'quantity_invalid' };
		let costBasisUsd: number | null = null;
		if (r.costBasisUsd != null) {
			if (typeof r.costBasisUsd !== 'number' || !Number.isFinite(r.costBasisUsd) || r.costBasisUsd < 0) return { ok: false, error: 'cost_invalid' };
			costBasisUsd = r.costBasisUsd;
		}
		const note = typeof r.note === 'string' ? r.note.trim().slice(0, NOTE_MAX) : null;
		rows.push({ walletKey, lotAcquiredAt, quantity, costBasisUsd, note: note || null });
	}
	return { ok: true, rows };
}

/** Replace the tenant's allocation for one coin with these rows (all or nothing: one batch). */
export async function saveAllocation(tenantId: string, asset: string, rows: readonly AllocationInputRow[]): Promise<void> {
	await ensureWalletAllocationOverrideTable();
	const coin = normalizeAsset(asset);
	await db.batch(
		[
			{ sql: `DELETE FROM tax_wallet_allocation_override WHERE tenant_id = ? AND asset_symbol = ?`, args: [tenantId, coin] },
			...rows.map((r) => ({
				sql: `INSERT INTO tax_wallet_allocation_override (id, tenant_id, asset_symbol, wallet_key, lot_acquired_at, quantity, cost_basis_usd, note)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [randomUUID(), tenantId, coin, r.walletKey, r.lotAcquiredAt, r.quantity, r.costBasisUsd ?? null, r.note ?? null],
			})),
		],
		'write',
	);
}

/** Remove the tenant's allocation for one coin; the reconstruction applies again. */
export async function deleteAllocation(tenantId: string, asset: string): Promise<void> {
	await ensureWalletAllocationOverrideTable();
	await db.execute({
		sql: `DELETE FROM tax_wallet_allocation_override WHERE tenant_id = ? AND asset_symbol = ?`,
		args: [tenantId, normalizeAsset(asset)],
	});
}
