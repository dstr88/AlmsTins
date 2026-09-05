/**
 * Almstins Verify — Receivables financing-status registry (v1).
 *
 * Answers one question a second financier must ask before lending: "is this
 * receivable already financed, and by how much?" Duplicate financing happens when
 * that question has no shared answer. This is the shared answer.
 *
 * MODEL — voluntary self-disclosure, exactly like the verified-publisher lookup:
 *   - A receivable is created by an authenticated tenant (supplier/originator). Its
 *     ID is the SHA-256 of its signed creation manifest — an unguessable capability.
 *     You expose a receivable only to counterparties you hand the ID to; nobody can
 *     enumerate the registry.
 *   - Any authenticated tenant holding the ID may register a financing CLAIM against
 *     it (they were given the ID → they are a party). Registering a claim is a public
 *     act by design: the whole point is a shared, checkable status.
 *   - Anyone with the ID may READ the status (public, login-free). The read NEVER
 *     returns tenant_id or any account/identity — only the self-chosen financier
 *     label, amount, and date. Same no-attribution boundary as lookup.ts.
 *
 * BRIGHT LINES: read-only, no custody, no fund movement. Almstins records and proves
 * state; it never makes the financing decision. Reads across tenants are intentional
 * and safe here because each claim is a proof its owner PUBLISHED — this is a shared
 * registry, not a private cross-tenant peek. Writes stay tenant-scoped.
 *
 * SIGNING: Almstins signs each receivable + claim manifest with ITS OWN published key
 * (recordProof/signing.ts), same as record proofs. The stronger per-party model — the
 * financier proves control of their own address and signs the claim with their own key
 * — is the honest v2 upgrade; the primitives for it already exist (verifyDeposit +
 * per-party Ed25519), it's a workflow build, not new cryptography.
 *
 * Lazy ensureTables() + app-enforced tenant isolation, mirroring verifyRegistry.ts.
 */
import { db } from '@/lib/db';
import { randomUUID, randomBytes, createHash } from 'crypto';
import {
  canonicalManifestBytes,
  signManifest,
  getPublicKeyHex,
  getSigningKeyId,
} from '@/lib/recordProof/signing';

/** Timestamp matching the columns' to_char(now() … 'YYYY-MM-DD HH24:MI:SS') default. */
const nowUtc = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

function sha256hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export type ClaimStatus = 'active' | 'discharged';

export interface ReceivableInput {
  supplier: string;
  buyer: string;
  invoiceNo: string;
  face: number;
  currency: string;
  terms?: string | null;
  dueDate?: string | null;
  acknowledgedAt?: string | null;
  /** invoice | purchase_order | contract | milestone | other (his #3) */
  rtype?: string | null;
  paymentMethod?: string | null;
}

export interface Signature {
  keyId: string;
  alg: string;
  signatureHex: string;
  publicKeyHex: string;
}

export interface PublicClaim {
  id: string;
  financier: string;
  amount: number;
  currency: string;
  date: string;
  status: ClaimStatus;
  dischargedAt: string | null;
  signed: boolean;
  anchored: boolean;
  /** Bitcoin block time once the anchor confirms; null while pending or unanchored. */
  anchoredAt: string | null;
  registeredAt: string;
}

export type AttesterRole = 'buyer' | 'supplier' | 'inspector' | 'other';

export interface PublicAttestation {
  id: string;
  role: AttesterRole;
  label: string;
  statement: string;
  date: string;
  signed: boolean;
  anchored: boolean;
  anchoredAt: string | null;
}

export interface ReceivableStatus {
  id: string;
  supplier: string;
  buyer: string;
  invoiceNo: string;
  face: number;
  currency: string;
  terms: string | null;
  dueDate: string | null;
  acknowledgedAt: string | null;
  rtype: string | null;
  paymentMethod: string | null;
  createdAt: string;
  signed: boolean;
  anchored: boolean;
  anchoredAt: string | null;
  settled: boolean;
  settledAt: string | null;
  attestations: PublicAttestation[];
  claims: PublicClaim[];
  claimed: number;
  available: number;
  status: 'unfinanced' | 'partially_financed' | 'fully_financed' | 'over_financed';
  /** Lifecycle stage: created → financed → settled (released = all claims discharged). */
  lifecycle: 'created' | 'financed' | 'released' | 'settled';
}

/** Bitcoin block time from a stored anchor receipt (rwaProof AnchorReceipt), or null
 *  when unanchored / still pending. */
function anchoredAtOf(anchorJson: string | null | undefined): string | null {
  if (!anchorJson) return null;
  try {
    const a = JSON.parse(anchorJson);
    return a && typeof a.anchoredAt === 'string' ? a.anchoredAt : null;
  } catch { return null; }
}

