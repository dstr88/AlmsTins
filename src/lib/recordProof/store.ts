// Persist verifiable records so they survive live-data changes. Two insert-only,
// tenant-scoped tables (no UPDATE/DELETE helpers exist here — a correction is a
// NEW record_id chained via prev_root):
//   • record_proofs          — one row per generated record (root, signature, counts)
//   • record_proof_snapshot  — the FROZEN ordered leaves (full leaf_json + leaf_hash)
//
// We store the FULL leaves (so Almstins can reproduce the bundle + power authorized
// selective disclosure) but verification surfaces display only leaf_hash. Tenant
// isolation is app-enforced (every query WHERE tenant_id). DDL auto-routes to the
// owner pool via isSchemaDDL in db.pg.ts.

import { db } from '@/lib/db';
import type { ProofBundle, ProofManifest } from './buildProof';
import type { CanonicalLeaf } from './leaf';
import type { Hex } from './merkle';

const ENSURE_PROOFS = `
  CREATE TABLE IF NOT EXISTS record_proofs (
    record_id           TEXT NOT NULL PRIMARY KEY,
    tenant_id           TEXT NOT NULL,
    year                INTEGER NOT NULL,
    record_type         TEXT NOT NULL DEFAULT 'year_summary',
    data_source         TEXT NOT NULL,
    merkle_root         TEXT NOT NULL,
    prev_root           TEXT,
    leaf_count          INTEGER NOT NULL,
    count_short_term    INTEGER NOT NULL DEFAULT 0,
    count_long_term     INTEGER NOT NULL DEFAULT 0,
    count_income        INTEGER NOT NULL DEFAULT 0,
    count_held          INTEGER NOT NULL DEFAULT 0,
    count_unsettled     INTEGER NOT NULL DEFAULT 0,
    tree_algo           TEXT NOT NULL DEFAULT 'sha256-merkle-v1',
    leaf_schema_version INTEGER NOT NULL DEFAULT 1,
    signing_key_id      TEXT,
    signature_hex       TEXT,
    manifest_json       TEXT NOT NULL,
    generated_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  )`;
const ENSURE_PROOFS_IDX =
  `CREATE INDEX IF NOT EXISTS record_proofs_tenant_year ON record_proofs (tenant_id, year, generated_at)`;
const ENSURE_SNAPSHOT = `
  CREATE TABLE IF NOT EXISTS record_proof_snapshot (
    record_id   TEXT NOT NULL,
    tenant_id   TEXT NOT NULL,
    leaf_index  INTEGER NOT NULL,
    leaf_json   TEXT NOT NULL,
    leaf_hash   TEXT NOT NULL,
    PRIMARY KEY (record_id, leaf_index)
  )`;
const ENSURE_SNAPSHOT_IDX =
  `CREATE INDEX IF NOT EXISTS record_proof_snapshot_tenant_record ON record_proof_snapshot (tenant_id, record_id)`;

let ensured = false;
export async function ensureRecordProofTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_PROOFS, args: [] });
  await db.execute({ sql: ENSURE_PROOFS_IDX, args: [] });
  await db.execute({ sql: ENSURE_SNAPSHOT, args: [] });
  await db.execute({ sql: ENSURE_SNAPSHOT_IDX, args: [] });
  ensured = true;
}

/** The merkle_root of the tenant's most recent record for `year` (for prev_root chaining). */
export async function getLatestRoot(tenantId: string, year: number): Promise<Hex | null> {
  await ensureRecordProofTables();
  const r = await db.execute({
    sql: `SELECT merkle_root FROM record_proofs WHERE tenant_id = ? AND year = ? ORDER BY generated_at DESC LIMIT 1`,
    args: [tenantId, year],
  });
  return r.rows.length ? String((r.rows[0] as Record<string, unknown>).merkle_root) : null;
}

