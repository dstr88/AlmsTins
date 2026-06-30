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
import { detectOutgoingSince } from './verifyDeposit';

/** Timestamp matching the columns' `to_char(now() … 'YYYY-MM-DD HH24:MI:SS')` default. */
const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

export type DestinationKind = 'address' | 'qr';
export type ProofStatus = 'unproven' | 'proven' | 'lapsed' | 'revoked';
export type ProofMethod = 'none' | 'signed_nonce' | 'dns_txt' | 'well_known' | 'micro_deposit' | 'account_claim';

/** Rails offered for a receiving address (matches the chains the app already supports). */
export const ADDRESS_RAILS = ['ethereum', 'polygon', 'avalanche', 'bitcoin', 'solana', 'litecoin'] as const;

/** Free beta limits, per kind: 2 wallet addresses + 1 payment QR (3 destinations total,
 *  one of which can be a QR). One value = one destination; the same QR displayed in many
 *  places is still one row (the UNIQUE(tenant_id, kind, value) index dedups it), so
 *  placements never count against this. */
export const FREE_LIMIT_ADDRESS = 2;
export const FREE_LIMIT_QR = 1;

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
  /** Phase 5 — the public page (if any) we watch for a swap of this destination. */
  monitorUrl: string | null;
  monitorStatus: string | null;
  monitorCheckedAt: string | null;
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

// Claim-once: a (rail, address) can be PROVEN by only one account, globally. This
// partial unique index is the arbiter — a second account proving the same address
// is rejected at the DB layer regardless of who can see what (RLS-agnostic). The
// proof paths catch the violation and skip gracefully. Mirrors
// migrations-pg/0005_verify_claim_once.sql.
const ENSURE_CLAIM_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_destinations_proven_claim
  ON verify_destinations (rail, value) WHERE proof_status = 'proven' AND kind = 'address'`;

// Claim-once for QR/payment-link destinations. A proven (rail, value) URL can belong
// to only one account, globally — the customer-scan match is therefore unambiguous.
// QR destinations are proven on save (proof_method='account_claim'): an owner
// registering a payment link while authenticated in their OWN account IS the claim.
// We normalize the URL before storing (see createDestination), so this index on the
// canonical value is the real exclusivity arbiter. Mirrors
// migrations-pg/0009_verify_qr_claim.sql.
const ENSURE_CLAIM_QR_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_destinations_proven_claim_qr
  ON verify_destinations (rail, value) WHERE proof_status = 'proven' AND kind = 'qr'`;