const ENSURE_RECEIVABLES_SQL = `
  CREATE TABLE IF NOT EXISTS receivables (
    id             TEXT NOT NULL PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    supplier       TEXT NOT NULL,
    buyer          TEXT NOT NULL,
    invoice_no     TEXT NOT NULL,
    face           DOUBLE PRECISION NOT NULL,
    currency       TEXT NOT NULL,
    terms          TEXT,
    due_date       TEXT,
    acknowledged_at TEXT,
    rtype          TEXT,
    payment_method TEXT,
    manifest_json  TEXT NOT NULL,
    signature_json TEXT,
    digest         TEXT NOT NULL,
    anchor_json       TEXT,
    settled_at        TEXT,
    settlement_json   TEXT,
    settlement_digest TEXT,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_RECEIVABLES_TENANT_IDX =
  `CREATE INDEX IF NOT EXISTS receivables_tenant ON receivables (tenant_id)`;

// Stage 2 — party attestations bound to a receivable (the buyer acknowledging the debt
// is the load-bearing one). One row = one signed statement by one party. Public reads
// expose only the self-chosen label + statement, never tenant_id/identity.
const ENSURE_ATTESTATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_attestations (
    id             TEXT NOT NULL PRIMARY KEY,
    receivable_id  TEXT NOT NULL,
    tenant_id      TEXT NOT NULL,
    role           TEXT NOT NULL,
    label          TEXT NOT NULL,
    statement      TEXT NOT NULL,
    attested_at    TEXT NOT NULL,
    manifest_json  TEXT NOT NULL,
    signature_json TEXT,
    digest         TEXT NOT NULL,
    anchor_json    TEXT,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_ATTESTATIONS_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_attestations_rcv ON receivable_attestations (receivable_id)`;

