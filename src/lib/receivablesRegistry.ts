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
import { randomUUID, createHash } from 'crypto';
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
}

export interface Signature {
  keyId: string;
  alg: string;
  signatureHex: string;
  publicKeyHex: string;
}

export interface PublicClaim {
  financier: string;
  amount: number;
  currency: string;
  date: string;
  status: ClaimStatus;
  signed: boolean;
  anchored: boolean;
  registeredAt: string;
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
  createdAt: string;
  signed: boolean;
  claims: PublicClaim[];
  claimed: number;
  available: number;
  status: 'unfinanced' | 'partially_financed' | 'fully_financed' | 'over_financed';
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
    manifest_json  TEXT NOT NULL,
    signature_json TEXT,
    digest         TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_RECEIVABLES_TENANT_IDX =
  `CREATE INDEX IF NOT EXISTS receivables_tenant ON receivables (tenant_id)`;

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
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_CLAIMS_RCV_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_claims_rcv ON receivable_claims (receivable_id)`;

let ensured = false;
export async function ensureReceivablesTables(): Promise<void> {
  if (ensured) return;
  await db.execute({ sql: ENSURE_RECEIVABLES_SQL, args: [] });
  await db.execute({ sql: ENSURE_RECEIVABLES_TENANT_IDX, args: [] });
  await db.execute({ sql: ENSURE_CLAIMS_SQL, args: [] });
  await db.execute({ sql: ENSURE_CLAIMS_RCV_IDX, args: [] });
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

  if (!supplier || !buyer || !invoiceNo) {
    return { ok: false, error: 'invalid', message: 'Supplier, buyer, and invoice number are required.' };
  }
  if (!Number.isFinite(face) || face <= 0) {
    return { ok: false, error: 'invalid', message: 'Face value must be a positive number.' };
  }

  const receivable = { supplier, buyer, invoiceNo, face, currency, terms, dueDate, acknowledgedAt };
  const manifest = { v: 1, kind: 'receivable', receivable };
  const { signature, digest } = sign(manifest);
  const id = sha256hex(canonicalManifestBytes(manifest));

  // Deterministic ID → a re-create of the identical receivable is idempotent.
  const existing = await db.execute({ sql: `SELECT id FROM receivables WHERE id = ? LIMIT 1`, args: [id] });
  if (!existing.rows.length) {
    await db.execute({
      sql: `INSERT INTO receivables
              (id, tenant_id, supplier, buyer, invoice_no, face, currency, terms, due_date, acknowledged_at, manifest_json, signature_json, digest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, tenantId, supplier, buyer, invoiceNo, face, currency, terms, dueDate, acknowledgedAt,
        JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest,
      ],
    });
  }
  return { ok: true, id, digest, signed: !!signature, keyId: getSigningKeyId() };
}

interface ReceivableRow {
  id: string; supplier: string; buyer: string; invoice_no: string;
  face: number; currency: string; terms: string | null;
  due_date: string | null; acknowledged_at: string | null;
  signature_json: string | null; created_at: string;
}

async function getReceivableRow(id: string): Promise<ReceivableRow | null> {
  const r = await db.execute({
    sql: `SELECT id, supplier, buyer, invoice_no, face, currency, terms, due_date, acknowledged_at, signature_json, created_at
          FROM receivables WHERE id = ? LIMIT 1`,
    args: [id],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  return {
    id: String(row.id), supplier: String(row.supplier), buyer: String(row.buyer),
    invoice_no: String(row.invoice_no), face: Number(row.face), currency: String(row.currency),
    terms: row.terms != null ? String(row.terms) : null,
    due_date: row.due_date != null ? String(row.due_date) : null,
    acknowledged_at: row.acknowledged_at != null ? String(row.acknowledged_at) : null,
    signature_json: row.signature_json != null ? String(row.signature_json) : null,
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
    sql: `SELECT financier, amount, currency, claim_date, status, signature_json, anchor_json, created_at
          FROM receivable_claims WHERE receivable_id = ? ORDER BY created_at ASC`,
    args: [rcv.id],
  });
  const claims: PublicClaim[] = (cr.rows as any[]).map((r) => ({
    financier: String(r.financier),
    amount: Number(r.amount),
    currency: String(r.currency),
    date: String(r.claim_date),
    status: (String(r.status) === 'discharged' ? 'discharged' : 'active') as ClaimStatus,
    signed: !!r.signature_json,
    anchored: !!r.anchor_json,
    registeredAt: String(r.created_at),
  }));

  const claimed = claims.filter((c) => c.status === 'active').reduce((s, c) => s + c.amount, 0);
  const available = rcv.face - claimed;
  const status: ReceivableStatus['status'] =
    claimed <= 0 ? 'unfinanced'
    : claimed < rcv.face ? 'partially_financed'
    : claimed === rcv.face ? 'fully_financed'
    : 'over_financed';

  return {
    id: rcv.id,
    supplier: rcv.supplier, buyer: rcv.buyer, invoiceNo: rcv.invoice_no,
    face: rcv.face, currency: rcv.currency, terms: rcv.terms,
    dueDate: rcv.due_date, acknowledgedAt: rcv.acknowledged_at,
    createdAt: rcv.created_at, signed: !!rcv.signature_json,
    claims, claimed, available, status,
  };
}