// Self-send proof: one pending challenge per address destination. Proving needs a
// NEW outgoing tx from the address after issued_at (see verifyDeposit.ts).
// Mirrors migrations-pg/0006_verify_deposit.sql.
const ENSURE_DEPOSIT_SQL = `
  CREATE TABLE IF NOT EXISTS verify_deposit_challenges (
    id              TEXT NOT NULL PRIMARY KEY,
    destination_id  TEXT NOT NULL,
    tenant_id       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    issued_at       TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    last_checked_at TEXT,
    proven_at       TEXT,
    proof_ref       TEXT,
    created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    updated_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_DEPOSIT_IDX = `CREATE UNIQUE INDEX IF NOT EXISTS verify_deposit_challenges_dest
  ON verify_deposit_challenges (destination_id)`;

// Global business-name registry. A business name is claimed like an email handle:
// the normalized name is the PRIMARY KEY, so it belongs to exactly one tenant —
// two businesses can never register the same name. A tenant reuses its own name
// freely across its own destinations. Mirrors migrations-pg/0011_verify_claimed_names.sql.
const ENSURE_NAMES_SQL = `
  CREATE TABLE IF NOT EXISTS verify_claimed_names (
    name_key     TEXT NOT NULL PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;

// Phase 5 — published-source swap monitor. A destination can carry an optional public
// page URL we re-check for a swap of its value. Lazy column adds; mirrors
// migrations-pg/0010_verify_monitor.sql.
const ENSURE_MONITOR_COLS = [
  `ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS monitor_url TEXT`,
  `ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS monitor_status TEXT`,
  `ALTER TABLE verify_destinations ADD COLUMN IF NOT EXISTS monitor_checked_at TEXT`,
];

let ensured = false;
export async function ensureVerifyTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_SQL, args: [] });
  await db.execute({ sql: ENSURE_IDX, args: [] });
  await db.execute({ sql: ENSURE_PROOFS_SQL, args: [] });
  await db.execute({ sql: ENSURE_PROOFS_IDX, args: [] });
  await db.execute({ sql: ENSURE_DEPOSIT_SQL, args: [] });
  await db.execute({ sql: ENSURE_DEPOSIT_IDX, args: [] });
  await db.execute({ sql: ENSURE_NAMES_SQL, args: [] });
  for (const sql of ENSURE_MONITOR_COLS) {
    try { await db.execute({ sql, args: [] }); }
    catch (e) { console.error('[verify] monitor column not applied:', e); }
  }
  // Backstop only — never let a pre-existing duplicate-proven row break Verify.
  try { await db.execute({ sql: ENSURE_CLAIM_IDX, args: [] }); }
  catch (e) { console.error('[verify] claim-once index not applied (resolve duplicate proven claims):', e); }
  try { await db.execute({ sql: ENSURE_CLAIM_QR_IDX, args: [] }); }
  catch (e) { console.error('[verify] QR claim-once index not applied (resolve duplicate proven URLs):', e); }
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
    monitorUrl: r.monitor_url ? String(r.monitor_url) : null,
    monitorStatus: r.monitor_status ? String(r.monitor_status) : null,
    monitorCheckedAt: r.monitor_checked_at ? String(r.monitor_checked_at) : null,
  };
}