const ENSURE_CLAIMS_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_claims (
    id             TEXT NOT NULL PRIMARY KEY,
    receivable_id  TEXT NOT NULL,
    tenant_id      TEXT NOT NULL,
    financier      TEXT NOT NULL,
    amount         DOUBLE PRECISION NOT NULL,
    currency       TEXT NOT NULL,
    claim_date     TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active',
    manifest_json  TEXT NOT NULL,
    signature_json TEXT,
    digest         TEXT NOT NULL,
    anchor_json    TEXT,
    discharged_at    TEXT,
    discharge_json   TEXT,
    discharge_digest TEXT,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_CLAIMS_RCV_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_claims_rcv ON receivable_claims (receivable_id)`;

// Stage 4 (settlement) columns — lazy adds so a table created by an earlier version of
// this file gains them without a migration. IF NOT EXISTS makes each idempotent.
const ENSURE_SETTLEMENT_COLS = [
  `ALTER TABLE receivables ADD COLUMN IF NOT EXISTS rtype TEXT`,
  `ALTER TABLE receivables ADD COLUMN IF NOT EXISTS payment_method TEXT`,
  `ALTER TABLE receivables ADD COLUMN IF NOT EXISTS anchor_json TEXT`,
  `ALTER TABLE receivables ADD COLUMN IF NOT EXISTS settled_at TEXT`,
  `ALTER TABLE receivables ADD COLUMN IF NOT EXISTS settlement_json TEXT`,
  `ALTER TABLE receivables ADD COLUMN IF NOT EXISTS settlement_digest TEXT`,
  `ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharged_at TEXT`,
  `ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharge_json TEXT`,
  `ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharge_digest TEXT`,
];

// ── Invitations and access grants ─────────────────────────────────────────────
//
// Handing someone a receivable ID left no trace, so nothing could answer "who is my
// client?" or "who can see this record?". An invitation binds one account to one role on
// one receivable, and accepting it writes an access grant.
//
// A grant is a disclosure, not ownership: the record stays in the tenant that created it.
// A financier's list is built from grants made TO them, never from a scan of the table,
// so a thousand tenants never see each other.
const ENSURE_INVITES_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_invites (
    token          TEXT NOT NULL PRIMARY KEY,
    receivable_id  TEXT,
    from_tenant    TEXT NOT NULL,
    role           TEXT NOT NULL,
    label          TEXT,
    email          TEXT,
    expires_at     TEXT NOT NULL,
    accepted_at    TEXT,
    accepted_by    TEXT,
    revoked_at     TEXT,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_INVITES_FROM_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_invites_from ON receivable_invites (from_tenant)`;

const ENSURE_ACCESS_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_access (
    id             TEXT NOT NULL PRIMARY KEY,
    receivable_id  TEXT,
    tenant_id      TEXT NOT NULL,
    counterparty   TEXT,
    role           TEXT NOT NULL,
    granted_by     TEXT NOT NULL,
    granted_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    revoked_at     TEXT
  )
`;
const ENSURE_ACCESS_TENANT_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_access_tenant ON receivable_access (tenant_id)`;
const ENSURE_ACCESS_RCV_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_access_rcv ON receivable_access (receivable_id)`;

let ensured = false;
export async function ensureReceivablesTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_RECEIVABLES_SQL, args: [] });
  await db.execute({ sql: ENSURE_RECEIVABLES_TENANT_IDX, args: [] });
  await db.execute({ sql: ENSURE_CLAIMS_SQL, args: [] });
  await db.execute({ sql: ENSURE_CLAIMS_RCV_IDX, args: [] });
  await db.execute({ sql: ENSURE_ATTESTATIONS_SQL, args: [] });
  await db.execute({ sql: ENSURE_ATTESTATIONS_IDX, args: [] });
  await db.execute({ sql: ENSURE_INVITES_SQL, args: [] });
  await db.execute({ sql: ENSURE_INVITES_FROM_IDX, args: [] });
  await db.execute({ sql: ENSURE_ACCESS_SQL, args: [] });
  await db.execute({ sql: ENSURE_ACCESS_TENANT_IDX, args: [] });
  await db.execute({ sql: ENSURE_ACCESS_RCV_IDX, args: [] });
  for (const sql of ENSURE_SETTLEMENT_COLS) {
    try { await db.execute({ sql, args: [] }); }
    catch (e) { console.error('[receivables] settlement column not applied:', e); }
  }
  ensured = true;
}

/** Sign a manifest with the Almstins published key. Returns null when no key is
 *  configured (fail-closed: the record is stored UNSIGNED rather than crashing). */
function sign(manifest: object): { signature: Signature | null; digest: string } {
  const bytes = canonicalManifestBytes(manifest);
  const digest = sha256hex(bytes);
  const sig = signManifest(bytes);
  const pub = getPublicKeyHex();
  if (!sig || !pub) return { signature: null, digest };
  return {
    signature: { keyId: sig.keyId, alg: sig.alg, signatureHex: sig.signatureHex, publicKeyHex: pub },
    digest,
  };
}

const clampStr = (s: unknown, n: number): string => String(s ?? '').trim().slice(0, n);
const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export type CreateReceivableResult =
  | { ok: true; id: string; digest: string; signed: boolean; keyId: string | null }
  | { ok: false; error: 'invalid'; message: string };

/**
 * Create + sign a receivable. Its ID is the SHA-256 of the signed creation manifest,
 * so identical inputs are deterministic but a real invoice+date+parties tuple is
 * effectively unique. tenant_id is recorded as private provenance and NEVER surfaced.
 */
export async function createReceivable(
  tenantId: string,
  input: ReceivableInput,
): Promise<CreateReceivableResult> {
  await ensureReceivablesTables();
  const supplier = clampStr(input.supplier, 160);
  const buyer = clampStr(input.buyer, 160);
  const invoiceNo = clampStr(input.invoiceNo, 80);
  const currency = clampStr(input.currency || 'NGN', 8).toUpperCase() || 'NGN';
  const face = Number(input.face);
  const terms = input.terms != null ? clampStr(input.terms, 80) || null : null;
  const dueDate = isYmd(input.dueDate) ? input.dueDate : null;
  const acknowledgedAt = isYmd(input.acknowledgedAt) ? input.acknowledgedAt : null;
  const rtype = input.rtype != null ? clampStr(input.rtype, 40) || null : null;
  const paymentMethod = input.paymentMethod != null ? clampStr(input.paymentMethod, 40) || null : null;

  if (!supplier || !buyer || !invoiceNo) {
    return { ok: false, error: 'invalid', message: 'Supplier, buyer, and invoice number are required.' };
  }
  if (!Number.isFinite(face) || face <= 0) {
    return { ok: false, error: 'invalid', message: 'Face value must be a positive number.' };
  }

  const receivable = { supplier, buyer, invoiceNo, face, currency, terms, dueDate, acknowledgedAt, rtype, paymentMethod };
  const manifest = { v: 1, kind: 'receivable', receivable };
  const { signature, digest } = sign(manifest);
  const id = sha256hex(canonicalManifestBytes(manifest));

  // Deterministic ID → a re-create of the identical receivable is idempotent.
  const existing = await db.execute({ sql: `SELECT id FROM receivables WHERE id = ? LIMIT 1`, args: [id] });
  if (!existing.rows.length) {
    await db.execute({
      sql: `INSERT INTO receivables
              (id, tenant_id, supplier, buyer, invoice_no, face, currency, terms, due_date, acknowledged_at, rtype, payment_method, manifest_json, signature_json, digest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, tenantId, supplier, buyer, invoiceNo, face, currency, terms, dueDate, acknowledgedAt, rtype, paymentMethod,
        JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest,
      ],
    });
  }
  return { ok: true, id, digest, signed: !!signature, keyId: getSigningKeyId() };
}

interface ReceivableRow {
  id: string; tenant_id: string; supplier: string; buyer: string; invoice_no: string;
  face: number; currency: string; terms: string | null;
  due_date: string | null; acknowledged_at: string | null;
  rtype: string | null; payment_method: string | null;
  signature_json: string | null; anchor_json: string | null; settled_at: string | null; created_at: string;
}