/** The record_id of the tenant's most recent record for `year`, or null. */
export async function getLatestRecordId(tenantId: string, year: number): Promise<string | null> {
  await ensureRecordProofTables();
  const r = await db.execute({
    sql: `SELECT record_id FROM record_proofs WHERE tenant_id = ? AND year = ? ORDER BY generated_at DESC LIMIT 1`,
    args: [tenantId, year],
  });
  return r.rows.length ? String((r.rows[0] as Record<string, unknown>).record_id) : null;
}

/** Insert the proof row + all frozen leaves atomically. Insert-only (ON CONFLICT DO NOTHING). */
export async function persistRecordProof(tenantId: string, bundle: ProofBundle): Promise<void> {
  await ensureRecordProofTables();
  const m = bundle.manifest;
  const stmts = [
    {
      sql: `INSERT INTO record_proofs
        (record_id, tenant_id, year, record_type, data_source, merkle_root, prev_root, leaf_count,
         count_short_term, count_long_term, count_income, count_held, count_unsettled,
         tree_algo, leaf_schema_version, signing_key_id, signature_hex, manifest_json, generated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (record_id) DO NOTHING`,
      args: [
        m.record_id, tenantId, Number(m.period), m.record_type, m.data_source, m.merkle_root, m.prev_root,
        m.leaf_count, m.counts.short_term, m.counts.long_term, m.counts.income, m.counts.held, m.counts.unsettled,
        m.tree_algo, m.leaf_schema_version, m.signing_key_id, bundle.signature?.signature_hex ?? null,
        JSON.stringify(m), m.generated_at,
      ],
    },
    ...bundle.leaves.map((leaf, i) => ({
      sql: `INSERT INTO record_proof_snapshot (record_id, tenant_id, leaf_index, leaf_json, leaf_hash)
            VALUES (?,?,?,?,?) ON CONFLICT (record_id, leaf_index) DO NOTHING`,
      args: [m.record_id, tenantId, i, JSON.stringify(leaf), bundle.leaf_hashes[i]],
    })),
  ];
  await db.batch(stmts);
}

export interface StoredRecord {
  manifest: ProofManifest;
  signatureHex: string | null;
  leaves: CanonicalLeaf[];
  leafHashes: Hex[];
}

/** Load a stored record + its frozen ordered leaves (tenant-scoped). */
export async function getStoredRecord(tenantId: string, recordId: string): Promise<StoredRecord | null> {
  await ensureRecordProofTables();
  const head = await db.execute({
    sql: `SELECT manifest_json, signature_hex FROM record_proofs WHERE tenant_id = ? AND record_id = ? LIMIT 1`,
    args: [tenantId, recordId],
  });
  if (!head.rows.length) return null;
  const row = head.rows[0] as Record<string, unknown>;
  const manifest = JSON.parse(String(row.manifest_json)) as ProofManifest;
  const snap = await db.execute({
    sql: `SELECT leaf_index, leaf_json, leaf_hash FROM record_proof_snapshot
          WHERE tenant_id = ? AND record_id = ? ORDER BY leaf_index ASC`,
    args: [tenantId, recordId],
  });
  const leaves: CanonicalLeaf[] = [];
  const leafHashes: Hex[] = [];
  for (const s of snap.rows as Record<string, unknown>[]) {
    leaves.push(JSON.parse(String(s.leaf_json)) as CanonicalLeaf);
    leafHashes.push(String(s.leaf_hash));
  }
  return { manifest, signatureHex: row.signature_hex ? String(row.signature_hex) : null, leaves, leafHashes };
}

export interface ChainRow { record_id: string; merkle_root: Hex; prev_root: Hex | null; generated_at: string; }

/** The tenant's record chain for a year, oldest → newest (for period chaining). */
export async function getRecordChain(tenantId: string, year: number): Promise<ChainRow[]> {
  await ensureRecordProofTables();
  const r = await db.execute({
    sql: `SELECT record_id, merkle_root, prev_root, generated_at FROM record_proofs
          WHERE tenant_id = ? AND year = ? ORDER BY generated_at ASC`,
    args: [tenantId, year],
  });
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    record_id: String(x.record_id), merkle_root: String(x.merkle_root),
    prev_root: x.prev_root ? String(x.prev_root) : null, generated_at: String(x.generated_at),
  }));
}