export async function listDestinations(tenantId: string): Promise<Destination[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT id, kind, rail, value, label, proof_method, proof_status, proof_domain, registered_at, proven_at, monitor_url, monitor_status, monitor_checked_at
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

/**
 * Canonical form of a business name for the global-uniqueness check. Like an email,
 * the name is case-insensitive and whitespace-normalized, so "Joe's Coffee", "joe's
 * coffee", and "Joe's   Coffee " all collide. Returns '' for an empty/blank name.
 */
export function normalizeName(raw: string): string {
  return (raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
  | { ok: false; error: 'limit_reached' | 'duplicate' | 'invalid' | 'claimed_elsewhere' | 'name_taken'; message: string };

export async function createDestination(
  tenantId: string,
  input: { kind: DestinationKind; rail: string; value: string; label?: string | null },
): Promise<CreateResult> {
  await ensureVerifyTables();
  const kind: DestinationKind = input.kind === 'qr' ? 'qr' : 'address';
  const rail = String(input.rail || (kind === 'qr' ? 'url' : 'ethereum')).slice(0, 32);
  const rawValue = String(input.value ?? '').trim();
  if (!rawValue || rawValue.length > 512) {
    return { ok: false, error: 'invalid', message: 'A destination value is required.' };
  }
  // QR/payment-link destinations are stored canonicalized so the claim-once index and
  // the customer-scan match operate on one stable form. Addresses keep the owner's
  // exact entry (checksum case etc.), as before.
  const value = kind === 'qr' ? normalizeDestinationValue(rawValue) : rawValue;
  if (!value) {
    return { ok: false, error: 'invalid', message: 'A destination value is required.' };
  }
  const label = input.label ? String(input.label).trim().slice(0, 80) || null : null;

  // Free beta limit, per kind: 2 wallet addresses + 1 payment QR. Placements don't count
  // (the same QR in ten spots is one registered value).
  const kindLimit = kind === 'qr' ? FREE_LIMIT_QR : FREE_LIMIT_ADDRESS;
  const countRes = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM verify_destinations WHERE tenant_id = ? AND kind = ?`,
    args: [tenantId, kind],
  });
  if (Number((countRes.rows[0] as any)?.cnt ?? 0) >= kindLimit) {
    return {
      ok: false,
      error: 'limit_reached',
      message: kind === 'qr'
        ? 'Free beta includes 1 payment QR. Need more? Get in touch.'
        : 'Free beta includes 2 wallet addresses. Need more? Get in touch.',
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

  // Global business-name uniqueness (like an email handle). A given name belongs to one
  // tenant; another tenant cannot register it. The same tenant reuses its own name freely.
  // NOTE: uniqueness ≠ authenticity — first-come, no identity check; it prevents duplicate
  // names, not impersonation. Gate name-claims behind proof later to close squatting.
  const nameKey = label ? normalizeName(label) : '';
  if (nameKey) {
    const owner = await db.execute({
      sql: `SELECT tenant_id FROM verify_claimed_names WHERE name_key = ? LIMIT 1`,
      args: [nameKey],
    });
    if (owner.rows.length) {
      if (String((owner.rows[0] as any).tenant_id) !== tenantId) {
        return { ok: false, error: 'name_taken', message: 'That business name is already taken. Choose a different name.' };
      }
    } else {
      // Claim it for this tenant. The PK on name_key is the race arbiter: if a
      // concurrent claim beat us, ON CONFLICT DO NOTHING leaves their row and we bail.
      await db.execute({
        sql: `INSERT INTO verify_claimed_names (name_key, tenant_id, display_name)
              VALUES (?, ?, ?) ON CONFLICT (name_key) DO NOTHING`,
        args: [nameKey, tenantId, label],
      });
      const check = await db.execute({
        sql: `SELECT tenant_id FROM verify_claimed_names WHERE name_key = ? LIMIT 1`,
        args: [nameKey],
      });
      if (!check.rows.length || String((check.rows[0] as any).tenant_id) !== tenantId) {
        return { ok: false, error: 'name_taken', message: 'That business name is already taken. Choose a different name.' };
      }
    }
  }

  // QR/payment links are proven on save (account_claim): registering a link while
  // authenticated in your own account IS the proof of ownership. Claim-once keeps it
  // exclusive — if another account already proved this exact URL, we say so rather
  // than create an ambiguous second "verified" row.
  const isQr = kind === 'qr';
  if (isQr) {
    const claimed = await db.execute({
      sql: `SELECT 1 FROM verify_destinations
            WHERE kind = 'qr' AND proof_status = 'proven' AND rail = ? AND value = ? LIMIT 1`,
      args: [rail, value],
    });
    if (claimed.rows.length) {
      return {
        ok: false,
        error: 'claimed_elsewhere',
        message: 'This payment link is already verified by another Almstins account.',
      };
    }
  }

  const id = randomUUID();
  try {
    await db.execute({
      sql: `INSERT INTO verify_destinations
              (id, tenant_id, kind, rail, value, label, proof_method, proof_status, proven_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, tenantId, kind, rail, value, label,
        isQr ? 'account_claim' : 'none',
        isQr ? 'proven' : 'unproven',
        isQr ? nowUtc() : null,
      ],
    });
  } catch (e) {
    // A unique-index violation here is a race the pre-checks didn't catch. For a QR
    // it's the global claim-once index (another account proved this URL first); for an
    // address it can only be the per-tenant index (a concurrent same-value insert).
    console.warn('[verify] destination insert blocked (unique violation?):', e);
    return isQr
      ? { ok: false, error: 'claimed_elsewhere', message: 'This payment link is already verified by another Almstins account.' }
      : { ok: false, error: 'duplicate', message: 'You have already registered this destination.' };
  }
  const row = await db.execute({
    sql: `SELECT id, kind, rail, value, label, proof_method, proof_status, proof_domain, registered_at, proven_at, monitor_url, monitor_status, monitor_checked_at
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

// ── Phase 5: published-source swap monitor ───────────────────────────────────

export type SetMonitorResult =
  | { ok: true; destination: Destination }
  | { ok: false; error: 'not_found' | 'invalid_url'; message: string };

/**
 * Set (or clear, with null) the public page URL we watch for a swap of this
 * destination. Tenant-scoped. The URL is validated as a fetchable public https URL by
 * the monitor's SSRF guard at check time; here we only enforce the basic shape so the
 * owner gets immediate feedback. Clearing the URL also clears the last status.
 */
export async function setMonitorUrl(tenantId: string, id: string, url: string | null): Promise<SetMonitorResult> {
  await ensureVerifyTables();
  const dest = await getDestination(tenantId, id);
  if (!dest) return { ok: false, error: 'not_found', message: 'Destination not found.' };

  let monitorUrl: string | null = null;
  if (url != null && url.trim() !== '') {
    const s = url.trim();
    if (!/^https:\/\//i.test(s) || s.length > 512) {
      return { ok: false, error: 'invalid_url', message: 'Enter the full https:// address of the page where you publish this.' };
    }
    try { new URL(s); } catch { return { ok: false, error: 'invalid_url', message: 'That doesn’t look like a valid URL.' }; }
    monitorUrl = s;
  }

  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_destinations
          SET monitor_url = ?, monitor_status = NULL, monitor_checked_at = NULL, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
    args: [monitorUrl, now, id, tenantId],
  });
  const updated = await getDestination(tenantId, id);
  return updated ? { ok: true, destination: updated } : { ok: false, error: 'not_found', message: 'Destination not found.' };
}

export interface MonitorTarget {
  tenantId: string;
  id: string;
  kind: DestinationKind;
  rail: string;
  value: string;
  label: string | null;
  monitorUrl: string;
}

/**
 * Cross-tenant enumeration for the watchman cron — every destination that has a
 * monitor URL set. NOT tenant-scoped: a privileged maintenance job. Only proven
 * destinations are returned (an unproven value isn't a confirmed source of truth yet).
 */
export async function listMonitoredDestinations(): Promise<MonitorTarget[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT tenant_id, id, kind, rail, value, label, monitor_url
          FROM verify_destinations
          WHERE monitor_url IS NOT NULL AND proof_status = 'proven'`,
    args: [],
  });
  return (res.rows as any[]).map((r) => ({
    tenantId: String(r.tenant_id),
    id: String(r.id),
    kind: String(r.kind) === 'qr' ? 'qr' : 'address',
    rail: String(r.rail),
    value: String(r.value),
    label: r.label ? String(r.label) : null,
    monitorUrl: String(r.monitor_url),
  }));
}