async function getReceivableRow(id: string): Promise<ReceivableRow | null> {
  const r = await db.execute({
    sql: `SELECT id, tenant_id, supplier, buyer, invoice_no, face, currency, terms, due_date, acknowledged_at, rtype, payment_method, signature_json, anchor_json, settled_at, created_at
          FROM receivables WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  return {
    id: String(row.id), tenant_id: String(row.tenant_id),
    supplier: String(row.supplier), buyer: String(row.buyer),
    invoice_no: String(row.invoice_no), face: Number(row.face), currency: String(row.currency),
    terms: row.terms != null ? String(row.terms) : null,
    due_date: row.due_date != null ? String(row.due_date) : null,
    acknowledged_at: row.acknowledged_at != null ? String(row.acknowledged_at) : null,
    rtype: row.rtype != null ? String(row.rtype) : null,
    payment_method: row.payment_method != null ? String(row.payment_method) : null,
    signature_json: row.signature_json != null ? String(row.signature_json) : null,
    anchor_json: row.anchor_json != null ? String(row.anchor_json) : null,
    settled_at: row.settled_at != null ? String(row.settled_at) : null,
    created_at: String(row.created_at),
  };
}

/** Sum of active claims against a receivable. */
async function sumActiveClaims(receivableId: string): Promise<number> {
  const r = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS s FROM receivable_claims WHERE receivable_id = ? AND status = 'active'`,
    args: [receivableId],
  });
  return Number((r.rows[0] as any)?.s ?? 0);
}

export type AddClaimResult =
  | { ok: true; claimId: string; digest: string; signed: boolean; claimed: number; available: number; face: number }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: 'invalid'; message: string }
  | { ok: false; error: 'exceeds_headroom'; message: string; available: number; claimed: number; face: number };

/**
 * Register a financing claim against a receivable. The write is the duplicate-financing
 * guard: if the amount exceeds the unencumbered headroom it is REJECTED with the
 * available figure, unless the caller passes force:true (an explicit, acknowledged
 * over-claim). Signed with the Almstins key; the returned digest can be Bitcoin-anchored
 * via /api/verify/anchor. tenant_id is private provenance, never surfaced.
 */
