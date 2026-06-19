/**
 * Almstins Verify — Destination registry (Phase 1).
 *
 * A Destination is a payment endpoint a merchant publishes and wants to monitor
 * for swaps: a crypto receiving address (kind='address') or a payment QR
 * (kind='qr'). One rail-agnostic table; the proof + monitoring layers build on it.
 *
 * Tenant isolation is app-enforced: every query is scoped by `tenant_id`, exactly
 * like the PetroTins tables. Lazy ensureTables() mirrors that pattern.
 *
 * NON-NEGOTIABLE: read-only, no custody, no fund movement. We store only what the
 * owner registers about their OWN destinations, linked privately to their account.
 */
import { db } from '@/lib/db';
import { randomUUID } from 'crypto';

export type DestinationKind = 'address' | 'qr';
export type ProofStatus = 'unproven' | 'proven' | 'lapsed' | 'revoked';
export type ProofMethod = 'none' | 'signed_nonce' | 'dns_txt' | 'well_known';

/** Rails offered for a receiving address (matches the chains the app already supports). */
export const ADDRESS_RAILS = ['ethereum', 'polygon', 'avalanche', 'bitcoin', 'solana', 'litecoin'] as const;

/** Free early-access limits — per the landing page: 3 receiving addresses + 1 payment QR. */
export const FREE_LIMITS: Record<DestinationKind, number> = { address: 3, qr: 1 };

export interface Destination {
  id: string;
  kind: DestinationKind;
  rail: string;
  value: string;
  label: string | null;
  proofMethod: ProofMethod;
  proofStatus: ProofStatus;
  registeredAt: string;
  provenAt: string | null;
}

const ENSURE_SQL = `
  CREATE TABLE IF NOT EXISTS verify_destinations (
    id            TEXT NOT NULL PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    kind          TEXT NOT NULL,
    rail          TEXT NOT NULL,
    value         TEXT NOT NULL,
    label         TEXT,
    proof_method  TEXT NOT NULL DEFAULT 'none',
    proof_status  TEXT NOT NULL DEFAULT 'unproven',
    registered_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    proven_at     TEXT,
    created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_destinations_tenant_value
  ON verify_destinations (tenant_id, kind, value)`;

let ensured = false;
export async function ensureVerifyTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_SQL, args: [] });
  await db.execute({ sql: ENSURE_IDX, args: [] });
  ensured = true;
}

function mapRow(r: any): Destination {
  return {
    id: String(r.id),
    kind: (String(r.kind) === 'qr' ? 'qr' : 'address'),
    rail: String(r.rail),
    value: String(r.value),
    label: r.label ? String(r.label) : null,
    proofMethod: String(r.proof_method ?? 'none') as ProofMethod,
    proofStatus: String(r.proof_status ?? 'unproven') as ProofStatus,
    registeredAt: String(r.registered_at),
    provenAt: r.proven_at ? String(r.proven_at) : null,
  };
}

export async function listDestinations(tenantId: string): Promise<Destination[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT id, kind, rail, value, label, proof_method, proof_status, registered_at, proven_at
          FROM verify_destinations WHERE tenant_id = ?
          ORDER BY kind ASC, registered_at ASC`,
    args: [tenantId],
  });
  return (res.rows as any[]).map(mapRow);
}

export type CreateResult =
  | { ok: true; destination: Destination }
  | { ok: false; error: 'limit_reached' | 'duplicate' | 'invalid'; message: string };

export async function createDestination(
  tenantId: string,
  input: { kind: DestinationKind; rail: string; value: string; label?: string | null },
): Promise<CreateResult> {
  await ensureVerifyTables();
  const kind: DestinationKind = input.kind === 'qr' ? 'qr' : 'address';
  const rail = String(input.rail || (kind === 'qr' ? 'url' : 'ethereum')).slice(0, 32);
  const value = String(input.value ?? '').trim();
  if (!value || value.length > 512) {
    return { ok: false, error: 'invalid', message: 'A destination value is required.' };
  }
  const label = input.label ? String(input.label).trim().slice(0, 80) || null : null;

  // Free early-access limit (3 addresses + 1 QR).
  const limit = FREE_LIMITS[kind];
  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM verify_destinations WHERE tenant_id = ? AND kind = ?`,
    args: [tenantId, kind],
  });
  if (Number((countRes.rows[0] as any)?.cnt ?? 0) >= limit) {
    return {
      ok: false,
      error: 'limit_reached',
      message: kind === 'qr'
        ? 'Free early access includes 1 payment QR. More capacity is coming.'
        : 'Free early access includes 3 receiving addresses. More capacity is coming.',
    };
  }

  // Per-tenant duplicate guard (also backed by the unique index).
  const dup = await db.execute({
    sql: `SELECT 1 FROM verify_destinations WHERE tenant_id = ? AND kind = ? AND value = ? LIMIT 1`,
    args: [tenantId, kind, value],
  });
  if (dup.rows.length) {
    return { ok: false, error: 'duplicate', message: 'You have already registered this destination.' };
  }

  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO verify_destinations (id, tenant_id, kind, rail, value, label, proof_method, proof_status)
          VALUES (?, ?, ?, ?, ?, ?, 'none', 'unproven')`,
    args: [id, tenantId, kind, rail, value, label],
  });
  const row = await db.execute({
    sql: `SELECT id, kind, rail, value, label, proof_method, proof_status, registered_at, proven_at
          FROM verify_destinations WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  return { ok: true, destination: mapRow(row.rows[0]) };
}

export async function deleteDestination(tenantId: string, id: string): Promise<void> {
  await ensureVerifyTables();
  await db.execute({
    sql: `DELETE FROM verify_destinations WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
}