/** Stamp the latest monitor outcome (tenant-scoped). */
export async function recordMonitorResult(tenantId: string, id: string, status: string): Promise<void> {
  await ensureVerifyTables();
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_destinations SET monitor_status = ?, monitor_checked_at = ?, updated_at = ?
          WHERE id = ? AND tenant_id = ?`,
    args: [status, now, now, id, tenantId],
  });
}

// ── Phase 3: proof of control (domain attestation) ───────────────────────────

/** Fetch one destination, tenant-scoped. */
export async function getDestination(tenantId: string, id: string): Promise<Destination | null> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT id, kind, rail, value, label, proof_method, proof_status, proof_domain, registered_at, proven_at, monitor_url, monitor_status, monitor_checked_at
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
    if (d.proofStatus === 'proven') { flipped.push(d.id); continue; } // already ours
    try {
      await db.execute({
        sql: `UPDATE verify_destinations
              SET proof_status = 'proven', proof_method = 'well_known', proof_domain = ?, proven_at = ?, updated_at = ?
              WHERE id = ? AND tenant_id = ?`,
        args: [domain, now, now, d.id, tenantId],
      });
      flipped.push(d.id);
    } catch (e) {
      // Claim-once: the partial unique index rejects an address another account has
      // already proven. Leave it unproven for this tenant rather than failing the
      // whole proof — they can't take ownership of someone else's verified address.
      console.warn('[verify] destination not flipped (already claimed elsewhere?):', d.id, e);
    }
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

// ── Phase 5: monitoring / re-validation (merchant .well-known watchman) ───────

export interface ProvenDomainTarget {
  tenantId: string;
  domain: string;
  /** The challenge we issued — re-checked against the still-published file. */
  challenge: string;
}

/**
 * Cross-tenant enumeration for the monitor cron — every domain whose proof is
 * currently 'proven'. NOT tenant-scoped: a privileged maintenance job spanning all
 * tenants. Only 'proven' rows are returned, so a domain we've already flipped to
 * 'failed' isn't re-checked (and isn't re-alerted) until the owner re-proves it.
 */
export async function listProvenDomainsForMonitor(): Promise<ProvenDomainTarget[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT tenant_id, domain, challenge_token FROM verify_domain_proofs WHERE status = 'proven'`,
    args: [],
  });
  return (res.rows as any[]).map(r => ({
    tenantId: String(r.tenant_id),
    domain: String(r.domain),
    challenge: String(r.challenge_token),
  }));
}