export async function addClaim(
  tenantId: string,
  receivableId: string,
  input: { financier: string; amount: number; currency?: string; date?: string; force?: boolean },
): Promise<AddClaimResult> {
  await ensureReceivablesTables();
  const rcv = await getReceivableRow(String(receivableId || '').trim());
  if (!rcv) return { ok: false, error: 'not_found', message: 'No receivable found for that ID.' };

  const financier = clampStr(input.financier, 120);
  const amount = Number(input.amount);
  const currency = clampStr(input.currency || rcv.currency, 8).toUpperCase() || rcv.currency;
  const date = isYmd(input.date) ? input.date! : nowUtc().slice(0, 10);
  if (!financier) return { ok: false, error: 'invalid', message: 'A financier name is required.' };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid', message: 'Claim amount must be a positive number.' };
  }

  const claimed = await sumActiveClaims(receivableId);
  const available = rcv.face - claimed;
  if (amount > available && !input.force) {
    return {
      ok: false, error: 'exceeds_headroom',
      message: `Only ${available} of ${rcv.face} ${rcv.currency} is unencumbered; ${claimed} is already claimed.`,
      available, claimed, face: rcv.face,
    };
  }

  const manifest = { v: 1, kind: 'financing_claim', receivableId: rcv.id, financier, amount, currency, date };
  const { signature, digest } = sign(manifest);
  const claimId = randomUUID();
  await db.execute({
    sql: `INSERT INTO receivable_claims
            (id, receivable_id, tenant_id, financier, amount, currency, claim_date, status, manifest_json, signature_json, digest)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    args: [
      claimId, rcv.id, tenantId, financier, amount, currency, date,
      JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest,
    ],
  });
  const newClaimed = claimed + amount;
  return { ok: true, claimId, digest, signed: !!signature, claimed: newClaimed, available: rcv.face - newClaimed, face: rcv.face };
}

/**
 * PUBLIC read — the second financier's check. Given a receivable ID, return its status
 * and every claim standing against it. NEVER returns tenant_id or any identity: only the
 * self-chosen financier label, amount, and date (no-attribution boundary). Returns null
 * when the ID is unknown.
 */
export async function getReceivableStatus(receivableId: string): Promise<ReceivableStatus | null> {
  await ensureReceivablesTables();
  const rcv = await getReceivableRow(String(receivableId || '').trim());
  if (!rcv) return null;

  const cr = await db.execute({
    sql: `SELECT id, financier, amount, currency, claim_date, status, discharged_at, signature_json, anchor_json, created_at
          FROM receivable_claims WHERE receivable_id = ? ORDER BY created_at ASC`,
    args: [rcv.id],
  });
  const claims: PublicClaim[] = (cr.rows as any[]).map((r) => ({
    id: String(r.id),
    financier: String(r.financier),
    amount: Number(r.amount),
    currency: String(r.currency),
    date: String(r.claim_date),
    status: (String(r.status) === 'discharged' ? 'discharged' : 'active') as ClaimStatus,
    dischargedAt: r.discharged_at != null ? String(r.discharged_at) : null,
    signed: !!r.signature_json,
    anchored: !!r.anchor_json,
    anchoredAt: anchoredAtOf(r.anchor_json),
    registeredAt: String(r.created_at),
  }));

  const ar = await db.execute({
    sql: `SELECT id, role, label, statement, attested_at, signature_json, anchor_json
          FROM receivable_attestations WHERE receivable_id = ? ORDER BY created_at ASC`,
    args: [rcv.id],
  });
  const attestations: PublicAttestation[] = (ar.rows as any[]).map((r) => ({
    id: String(r.id),
    role: (['buyer', 'supplier', 'inspector'].includes(String(r.role)) ? String(r.role) : 'other') as AttesterRole,
    label: String(r.label),
    statement: String(r.statement),
    date: String(r.attested_at),
    signed: !!r.signature_json,
    anchored: !!r.anchor_json,
    anchoredAt: anchoredAtOf(r.anchor_json),
  }));

  const claimed = claims.filter((c) => c.status === 'active').reduce((s, c) => s + c.amount, 0);
  const available = rcv.face - claimed;
  const status: ReceivableStatus['status'] =
    claimed <= 0 ? 'unfinanced'
    : claimed < rcv.face ? 'partially_financed'
    : claimed === rcv.face ? 'fully_financed'
    : 'over_financed';

  const settled = !!rcv.settled_at;
  const hadClaims = claims.length > 0;
  const lifecycle: ReceivableStatus['lifecycle'] =
    settled ? 'settled'
    : claimed > 0 ? 'financed'
    : hadClaims ? 'released' // all claims discharged, not yet marked settled
    : 'created';

  return {
    id: rcv.id,
    supplier: rcv.supplier, buyer: rcv.buyer, invoiceNo: rcv.invoice_no,
    face: rcv.face, currency: rcv.currency, terms: rcv.terms,
    dueDate: rcv.due_date, acknowledgedAt: rcv.acknowledged_at,
    rtype: rcv.rtype, paymentMethod: rcv.payment_method,
    createdAt: rcv.created_at, signed: !!rcv.signature_json,
    anchored: !!rcv.anchor_json, anchoredAt: anchoredAtOf(rcv.anchor_json),
    settled, settledAt: rcv.settled_at,
    attestations,
    claims, claimed, available, status, lifecycle,
  };
}

// ── Stage 4: settlement ──────────────────────────────────────────────────────

export type DischargeClaimResult =
  | { ok: true; digest: string; signed: boolean; claimed: number; available: number; face: number }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: 'already_discharged'; message: string };

/**
 * Discharge a financing claim — the financing was repaid/released, so the claim no
 * longer encumbers the receivable and its amount returns to the unencumbered headroom.
 * Tenant-scoped to the claim's OWNER (the financier releases their OWN claim). Signs a
 * dated discharge event; the digest is Bitcoin-anchorable. Idempotent-safe: a claim
 * already discharged returns 'already_discharged' rather than double-signing.
 */
export async function dischargeClaim(tenantId: string, claimId: string): Promise<DischargeClaimResult> {
  await ensureReceivablesTables();
  const cr = await db.execute({
    sql: `SELECT id, receivable_id, financier, amount, currency, status FROM receivable_claims
          WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(claimId || '').trim(), tenantId],
  });
  if (!cr.rows.length) return { ok: false, error: 'not_found', message: 'No claim of yours found for that ID.' };
  const claim = cr.rows[0] as any;
  if (String(claim.status) === 'discharged') {
    return { ok: false, error: 'already_discharged', message: 'That claim is already discharged.' };
  }

  const dischargedAt = nowUtc().slice(0, 10);
  const manifest = {
    v: 1, kind: 'claim_discharge',
    receivableId: String(claim.receivable_id), claimId: String(claim.id),
    financier: String(claim.financier), amount: Number(claim.amount),
    currency: String(claim.currency), dischargedAt,
  };
  const { signature, digest } = sign(manifest);
  await db.execute({
    sql: `UPDATE receivable_claims
          SET status = 'discharged', discharged_at = ?, discharge_json = ?, discharge_digest = ?
          WHERE id = ? AND tenant_id = ? AND status <> 'discharged'`,
    args: [dischargedAt, JSON.stringify(manifest), digest, claim.id, tenantId],
  });

  const rcv = await getReceivableRow(String(claim.receivable_id));
  const claimed = rcv ? await sumActiveClaims(rcv.id) : 0;
  const face = rcv?.face ?? 0;
  return { ok: true, digest, signed: !!signature, claimed, available: face - claimed, face };
}

export type SettleReceivableResult =
  | { ok: true; digest: string; signed: boolean; settledAt: string }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: 'already_settled'; message: string };

/**
 * Mark a receivable settled — the buyer paid, closing the lifecycle. Tenant-scoped to
 * the receivable's CREATOR (the supplier/originator confirms payment arrived). Signs a
 * dated settlement event. Does not itself discharge outstanding claims — a financier
 * releases their own claim via dischargeClaim — but records that the obligation is paid.
 */
