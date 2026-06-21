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
import { generateChallenge } from './verifyProof';

/** Timestamp matching the columns' `to_char(now() … 'YYYY-MM-DD HH24:MI:SS')` default. */
const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

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
  proofDomain: string | null;
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
    proof_domain  TEXT,
    registered_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    proven_at     TEXT,
    created_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_destinations_tenant_value
  ON verify_destinations (tenant_id, kind, value)`;

// Phase 3 — proof of control. One challenge per (tenant, domain); proving the
// domain flips every destination whose value the published file vouches for.
// Tenant-scoped, app-enforced isolation. Mirrors migrations-pg/0002_verify_proof.sql.
const ENSURE_PROOFS_SQL = `
  CREATE TABLE IF NOT EXISTS verify_domain_proofs (
    id              TEXT NOT NULL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    domain          TEXT NOT NULL,
    challenge_token TEXT NOT NULL,
    method          TEXT NOT NULL DEFAULT 'well_known',
    status          TEXT NOT NULL DEFAULT 'pending',
    issued_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    proven_at       TEXT,
    last_checked_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_PROOFS_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_domain_proofs_tenant_domain
  ON verify_domain_proofs (tenant_id, domain)`;

let ensured = false;
export async function ensureVerifyTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_SQL, args: [] });
  await db.execute({ sql: ENSURE_IDX, args: [] });
  await db.execute({ sql: ENSURE_PROOFS_SQL, args: [] });
  await db.execute({ sql: ENSURE_PROOFS_IDX, args: [] });
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
    proofDomain: r.proof_domain ? String(r.proof_domain) : null,
    registeredAt: String(r.registered_at),
    provenAt: r.proven_at ? String(r.proven_at) : null,
  };
}

export async function listDestinations(tenantId: string): Promise<Destination[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT id, kind, rail, value, label, proof_method, proof_status, proof_domain, registered_at, proven_at
          FROM verify_destinations WHERE tenant_id = ?
          ORDER BY kind ASC, registered_at ASC`,
    args: [tenantId],
  });
  return (res.rows as any[]).map(mapRow);
}

/**
 * Normalize a payment value for equality comparison. The registry stores values
 * as the owner entered them, so BOTH sides must be canonicalized the same way:
 *  - http(s) URL  → scheme + lowercased host + path (drop query/hash/trailing slash)
 *  - EVM address  → lowercased 0x… (also pulled out of ethereum:/EIP-681 URIs)
 *  - other chains → strip any URI scheme + trailing params; keep case
 *    (BTC/SOL/LTC base58/bech32 are case-sensitive — never lowercase them)
 */
export function normalizeDestinationValue(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
    } catch { return s.toLowerCase(); }
  }
  const evm = s.match(/0x[a-fA-F0-9]{40}/);
  if (evm) return evm[0].toLowerCase();
  const noScheme = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:/, '');
  return noScheme.split(/[?@\s]/)[0].trim();
}

export interface CompareResult {
  matched: boolean;
  normalizedQuery: string;
  destination: Destination | null;
}

/**
 * Compare a scanned/entered value against the tenant's OWN registered destinations.
 * Match = "still yours"; no match = a destination we never registered (possible swap).
 * A direct equality check against the owner's ground truth — it catches a brand-new
 * clean thief address that no blacklist would flag. Read-only, tenant-scoped.
 */
export async function compareToDestinations(tenantId: string, rawValue: string): Promise<CompareResult> {
  const normalizedQuery = normalizeDestinationValue(rawValue);
  if (!normalizedQuery) return { matched: false, normalizedQuery: '', destination: null };
  const dests = await listDestinations(tenantId);
  const hit = dests.find(d => normalizeDestinationValue(d.value) === normalizedQuery) ?? null;
  return { matched: !!hit, normalizedQuery, destination: hit };
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
    sql: `SELECT id, kind, rail, value, label, proof_method, proof_status, proof_domain, registered_at, proven_at
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

// ── Phase 3: proof of control (domain attestation) ───────────────────────────

/** Fetch one destination, tenant-scoped. */
export async function getDestination(tenantId: string, id: string): Promise<Destination | null> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT id, kind, rail, value, label, proof_method, proof_status, proof_domain, registered_at, proven_at
          FROM verify_destinations WHERE id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  return res.rows.length ? mapRow(res.rows[0]) : null;
}

/**
 * Issue (or return the existing) account-bound challenge for a (tenant, domain).
 * Idempotent so re-opening the panel shows the same file to publish.
 */
export async function issueChallenge(tenantId: string, domain: string): Promise<string> {
  await ensureVerifyTables();
  const existing = await db.execute({
    sql: `SELECT challenge_token FROM verify_domain_proofs WHERE tenant_id = ? AND domain = ? LIMIT 1`,
    args: [tenantId, domain],
  });
  if (existing.rows.length) return String((existing.rows[0] as any).challenge_token);
  const token = generateChallenge();
  await db.execute({
    sql: `INSERT INTO verify_domain_proofs (id, tenant_id, domain, challenge_token, method, status)
          VALUES (?, ?, ?, ?, 'well_known', 'pending')`,
    args: [randomUUID(), tenantId, domain, token],
  });
  return token;
}

/** The challenge we issued for a (tenant, domain), or null if none was issued. */
export async function getChallenge(tenantId: string, domain: string): Promise<string | null> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT challenge_token FROM verify_domain_proofs WHERE tenant_id = ? AND domain = ? LIMIT 1`,
    args: [tenantId, domain],
  });
  return res.rows.length ? String((res.rows[0] as any).challenge_token) : null;
}

/**
 * Record a successful proof: mark the (tenant, domain) proof proven and flip every
 * registered address destination whose value the published file vouches for. Both
 * sides are normalized for the match. Returns the ids of the destinations flipped.
 */
export async function recordProofResult(
  tenantId: string,
  domain: string,
  fileAddresses: string[],
): Promise<string[]> {
  await ensureVerifyTables();
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_domain_proofs
          SET status = 'proven', proven_at = ?, last_checked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND domain = ?`,
    args: [now, now, now, tenantId, domain],
  });
  const vouched = new Set(fileAddresses.map(normalizeDestinationValue).filter(Boolean));
  const dests = await listDestinations(tenantId);
  const flipped: string[] = [];
  for (const d of dests) {
    if (d.kind !== 'address') continue;
    if (!vouched.has(normalizeDestinationValue(d.value))) continue;
    await db.execute({
      sql: `UPDATE verify_destinations
            SET proof_status = 'proven', proof_method = 'well_known', proof_domain = ?, proven_at = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
      args: [domain, now, now, d.id, tenantId],
    });
    flipped.push(d.id);
  }
  return flipped;
}

/** Stamp a check that didn't prove the domain (for re-validation/audit later). */
export async function markProofChecked(tenantId: string, domain: string, status: 'failed' | 'pending'): Promise<void> {
  await ensureVerifyTables();
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_domain_proofs SET status = ?, last_checked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND domain = ?`,
    args: [status, now, now, tenantId, domain],
  });
}