/** The address destinations a proven domain currently vouches for (tenant-scoped). */
export async function getProvenAddressDestinations(tenantId: string, domain: string): Promise<Destination[]> {
  await ensureVerifyTables();
  const res = await db.execute({
    sql: `SELECT id, kind, rail, value, label, proof_method, proof_status, proof_domain, registered_at, proven_at, monitor_url, monitor_status, monitor_checked_at
          FROM verify_destinations
          WHERE tenant_id = ? AND proof_domain = ? AND proof_status = 'proven' AND kind = 'address'`,
    args: [tenantId, domain],
  });
  return (res.rows as any[]).map(mapRow);
}

/**
 * Flip specific destinations back to 'lapsed' (no longer vouched by the published
 * file). The dashboard then prompts a re-prove. Flipping them OUT of 'proven' also
 * dedups the alert — next run they're excluded from the expected set.
 */
export async function markDestinationsLapsed(tenantId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await ensureVerifyTables();
  const now = nowUtc();
  for (const id of ids) {
    await db.execute({
      sql: `UPDATE verify_destinations SET proof_status = 'lapsed', updated_at = ?
            WHERE id = ? AND tenant_id = ?`,
      args: [now, id, tenantId],
    });
  }
}

/** Whole-domain failure: flip the proof to 'failed' so it stops being monitored until re-proven. */
export async function markDomainProofFailed(tenantId: string, domain: string): Promise<void> {
  await ensureVerifyTables();
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_domain_proofs SET status = 'failed', last_checked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND domain = ?`,
    args: [now, now, tenantId, domain],
  });
}

/** Stamp a clean (or transiently-unreachable) re-check without changing status. */
export async function markDomainProofRechecked(tenantId: string, domain: string): Promise<void> {
  await ensureVerifyTables();
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_domain_proofs SET last_checked_at = ?, updated_at = ?
          WHERE tenant_id = ? AND domain = ?`,
    args: [now, now, tenantId, domain],
  });
}

// ── Phase 4 (self-send): micro-deposit proof of control ──────────────────────

export type DepositChallengeResult =
  | { ok: true; rail: string; address: string; issuedAt: string }
  | { ok: false; error: 'not_found' | 'not_address' | 'already_proven' };

/**
 * Issue (or return the existing) self-send challenge for an address destination.
 * Idempotent — the detection window runs from the original issued_at, so re-opening
 * the panel keeps the same challenge. Tenant-scoped.
 */