export async function settleReceivable(tenantId: string, receivableId: string): Promise<SettleReceivableResult> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT id, supplier, buyer, invoice_no, face, currency, settled_at FROM receivables
          WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(receivableId || '').trim(), tenantId],
  });
  if (!r.rows.length) return { ok: false, error: 'not_found', message: 'No receivable of yours found for that ID.' };
  const row = r.rows[0] as any;
  if (row.settled_at != null) return { ok: false, error: 'already_settled', message: 'That receivable is already settled.' };

  const settledAt = nowUtc().slice(0, 10);
  const manifest = {
    v: 1, kind: 'receivable_settlement',
    receivableId: String(row.id), invoiceNo: String(row.invoice_no),
    face: Number(row.face), currency: String(row.currency), settledAt,
  };
  const { signature, digest } = sign(manifest);
  await db.execute({
    sql: `UPDATE receivables SET settled_at = ?, settlement_json = ?, settlement_digest = ?
          WHERE id = ? AND tenant_id = ? AND settled_at IS NULL`,
    args: [settledAt, JSON.stringify(manifest), digest, row.id, tenantId],
  });
  return { ok: true, digest, signed: !!signature, settledAt };
}

// ── #3: list a tenant's own receivables ──────────────────────────────────────

export interface ReceivableSummary {
  id: string; supplier: string; buyer: string; invoiceNo: string;
  face: number; currency: string; settled: boolean; createdAt: string;
}

/** The receivables this tenant created (so they don't have to hoard IDs). Tenant-scoped. */
export async function listReceivables(tenantId: string): Promise<ReceivableSummary[]> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT id, supplier, buyer, invoice_no, face, currency, settled_at, created_at
          FROM receivables WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`,
    args: [tenantId],
  });
  return (r.rows as any[]).map((row) => ({
    id: String(row.id), supplier: String(row.supplier), buyer: String(row.buyer),
    invoiceNo: String(row.invoice_no), face: Number(row.face), currency: String(row.currency),
    settled: row.settled_at != null, createdAt: String(row.created_at),
  }));
}

/**
 * Delete a receivable this tenant created, cascading its claims and attestations.
 * Tenant-scoped: only the creator can delete, and only their own rows are touched.
 * Returns false when no such receivable belongs to the tenant.
 */
export async function deleteReceivable(tenantId: string, receivableId: string): Promise<boolean> {
  await ensureReceivablesTables();
  const id = String(receivableId || '').trim();
  const owned = await db.execute({
    sql: `SELECT id FROM receivables WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [id, tenantId],
  });
  if (!owned.rows.length) return false;
  // Claims/attestations are keyed by receivable_id; scope the deletes by tenant too so a
  // tenant can never remove another tenant's claim against a shared receivable.
  await db.execute({ sql: `DELETE FROM receivable_claims WHERE receivable_id = ? AND tenant_id = ?`, args: [id, tenantId] });
  await db.execute({ sql: `DELETE FROM receivable_attestations WHERE receivable_id = ? AND tenant_id = ?`, args: [id, tenantId] });
  await db.execute({ sql: `DELETE FROM receivables WHERE id = ? AND tenant_id = ?`, args: [id, tenantId] });
  return true;
}

// ── #2: Stage 2 buyer/party attestation ──────────────────────────────────────

export type AddAttestationResult =
  | { ok: true; attestationId: string; digest: string; signed: boolean }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: 'invalid'; message: string };

/**
 * Record a party's signed attestation about a receivable. The load-bearing one is the
 * BUYER acknowledging the debt ("I owe ₦100m for invoice X, due Y") — the obligor
 * attesting against their own interest, which is what makes a claim trustworthy. Bound
 * to the receivable hash; signed; the digest is Bitcoin-anchorable. tenant_id is private
 * provenance, never surfaced — only the self-chosen label is public.
 *
 * v1: signed with the Almstins key on the attester's authenticated self-disclosure. v2:
 * the attester proves control of their own address and signs with their own key.
 */
export async function addAttestation(
  tenantId: string,
  receivableId: string,
  input: { role: AttesterRole; label: string; statement: string; date?: string },
): Promise<AddAttestationResult> {
  await ensureReceivablesTables();
  const rcv = await getReceivableRow(String(receivableId || '').trim());
  if (!rcv) return { ok: false, error: 'not_found', message: 'No receivable found for that ID.' };

  const role: AttesterRole = (['buyer', 'supplier', 'inspector'].includes(input.role) ? input.role : 'other');
  const label = clampStr(input.label, 120);
  const statement = clampStr(input.statement, 600);
  const date = isYmd(input.date) ? input.date! : nowUtc().slice(0, 10);
  if (!label || !statement) {
    return { ok: false, error: 'invalid', message: 'An attester name and a statement are required.' };
  }

  const manifest = { v: 1, kind: 'attestation', receivableId: rcv.id, role, label, statement, date };
  const { signature, digest } = sign(manifest);
  const attestationId = randomUUID();
  await db.execute({
    sql: `INSERT INTO receivable_attestations
            (id, receivable_id, tenant_id, role, label, statement, attested_at, manifest_json, signature_json, digest)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [attestationId, rcv.id, tenantId, role, label, statement, date, JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest],
  });
  return { ok: true, attestationId, digest, signed: !!signature };
}

// ── #1: Bitcoin anchoring — attach a receipt to a registry record ─────────────

export type AnchorRecordKind = 'receivable' | 'claim' | 'attestation';

const ANCHOR_TABLE: Record<AnchorRecordKind, string> = {
  receivable: 'receivables',
  claim: 'receivable_claims',
  attestation: 'receivable_attestations',
};

/**
 * A record's digest + current anchor receipt, scoped to the tenant that owns it. The
 * digest is what gets stamped into Bitcoin; the anchor endpoint orchestrates the
 * stamp/upgrade and calls setRecordAnchor to persist the receipt. Returns null when the
 * record isn't found or isn't this tenant's.
 */
export async function getRecordForAnchor(
  tenantId: string, kind: AnchorRecordKind, id: string,
): Promise<{ digest: string; anchorJson: string | null } | null> {
  await ensureReceivablesTables();
  const table = ANCHOR_TABLE[kind];
  if (!table) return null;
  const r = await db.execute({
    sql: `SELECT digest, anchor_json FROM ${table} WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(id || '').trim(), tenantId],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  return { digest: String(row.digest), anchorJson: row.anchor_json != null ? String(row.anchor_json) : null };
}

/** Persist an anchor receipt (JSON) onto a record. Tenant-scoped. */
export async function setRecordAnchor(
  tenantId: string, kind: AnchorRecordKind, id: string, anchorJson: string,
): Promise<void> {
  await ensureReceivablesTables();
  const table = ANCHOR_TABLE[kind];
  if (!table) return;
  await db.execute({
    sql: `UPDATE ${table} SET anchor_json = ? WHERE id = ? AND tenant_id = ?`,
    args: [anchorJson, String(id || '').trim(), tenantId],
  });
}

/**
 * Every still-pending anchor across all three registry tables (cross-tenant maintenance).
 * "Pending" = a receipt is stored but Bitcoin has not confirmed it yet (no anchoredAt).
 * OpenTimestamps sends no push, so the upgrade-anchors cron uses this to find receipts
 * that are ready to be pulled down and persisted, without anyone opening the page.
 * Returns tenant_id per row so the caller persists via the tenant-scoped setRecordAnchor.
 */
export async function listPendingAnchors(
  limit = 100,
): Promise<Array<{ kind: AnchorRecordKind; id: string; tenantId: string; anchorJson: string }>> {
  await ensureReceivablesTables();
  const out: Array<{ kind: AnchorRecordKind; id: string; tenantId: string; anchorJson: string }> = [];
  const scan = async (kind: AnchorRecordKind) => {
    const table = ANCHOR_TABLE[kind];
    const r = await db.execute({
      sql: `SELECT id, tenant_id, anchor_json FROM ${table}
            WHERE anchor_json IS NOT NULL ORDER BY created_at DESC LIMIT 500`,
      args: [],
    });
    for (const row of r.rows as any[]) {
      const aj = String(row.anchor_json);
      if (anchoredAtOf(aj)) continue; // already confirmed — nothing to pull
      out.push({ kind, id: String(row.id), tenantId: String(row.tenant_id), anchorJson: aj });
    }
  };
  await scan('receivable');
  await scan('claim');
  await scan('attestation');
  return out.slice(0, limit);
}

// ── Invitations ───────────────────────────────────────────────────────────────
//
// An invitation binds one account to one role on one record. It is the answer to two
// gaps: nothing recorded who a financier's clients were, and anyone holding a receivable
// ID could sign as the buyer.
//
// Tokens are random and single-use. A predictable invite would be a standing key anyone
// who ever saw it could reuse, which is the opposite of what a capability should be.

export type InviteRole = 'borrower' | 'buyer' | 'financier';

export interface InviteRow {
  token: string;
  receivableId: string | null;
  role: InviteRole;
  label: string | null;
  email: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const INVITE_ROLES: InviteRole[] = ['borrower', 'buyer', 'financier'];
const INVITE_TTL_DAYS = 7;

/** 32 bytes of randomness, url-safe. Same reasoning as the receivable ID: unguessable. */
function inviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createInvite(
  fromTenant: string,
  input: { role: InviteRole; receivableId?: string | null; label?: string | null; email?: string | null },
): Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; error: string }> {
  await ensureReceivablesTables();
  if (!INVITE_ROLES.includes(input.role)) return { ok: false, error: 'invalid_role' };

  // Only the tenant that owns a receivable may invite someone onto it.
  const receivableId = input.receivableId ? String(input.receivableId).trim() : null;
  if (receivableId) {
    const owns = await db.execute({
      sql: `SELECT 1 FROM receivables WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [receivableId, fromTenant],
    });
    if (!owns.rows.length) return { ok: false, error: 'not_found' };
  }

  const token = inviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19);

  await db.execute({
    sql: `INSERT INTO receivable_invites
            (token, receivable_id, from_tenant, role, label, email, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      token, receivableId, fromTenant, input.role,
      input.label ? String(input.label).slice(0, 160) : null,
      input.email ? String(input.email).slice(0, 200) : null,
      expiresAt,
    ],
  });
  return { ok: true, token, expiresAt };
}

/** What an invitee sees before signing in — never exposes the sender's tenant. */
export async function readInvite(token: string): Promise<
  | { ok: true; role: InviteRole; label: string | null; receivableId: string | null; expiresAt: string }
  | { ok: false; error: 'not_found' | 'expired' | 'revoked' | 'used' }
> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT receivable_id, role, label, expires_at, accepted_at, revoked_at
          FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token || '').trim()],
  });
  if (!r.rows.length) return { ok: false, error: 'not_found' };
  const row = r.rows[0] as any;
  if (row.revoked_at) return { ok: false, error: 'revoked' };
  if (row.accepted_at) return { ok: false, error: 'used' };
  if (String(row.expires_at) < nowUtc()) return { ok: false, error: 'expired' };
  return {
    ok: true,
    role: String(row.role) as InviteRole,
    label: row.label != null ? String(row.label) : null,
    receivableId: row.receivable_id != null ? String(row.receivable_id) : null,
    expiresAt: String(row.expires_at),
  };
}