export async function issueDepositChallenge(tenantId: string, destinationId: string): Promise<DepositChallengeResult> {
  await ensureVerifyTables();
  const dest = await getDestination(tenantId, destinationId);
  if (!dest) return { ok: false, error: 'not_found' };
  if (dest.kind !== 'address') return { ok: false, error: 'not_address' };
  if (dest.proofStatus === 'proven') return { ok: false, error: 'already_proven' };

  const existing = await db.execute({
    sql: `SELECT issued_at FROM verify_deposit_challenges WHERE destination_id = ? AND tenant_id = ? LIMIT 1`,
    args: [destinationId, tenantId],
  });
  if (existing.rows.length) {
    return { ok: true, rail: dest.rail, address: dest.value, issuedAt: String((existing.rows[0] as any).issued_at) };
  }
  const issuedAt = nowUtc();
  await db.execute({
    sql: `INSERT INTO verify_deposit_challenges (id, destination_id, tenant_id, status, issued_at)
          VALUES (?, ?, ?, 'pending', ?)`,
    args: [randomUUID(), destinationId, tenantId, issuedAt],
  });
  return { ok: true, rail: dest.rail, address: dest.value, issuedAt };
}

export type MicroDepositOutcome =
  | 'proven' | 'not_yet' | 'no_challenge' | 'not_found' | 'not_address'
  | 'already_proven' | 'claimed_elsewhere' | 'unsupported_rail' | 'unavailable';

/**
 * Check the chain for the self-send and, if a new outgoing tx is found, flip the
 * destination to proven. The flip passes through the claim-once guard (the partial
 * unique index): if another account already proved this address, we report
 * 'claimed_elsewhere' rather than taking it. Read-only chain access — no movement.
 */
export async function verifyMicroDeposit(
  tenantId: string,
  destinationId: string,
): Promise<{ outcome: MicroDepositOutcome; ref?: string }> {
  await ensureVerifyTables();
  const dest = await getDestination(tenantId, destinationId);
  if (!dest) return { outcome: 'not_found' };
  if (dest.kind !== 'address') return { outcome: 'not_address' };
  if (dest.proofStatus === 'proven') return { outcome: 'already_proven' };

  const ch = await db.execute({
    sql: `SELECT issued_at FROM verify_deposit_challenges WHERE destination_id = ? AND tenant_id = ? LIMIT 1`,
    args: [destinationId, tenantId],
  });
  if (!ch.rows.length) return { outcome: 'no_challenge' };
  const issuedAt = String((ch.rows[0] as any).issued_at);

  const detected = await detectOutgoingSince(dest.rail, dest.value, issuedAt);
  const now = nowUtc();
  await db.execute({
    sql: `UPDATE verify_deposit_challenges SET last_checked_at = ?, updated_at = ? WHERE destination_id = ? AND tenant_id = ?`,
    args: [now, now, destinationId, tenantId],
  });

  if (!detected.found) {
    if (detected.reason === 'unsupported_rail') return { outcome: 'unsupported_rail' };
    if (detected.reason === 'unavailable') return { outcome: 'unavailable' };
    return { outcome: 'not_yet' };
  }

  // Claim-once: the partial unique index rejects the flip if another account already
  // proved this (rail, value). Catch and report rather than failing hard.
  try {
    await db.execute({
      sql: `UPDATE verify_destinations
            SET proof_status = 'proven', proof_method = 'micro_deposit', proven_at = ?, updated_at = ?
            WHERE id = ? AND tenant_id = ? AND proof_status <> 'proven'`,
      args: [now, now, destinationId, tenantId],
    });
  } catch (e) {
    console.warn('[verify] micro-deposit flip blocked (claimed elsewhere?):', destinationId, e);
    return { outcome: 'claimed_elsewhere' };
  }
  await db.execute({
    sql: `UPDATE verify_deposit_challenges SET status = 'proven', proven_at = ?, proof_ref = ?, updated_at = ?
          WHERE destination_id = ? AND tenant_id = ?`,
    args: [now, detected.ref, now, destinationId, tenantId],
  });
  return { outcome: 'proven', ref: detected.ref };
}