/**
 * Spend an invitation. Writes the access grant that makes "who is my client" answerable,
 * and marks the token used so a forwarded link cannot be redeemed twice.
 */
export async function acceptInvite(
  token: string,
  tenantId: string,
): Promise<{ ok: true; role: InviteRole; receivableId: string | null } | { ok: false; error: string }> {
  await ensureReceivablesTables();
  const invite = await readInvite(token);
  if (!invite.ok) return { ok: false, error: invite.error };

  const claimed = await db.execute({
    sql: `UPDATE receivable_invites
             SET accepted_at = ?, accepted_by = ?
           WHERE token = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), tenantId, String(token).trim()],
  });
  // Two people opening the same link race here; only the update that lands may proceed.
  if (!claimed.rowsAffected) return { ok: false, error: 'used' };

  const sender = await db.execute({
    sql: `SELECT from_tenant FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token).trim()],
  });
  const grantedBy = String((sender.rows[0] as any)?.from_tenant ?? '');

  // The grant is a disclosure, recorded in both directions: the invitee gains access to
  // the record, and the sender gains a named counterparty to list.
  await db.execute({
    sql: `INSERT INTO receivable_access (id, receivable_id, tenant_id, counterparty, role, granted_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), invite.receivableId, tenantId, grantedBy, invite.role, grantedBy],
  });
  await db.execute({
    sql: `INSERT INTO receivable_access (id, receivable_id, tenant_id, counterparty, role, granted_by)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), invite.receivableId, grantedBy, tenantId, 'counterparty', grantedBy],
  });

  return { ok: true, role: invite.role, receivableId: invite.receivableId };
}

export interface AccessRow {
  receivableId: string | null;
  role: string;
  grantedAt: string;
}

/**
 * Everything disclosed TO this tenant. A desk list is built from these grants, never from
 * a scan of the receivables table, so a thousand tenants never see each other's clients.
 */
export async function listAccessFor(tenantId: string, limit = 200): Promise<AccessRow[]> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT receivable_id, role, granted_at
            FROM receivable_access
           WHERE tenant_id = ? AND revoked_at IS NULL
           ORDER BY granted_at DESC
           LIMIT ?`,
    args: [tenantId, limit],
  });
  return (r.rows as any[]).map((row) => ({
    receivableId: row.receivable_id != null ? String(row.receivable_id) : null,
    role: String(row.role),
    grantedAt: String(row.granted_at),
  }));
}

/** Invitations this tenant has sent, so they can be chased or revoked. */
export async function listInvitesFrom(tenantId: string, limit = 100): Promise<InviteRow[]> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT token, receivable_id, role, label, email, expires_at, accepted_at, revoked_at, created_at
            FROM receivable_invites
           WHERE from_tenant = ?
           ORDER BY created_at DESC
           LIMIT ?`,
    args: [tenantId, limit],
  });
  return (r.rows as any[]).map((row) => ({
    token: String(row.token),
    receivableId: row.receivable_id != null ? String(row.receivable_id) : null,
    role: String(row.role) as InviteRole,
    label: row.label != null ? String(row.label) : null,
    email: row.email != null ? String(row.email) : null,
    expiresAt: String(row.expires_at),
    acceptedAt: row.accepted_at != null ? String(row.accepted_at) : null,
    revokedAt: row.revoked_at != null ? String(row.revoked_at) : null,
    createdAt: String(row.created_at),
  }));
}

export async function revokeInvite(tenantId: string, token: string): Promise<boolean> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `UPDATE receivable_invites SET revoked_at = ?
           WHERE token = ? AND from_tenant = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), String(token || '').trim(), tenantId],
  });
  return !!r.rowsAffected;
}
