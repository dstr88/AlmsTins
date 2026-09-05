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
  /** Everything a real contract needs that the seven original fields did not carry. */
  details?: ReceivableDetails | null;
}

/**
 * The rest of the paperwork.
 *
 * The rule this exists for: the banker should never need a field and not have it. Five
 * are named because they recur on every deal; `extra` is the escape hatch for the one
 * that does not, so an unusual contract never dead-ends him mid-intake.
 *
 * `buyerRef` is the one to watch. It is the debtor's OWN reference for the obligation —
 * their PO or contract number — and it is the only candidate for a canonical key, because
 * it is the only identifier here that the supplier does not control. Nothing keys off it
 * yet; capturing it is the prerequisite for ever closing the near-duplicate hole.
 */
export interface ReceivableDetails {
  invoiceDate?: string | null;
  deliveryDate?: string | null;
  buyerRef?: string | null;
  goods?: string | null;
  paymentInstructions?: string | null;
  extra?: Array<{ label: string; value: string }>;
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
  /** The supplier confirmed the money arrived. Until then the claim is one firm's word. */
  affirmed: boolean;
  affirmedAt: string | null;
  affirmedBy: string | null;
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
  /** The extended paperwork fields, when the record carries them. */
  details: ReceivableDetails | null;
  /** How many documents are attached and still held. A count, never the files or names:
   *  a second financier needs to know whether paperwork exists, not what it says. */
  documentCount: number;
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
  // Counter-signature: the supplier's confirmation that the money actually arrived.
  // A claim is an assertion by the lender until this is set. See affirmClaimByToken.
  `ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS affirmed_at TEXT`,
  `ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS affirmed_by TEXT`,
  // A confirmation link can be bound to one claim rather than the whole receivable.
  `ALTER TABLE receivable_invites ADD COLUMN IF NOT EXISTS claim_id TEXT`,
  // The extended paperwork fields. Also inside manifest_json (so they are signed and
  // hashed); this column exists so reads do not have to parse the manifest.
  `ALTER TABLE receivables ADD COLUMN IF NOT EXISTS details_json TEXT`,
  // Chasing an unanswered request, and recording that it went unanswered.
  `ALTER TABLE receivable_invites ADD COLUMN IF NOT EXISTS reminded_at TEXT`,
  `ALTER TABLE receivable_invites ADD COLUMN IF NOT EXISTS lapse_recorded_at TEXT`,
  // A request can be about one offer, the way it can be about one claim.
  `ALTER TABLE receivable_invites ADD COLUMN IF NOT EXISTS offer_id TEXT`,
];

/**
 * Offers — terms put to the client, before the money moves.
 *
 * The client's signature is worth most at the moment he wants something. He accepts because
 * that is how he gets funded; once the money has landed he has nothing left to gain and a
 * reason to go quiet. So the binding artifact is taken here, not after.
 *
 * An offer carries what an offer has to carry to be one: the amount, the price, whether it
 * is recourse, how it is repaid, and when it stops being available. Nothing enforces the
 * order against the financier — he is a banker and knows not to hand over cash before the
 * paperwork is in order.
 */
const ENSURE_OFFERS_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_offers (
    id              TEXT NOT NULL PRIMARY KEY,
    receivable_id   TEXT NOT NULL,
    tenant_id       TEXT NOT NULL,
    financier       TEXT NOT NULL,
    amount          DOUBLE PRECISION NOT NULL,
    currency        TEXT NOT NULL,
    price           TEXT,
    recourse        TEXT NOT NULL DEFAULT 'recourse',
    repayment       TEXT,
    expires_at      TEXT NOT NULL,
    manifest_json   TEXT NOT NULL,
    signature_json  TEXT,
    digest          TEXT NOT NULL,
    anchor_json     TEXT,
    accepted_at     TEXT,
    accepted_by     TEXT,
    declined_at     TEXT,
    declined_reason TEXT,
    created_at      TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_OFFERS_RCV_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_offers_rcv ON receivable_offers (receivable_id)`;

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


// ── Documents — the paperwork, held only as long as someone still needs to read it ──
//
// The promissory note or contract the banker takes in at his office. Bytes live base64
// in Postgres (same approach as transaction_screenshots and petro_receipts — there is no
// object store in this app, and Render's filesystem is ephemeral).
//
// They are NOT kept. The moment the last outstanding confirmation request closes, the
// bytes are nulled and the row becomes a tombstone: filename, size, and sha256 survive so
// the record still proves WHICH document was shown, while the document itself is gone.
// Almstins witnesses the paperwork; it never becomes its custodian. Every party to the
// deal already holds a copy, and a hash is useless to anyone who does not.
const ENSURE_DOCS_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_documents (
    id             TEXT NOT NULL PRIMARY KEY,
    receivable_id  TEXT NOT NULL,
    tenant_id      TEXT NOT NULL,
    filename       TEXT NOT NULL,
    mime_type      TEXT NOT NULL,
    file_size      INTEGER NOT NULL DEFAULT 0,
    sha256         TEXT NOT NULL,
    data           TEXT,
    uploaded_at    TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')),
    purged_at      TEXT
  )
`;
const ENSURE_DOCS_RCV_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_documents_rcv ON receivable_documents (receivable_id)`;

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
  await db.execute({ sql: ENSURE_DOCS_SQL, args: [] });
  await db.execute({ sql: ENSURE_DOCS_RCV_IDX, args: [] });
  await db.execute({ sql: ENSURE_OFFERS_SQL, args: [] });
  await db.execute({ sql: ENSURE_OFFERS_RCV_IDX, args: [] });
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
/** details_json, defensively. A malformed blob must not take the whole lookup down. */
function parseDetails(raw: unknown): ReceivableDetails | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(String(raw));
    return d && typeof d === 'object' ? (d as ReceivableDetails) : null;
  } catch { return null; }
}

/** Trim, drop empties, cap lengths, and return null when nothing was filled in. */
function normalizeDetails(d?: ReceivableDetails | null): ReceivableDetails | null {
  if (!d) return null;
  const out: ReceivableDetails = {};
  if (isYmd(d.invoiceDate)) out.invoiceDate = d.invoiceDate!;
  if (isYmd(d.deliveryDate)) out.deliveryDate = d.deliveryDate!;
  const buyerRef = clampStr(d.buyerRef ?? '', 80);
  if (buyerRef) out.buyerRef = buyerRef;
  const goods = clampStr(d.goods ?? '', 500);
  if (goods) out.goods = goods;
  const pay = clampStr(d.paymentInstructions ?? '', 300);
  if (pay) out.paymentInstructions = pay;

  const extra = (Array.isArray(d.extra) ? d.extra : [])
    .map((e) => ({ label: clampStr(e?.label ?? '', 80), value: clampStr(e?.value ?? '', 300) }))
    .filter((e) => e.label && e.value)
    .slice(0, 20)
    // Sorted so the same fields entered in a different order hash to the same ID.
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  if (extra.length) out.extra = extra;

  return Object.keys(out).length ? out : null;
}

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

  // Normalized so two intakes typing the same thing produce the same ID, and so an empty
  // details object never changes the hash of an otherwise identical record.
  const details = normalizeDetails(input.details);

  const receivable: Record<string, unknown> =
    { supplier, buyer, invoiceNo, face, currency, terms, dueDate, acknowledgedAt, rtype, paymentMethod };
  if (details) receivable.details = details;
  const manifest = { v: 1, kind: 'receivable', receivable };
  const { signature, digest } = sign(manifest);
  const id = sha256hex(canonicalManifestBytes(manifest));

  // Deterministic ID → a re-create of the identical receivable is idempotent.
  const existing = await db.execute({ sql: `SELECT id FROM receivables WHERE id = ? LIMIT 1`, args: [id] });
  if (!existing.rows.length) {
    await db.execute({
      sql: `INSERT INTO receivables
              (id, tenant_id, supplier, buyer, invoice_no, face, currency, terms, due_date, acknowledged_at, rtype, payment_method, details_json, manifest_json, signature_json, digest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, tenantId, supplier, buyer, invoiceNo, face, currency, terms, dueDate, acknowledgedAt, rtype, paymentMethod,
        details ? JSON.stringify(details) : null,
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
  rtype: string | null; payment_method: string | null; details_json: string | null;
  signature_json: string | null; anchor_json: string | null; settled_at: string | null; created_at: string;
}

async function getReceivableRow(id: string): Promise<ReceivableRow | null> {
  const r = await db.execute({
    sql: `SELECT id, tenant_id, supplier, buyer, invoice_no, face, currency, terms, due_date,
                 acknowledged_at, rtype, payment_method, details_json, signature_json, anchor_json, settled_at, created_at
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
    details_json: row.details_json != null ? String(row.details_json) : null,
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
    sql: `SELECT id, financier, amount, currency, claim_date, status, discharged_at,
                 affirmed_at, affirmed_by, signature_json, anchor_json, created_at
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
    affirmed: !!r.affirmed_at,
    affirmedAt: r.affirmed_at != null ? String(r.affirmed_at) : null,
    affirmedBy: r.affirmed_by != null ? String(r.affirmed_by) : null,
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

  const dr = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM receivable_documents WHERE receivable_id = ? AND data IS NOT NULL`,
    args: [rcv.id],
  });
  const docCount = Number((dr.rows[0] as any)?.n ?? 0);

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
    details: parseDetails(rcv.details_json),
    documentCount: docCount,
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
  input: { role: AttesterRole; label: string; statement: string; date?: string;
           docs?: Array<{ sha256: string; filename: string }> },
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

  // Bind the exact paperwork the attester was looking at. Without this the file could be
  // swapped after the answer and the attestation would still read as valid. `docs` is
  // omitted entirely when absent so manifests written before this existed stay byte-identical.
  const manifest: Record<string, unknown> = { v: 1, kind: 'attestation', receivableId: rcv.id, role, label, statement, date };
  if (input.docs && input.docs.length) {
    manifest.docs = input.docs
      .map((d) => ({ sha256: String(d.sha256), filename: clampStr(d.filename, 200) }))
      .sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
  }
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

/**
 * How long a document lingers after the last confirmation request closes.
 *
 * Answered: the paperwork has done its job, so it goes the next day. The day is not
 * slack, it is the window in which whoever just vouched for it can still save their own
 * copy — the copy they need if they ever have to check it against the fingerprint.
 *
 * Never answered: that is a stalled deal, not a finished one. The banker will likely
 * re-send, and purging on the hour the link expired would make him re-upload at exactly
 * the moment things are already going wrong. Hold it a week past expiry instead.
 */
const PURGE_GRACE_ANSWERED_H = 24;
const PURGE_GRACE_UNANSWERED_D = 7;

/** 32 bytes of randomness, url-safe. Same reasoning as the receivable ID: unguessable. */
function inviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createInvite(
  fromTenant: string,
  input: { role: InviteRole; receivableId?: string | null; label?: string | null;
           email?: string | null; claimId?: string | null; offerId?: string | null },
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

  // A claim-bound invite asks one question about one advance: did this money arrive?
  // It is not an onboarding link, and acceptInvite refuses to spend it as one.
  const claimId = input.claimId ? String(input.claimId).trim() : null;
  if (claimId) {
    const owns = await db.execute({
      sql: `SELECT 1 FROM receivable_claims WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [claimId, fromTenant],
    });
    if (!owns.rows.length) return { ok: false, error: 'claim_not_found' };
  }

  const token = inviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19);

  const offerId = input.offerId ? String(input.offerId).trim() : null;
  if (offerId) {
    const owns = await db.execute({
      sql: `SELECT 1 FROM receivable_offers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [offerId, fromTenant],
    });
    if (!owns.rows.length) return { ok: false, error: 'offer_not_found' };
  }

  await db.execute({
    sql: `INSERT INTO receivable_invites
            (token, receivable_id, from_tenant, role, label, email, expires_at, claim_id, offer_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      token, receivableId, fromTenant, input.role,
      input.label ? String(input.label).slice(0, 160) : null,
      input.email ? String(input.email).slice(0, 200) : null,
      expiresAt, claimId, offerId,
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

  // A counter-signature link answers one question; it does not hand out an account or an
  // access grant. Redeeming one here would turn a question into a permission.
  const bound = await db.execute({
    sql: `SELECT claim_id, offer_id FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token).trim()],
  });
  if ((bound.rows[0] as any)?.claim_id || (bound.rows[0] as any)?.offer_id) {
    return { ok: false, error: 'not_an_invitation' };
  }

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
    // Claim-bound and buyer tokens are questions, not invitations: they never create an
    // account or a client relationship, so they do not belong in the client list.
    sql: `SELECT token, receivable_id, role, label, email, expires_at, accepted_at, revoked_at, created_at
            FROM receivable_invites
           WHERE from_tenant = ?
             AND claim_id IS NULL
             AND role <> 'buyer'
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

// ── Buyer confirmation by link ────────────────────────────────────────────────
//
// The obligor acts once and gains nothing, so asking them to create an account is how
// this step quietly never happens. The emailed link is the capability instead: open it,
// answer, done.
//
// What that buys is attribution rather than verified identity — the same footing as the
// verification email a factor sends today, plus a timestamp and the record it is bound
// to. The confirmation names who answered, at which address, and what they affirmed.

export interface ConfirmAnswers {
  /** Their own reference, read off their records. The point is that it forces a look. */
  theirReference: string;
  by: string;
  title?: string | null;
  goodsReceived: boolean;
  amountCorrect: boolean;
  noOffsets: boolean;
  notAlreadyPaid: boolean;
}

export type ConfirmOutcome = 'confirmed' | 'not_ours' | 'amount_wrong';

/**
 * Spend a buyer link and record what they said.
 *
 * A dispute is filed under the 'other' role so it can never be mistaken for an
 * acknowledgment: the desk treats a buyer attestation as the keystone, and a "this isn't
 * ours" reply landing in that slot would be exactly backwards.
 */
export async function confirmByToken(
  token: string,
  outcome: ConfirmOutcome,
  answers: ConfirmAnswers,
): Promise<{ ok: true; attestationId: string; receivableId: string } | { ok: false; error: string }> {
  await ensureReceivablesTables();

  const invite = await readInvite(token);
  if (!invite.ok) return { ok: false, error: invite.error };
  if (invite.role !== 'buyer') return { ok: false, error: 'wrong_role' };
  if (!invite.receivableId) return { ok: false, error: 'no_receivable' };

  const who = clampStr(answers.by, 100);
  if (!who) return { ok: false, error: 'name_required' };
  const ref = clampStr(answers.theirReference, 60);
  if (outcome === 'confirmed' && !ref) return { ok: false, error: 'reference_required' };

  const row = await db.execute({
    sql: `SELECT from_tenant, email FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token).trim()],
  });
  const fromTenant = String((row.rows[0] as any)?.from_tenant ?? '');
  const sentTo = (row.rows[0] as any)?.email ? String((row.rows[0] as any).email) : null;

  const rcv = await getReceivableRow(invite.receivableId);
  if (!rcv) return { ok: false, error: 'not_found' };

  const title = answers.title ? ` (${clampStr(answers.title, 60)})` : '';
  // NOT the address. The statement is published by the public lookup to anyone holding the
  // receivable ID, and that endpoint promises no legal identity. A name is the substance of
  // an attestation and belongs here; a third party's email address is contact information
  // that nobody consented to publish. The address stays on the sender's own roster, which
  // is tenant-scoped, so the financier can still prove where he sent it.
  const via = ' via a single-use link';
  void sentTo;

  let statement: string;
  let role: AttesterRole;
  if (outcome === 'confirmed') {
    const affirm = [
      answers.goodsReceived ? 'goods/services received' : 'receipt NOT affirmed',
      answers.amountCorrect ? 'amount correct' : 'amount NOT affirmed',
      answers.noOffsets ? 'no offsets or disputes' : 'offsets/disputes NOT ruled out',
      answers.notAlreadyPaid ? 'not already paid' : 'prior payment NOT ruled out',
    ].join('; ');
    statement = `Confirms invoice ${rcv.invoice_no} for ${rcv.currency} ${Number(rcv.face).toLocaleString('en-US', { minimumFractionDigits: 2 })}. Their reference: ${ref}. Affirms: ${affirm}. Answered by ${who}${title}${via}.`;
    role = 'buyer';
  } else {
    const why = outcome === 'not_ours' ? 'states this invoice is not theirs' : 'states the amount is wrong';
    statement = `DISPUTED — ${why}. Invoice ${rcv.invoice_no}${ref ? `, their reference: ${ref}` : ''}. Answered by ${who}${title}${via}.`;
    role = 'other';
  }

  // Claim the token first: a forwarded link must not be answerable twice.
  const claimed = await db.execute({
    sql: `UPDATE receivable_invites SET accepted_at = ?, accepted_by = ?
           WHERE token = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), who, String(token).trim()],
  });
  if (!claimed.rowsAffected) return { ok: false, error: 'used' };

  // Recorded under the tenant that asked, since the answerer has no account. The
  // statement names who answered and where the link was sent, so the path is on the face
  // of the record rather than implied by which tenant holds it.
  // Bind the paperwork that was on screen. If the file is swapped afterwards, the digest
  // in this attestation no longer matches, and the swap is provable rather than deniable.
  const docs = (await listDocuments(invite.receivableId))
    .map((d) => ({ sha256: d.sha256, filename: d.filename }));

  const result = await addAttestation(fromTenant, invite.receivableId, {
    role, label: rcv.buyer, statement, docs,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, attestationId: result.attestationId, receivableId: invite.receivableId };
}

/** What the answerer sees before answering. No account, so no session to read it from. */
export async function readConfirmRequest(token: string): Promise<
  | { ok: true; supplier: string; buyer: string; invoiceNo: string; face: number; currency: string;
      terms: string | null; dueDate: string | null; receivableId: string;
      sentTo: string | null; documents: DocumentMeta[] }
  | { ok: false; error: string }
> {
  await ensureReceivablesTables();
  const invite = await readInvite(token);
  if (!invite.ok) return { ok: false, error: invite.error };
  if (invite.role !== 'buyer' || !invite.receivableId) return { ok: false, error: 'wrong_role' };
  const rcv = await getReceivableRow(invite.receivableId);
  if (!rcv) return { ok: false, error: 'not_found' };

  const addressed = await db.execute({
    sql: `SELECT email FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token).trim()],
  });
  const sentTo = (addressed.rows[0] as any)?.email ? String((addressed.rows[0] as any).email) : null;
  const documents = (await listDocuments(invite.receivableId)).filter((d) => !d.purgedAt);
  return {
    ok: true,
    supplier: String(rcv.supplier), buyer: String(rcv.buyer), invoiceNo: String(rcv.invoice_no),
    face: Number(rcv.face), currency: String(rcv.currency),
    terms: rcv.terms != null ? String(rcv.terms) : null,
    dueDate: rcv.due_date != null ? String(rcv.due_date) : null,
    receivableId: String(rcv.id), sentTo, documents,
  };
}

// ── Documents ─────────────────────────────────────────────────────────────────

export const DOC_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file, same as the other two registries
export const DOC_ALLOWED_TYPES = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
];

/** Document metadata — never carries the bytes. */
export interface DocumentMeta {
  id:         string;
  filename:   string;
  mimeType:   string;
  fileSize:   number;
  sha256:     string;
  uploadedAt: string;
  purgedAt:   string | null;
}

function docRow(r: any): DocumentMeta {
  return {
    id: String(r.id),
    filename: String(r.filename),
    mimeType: String(r.mime_type),
    fileSize: Number(r.file_size || 0),
    sha256: String(r.sha256),
    uploadedAt: String(r.uploaded_at),
    purgedAt: r.purged_at != null ? String(r.purged_at) : null,
  };
}

/**
 * Attach a document to a receivable. Only the tenant that owns the receivable may.
 * There is no limit on the number of files: a scanned note runs to several pages and
 * being unable to attach page four is not a boundary worth enforcing.
 */
export async function addDocument(
  tenantId: string,
  receivableId: string,
  input: { filename: string; mimeType: string; bytes: Buffer },
): Promise<{ ok: true; doc: DocumentMeta } | { ok: false; error: string }> {
  await ensureReceivablesTables();

  const owns = await db.execute({
    sql: `SELECT 1 FROM receivables WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(receivableId || '').trim(), tenantId],
  });
  if (!owns.rows.length) return { ok: false, error: 'not_found' };

  const mime = String(input.mimeType || '').toLowerCase().split(';')[0].trim();
  if (!DOC_ALLOWED_TYPES.includes(mime)) return { ok: false, error: 'unsupported_type' };
  if (!input.bytes?.length) return { ok: false, error: 'empty' };
  if (input.bytes.length > DOC_MAX_SIZE_BYTES) return { ok: false, error: 'too_large' };

  const filename = clampStr(input.filename, 200) || 'document';
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const id = randomUUID();

  await db.execute({
    sql: `INSERT INTO receivable_documents
            (id, receivable_id, tenant_id, filename, mime_type, file_size, sha256, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, String(receivableId).trim(), tenantId, filename, mime,
           input.bytes.length, sha256, input.bytes.toString('base64')],
  });

  const r = await db.execute({
    sql: `SELECT id, filename, mime_type, file_size, sha256, uploaded_at, purged_at
            FROM receivable_documents WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return { ok: true, doc: docRow(r.rows[0]) };
}

/** Metadata for every document on a receivable, purged ones included (the tombstones). */
export async function listDocuments(receivableId: string): Promise<DocumentMeta[]> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT id, filename, mime_type, file_size, sha256, uploaded_at, purged_at
            FROM receivable_documents WHERE receivable_id = ? ORDER BY uploaded_at ASC`,
    args: [String(receivableId || '').trim()],
  });
  return r.rows.map(docRow);
}

/** The bytes. Returns null once purged — the tombstone has no document to give. */
export async function readDocument(
  documentId: string,
  receivableId: string,
): Promise<{ meta: DocumentMeta; data: Buffer } | null> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT id, filename, mime_type, file_size, sha256, uploaded_at, purged_at, data
            FROM receivable_documents WHERE id = ? AND receivable_id = ? LIMIT 1`,
    args: [String(documentId || '').trim(), String(receivableId || '').trim()],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  if (!row.data) return null;
  return { meta: docRow(row), data: Buffer.from(String(row.data), 'base64') };
}

/**
 * Drop the bytes, keep the proof. Called when the last outstanding confirmation request
 * on a receivable closes — not on the first answer, because a second recipient must still
 * be able to read what they are being asked to vouch for.
 */
export async function purgeDocuments(receivableId: string): Promise<number> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `UPDATE receivable_documents
             SET data = NULL, purged_at = ?
           WHERE receivable_id = ? AND data IS NOT NULL`,
    args: [nowUtc(), String(receivableId || '').trim()],
  });
  return Number(r.rowsAffected || 0);
}

/**
 * Receivables holding document bytes with no confirmation request still open against
 * them — every buyer invite answered, revoked, or expired. An invite that has not been
 * sent yet cannot hold the paperwork open, so a receivable with no buyer invite at all
 * is only purgeable once its documents are older than the invite TTL; otherwise a banker
 * who uploads on Monday and sends the link on Tuesday would find the file already gone.
 */
export async function listPurgeableReceivables(limit = 200): Promise<string[]> {
  await ensureReceivablesTables();
  const ago = (ms: number) =>
    new Date(Date.now() - ms).toISOString().replace('T', ' ').slice(0, 19);

  const r = await db.execute({
    sql: `
      WITH held AS (
        SELECT receivable_id, MIN(uploaded_at) AS first_upload
          FROM receivable_documents
         WHERE data IS NOT NULL
         GROUP BY receivable_id
      ),
      asked AS (
        SELECT receivable_id,
               MAX(accepted_at) AS last_answered,
               MAX(expires_at)  AS last_expiry,
               COUNT(*) FILTER (
                 WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
               ) AS still_open
          FROM receivable_invites
         WHERE role = 'buyer'
         GROUP BY receivable_id
      )
      SELECT h.receivable_id AS rid
        FROM held h
        LEFT JOIN asked a ON a.receivable_id = h.receivable_id
       WHERE COALESCE(a.still_open, 0) = 0
         AND (
               -- never sent to anyone
               (a.receivable_id IS NULL AND h.first_upload <= ?)
               -- somebody answered
               OR (a.last_answered IS NOT NULL AND a.last_answered <= ?)
               -- asked, nobody ever answered, and the last link is long expired
               OR (a.receivable_id IS NOT NULL AND a.last_answered IS NULL AND a.last_expiry <= ?)
             )
       LIMIT ?`,
    args: [
      nowUtc(),
      ago(INVITE_TTL_DAYS * 86400_000),
      ago(PURGE_GRACE_ANSWERED_H * 3600_000),
      ago(PURGE_GRACE_UNANSWERED_D * 86400_000),
      limit,
    ],
  });
  return r.rows.map((x: any) => String(x.rid));
}

// ── Confirmation requests — one receivable, many askees ───────────────────────

export interface ConfirmRequestRow {
  token:      string;
  sentTo:     string | null;   // the address the banker typed. This is the provenance.
  label:      string | null;   // who he says it went to
  status:     'pending' | 'answered' | 'revoked' | 'expired';
  answeredBy: string | null;   // the name typed by whoever answered
  answeredAt: string | null;
  expiresAt:  string;
  createdAt:  string;
}

/**
 * Every confirmation request on one receivable, in the order they were sent.
 *
 * Asking two people is the point: one answer from an address the supplier controls proves
 * very little, and the disagreement between two answers is itself evidence. So the desk
 * shows the whole roster — who was asked, at which address, and what came back — rather
 * than a single confirmed/unconfirmed flag.
 */
export async function listConfirmRequests(
  tenantId: string,
  receivableId: string,
): Promise<ConfirmRequestRow[]> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT token, email, label, expires_at, accepted_at, accepted_by, revoked_at, created_at
            FROM receivable_invites
           WHERE receivable_id = ? AND from_tenant = ? AND role = 'buyer'
           ORDER BY created_at ASC`,
    args: [String(receivableId || '').trim(), tenantId],
  });
  const now = nowUtc();
  return r.rows.map((x: any) => {
    const status: ConfirmRequestRow['status'] =
      x.revoked_at ? 'revoked'
      : x.accepted_at ? 'answered'
      : String(x.expires_at) < now ? 'expired'
      : 'pending';
    return {
      token: String(x.token),
      sentTo: x.email != null ? String(x.email) : null,
      label: x.label != null ? String(x.label) : null,
      status,
      answeredBy: x.accepted_by != null ? String(x.accepted_by) : null,
      answeredAt: x.accepted_at != null ? String(x.accepted_at) : null,
      expiresAt: String(x.expires_at),
      createdAt: String(x.created_at),
    };
  });
}

/**
 * A document, fetched with a confirmation token instead of a session. The person being
 * asked to vouch for paperwork has no account, so the link has to carry read access to
 * the thing it is asking about. Scoped hard: only an open buyer token, only documents on
 * that token's own receivable.
 */
export async function readDocumentByToken(
  token: string,
  documentId: string,
): Promise<{ meta: DocumentMeta; data: Buffer } | null> {
  await ensureReceivablesTables();
  // Deliberately NOT readInvite: that reports a token 'used' the moment it is answered,
  // and someone who just vouched for a document should still be able to save the copy
  // they will need to check against the fingerprint later. Answering spends the right to
  // answer, not the right to read. Revoked and expired still close it, and the purge
  // closes it for everyone.
  const r = await db.execute({
    sql: `SELECT receivable_id, role, expires_at, revoked_at
            FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token || '').trim()],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  if (row.revoked_at) return null;
  if (String(row.expires_at) < nowUtc()) return null;
  if (String(row.role) !== 'buyer' || !row.receivable_id) return null;
  return readDocument(documentId, String(row.receivable_id));
}

/** Does this tenant own this receivable? The gate on every owner-only read. */
export async function ownsReceivable(tenantId: string, receivableId: string): Promise<boolean> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT 1 FROM receivables WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(receivableId || '').trim(), tenantId],
  });
  return r.rows.length > 0;
}

// ── Counter-signature — the supplier confirms the money arrived ───────────────
//
// Registering a claim is one firm typing its own name into a box. A lender who was shown
// the receivable and declined can register an advance they never made, eat the headroom,
// and poison the invoice for everyone behind them. "Claimed" has never meant "funded".
//
// So the supplier counter-signs: the money is not confirmed until the person who was
// supposed to receive it says he received it. Symmetric with the buyer confirmation, and
// for the same reason — the party with nothing to gain from the lie is the one worth
// asking. He needs no account either; the link is the authority.

export type CountersignOutcome = 'received' | 'not_received' | 'amount_wrong';

export interface CountersignAnswers {
  by: string;
  title?: string | null;
  /** What they actually received, when it differs from what the lender registered. */
  amountReceived?: number | null;
}

/** What the supplier sees before answering. */
export async function readCountersignRequest(token: string): Promise<
  | { ok: true; receivableId: string; claimId: string; financier: string; amount: number;
      currency: string; claimDate: string; invoiceNo: string; buyer: string;
      sentTo: string | null; alreadyAffirmed: boolean }
  | { ok: false; error: string }
> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT i.claim_id, i.email, i.expires_at, i.accepted_at, i.revoked_at,
                 c.receivable_id, c.financier, c.amount, c.currency, c.claim_date, c.affirmed_at
            FROM receivable_invites i
            JOIN receivable_claims c ON c.id = i.claim_id
           WHERE i.token = ? LIMIT 1`,
    args: [String(token || '').trim()],
  });
  if (!r.rows.length) return { ok: false, error: 'not_found' };
  const row = r.rows[0] as any;
  if (row.revoked_at) return { ok: false, error: 'revoked' };
  if (row.accepted_at) return { ok: false, error: 'used' };
  if (String(row.expires_at) < nowUtc()) return { ok: false, error: 'expired' };

  const rcv = await getReceivableRow(String(row.receivable_id));
  if (!rcv) return { ok: false, error: 'not_found' };

  return {
    ok: true,
    receivableId: String(row.receivable_id),
    claimId: String(row.claim_id),
    financier: String(row.financier),
    amount: Number(row.amount),
    currency: String(row.currency),
    claimDate: String(row.claim_date),
    invoiceNo: String(rcv.invoice_no),
    buyer: String(rcv.buyer),
    sentTo: row.email != null ? String(row.email) : null,
    alreadyAffirmed: !!row.affirmed_at,
  };
}

/**
 * Answer a counter-signature request. 'received' marks the claim affirmed; the two
 * disagreements do NOT, and file under role 'other' with a DISPUTED prefix so a denial
 * can never be read downstream as a confirmation. Same shape as confirmByToken.
 */
export async function affirmClaimByToken(
  token: string,
  outcome: CountersignOutcome,
  answers: CountersignAnswers,
): Promise<{ ok: true; attestationId: string; claimId: string; receivableId: string } | { ok: false; error: string }> {
  await ensureReceivablesTables();

  const req = await readCountersignRequest(token);
  if (!req.ok) return { ok: false, error: req.error };

  const who = clampStr(answers.by, 100);
  if (!who) return { ok: false, error: 'name_required' };

  const sender = await db.execute({
    sql: `SELECT from_tenant, email FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token).trim()],
  });
  const fromTenant = String((sender.rows[0] as any)?.from_tenant ?? '');

  const title = answers.title ? ` (${clampStr(answers.title, 60)})` : '';
  const via = ' via a single-use link';  // see confirmByToken: never the address
  const registered = `${req.currency} ${req.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  let statement: string;
  let role: AttesterRole;
  if (outcome === 'received') {
    statement = `Confirms receipt of ${registered} advanced by ${req.financier} against invoice ${req.invoiceNo}, registered ${req.claimDate}. Answered by ${who}${title}${via}.`;
    role = 'supplier';
  } else if (outcome === 'not_received') {
    statement = `DISPUTED — states no money was received from ${req.financier} against invoice ${req.invoiceNo}. Claim registered ${req.claimDate} for ${registered}. Answered by ${who}${title}${via}.`;
    role = 'other';
  } else {
    const got = Number(answers.amountReceived);
    const gotStr = Number.isFinite(got) && got > 0
      ? `${req.currency} ${got.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : 'a different amount';
    statement = `DISPUTED — states the amount received was ${gotStr}, not the ${registered} registered by ${req.financier} against invoice ${req.invoiceNo}. Answered by ${who}${title}${via}.`;
    role = 'other';
  }

  // Claim the token before writing anything, so a forwarded link cannot answer twice.
  const claimed = await db.execute({
    sql: `UPDATE receivable_invites SET accepted_at = ?, accepted_by = ?
           WHERE token = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), who, String(token).trim()],
  });
  if (!claimed.rowsAffected) return { ok: false, error: 'used' };

  const result = await addAttestation(fromTenant, req.receivableId, {
    role, label: `${req.financier} advance`, statement,
  });
  if (!result.ok) return { ok: false, error: result.error };

  if (outcome === 'received') {
    await db.execute({
      sql: `UPDATE receivable_claims SET affirmed_at = ?, affirmed_by = ?
             WHERE id = ? AND affirmed_at IS NULL`,
      args: [nowUtc(), who, req.claimId],
    });
  }

  return { ok: true, attestationId: result.attestationId, claimId: req.claimId, receivableId: req.receivableId };
}

/** Counter-signature requests sent on one claim, and what came back. */
export async function listCountersignRequests(
  tenantId: string,
  claimId: string,
): Promise<ConfirmRequestRow[]> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT token, email, label, expires_at, accepted_at, accepted_by, revoked_at, created_at
            FROM receivable_invites
           WHERE claim_id = ? AND from_tenant = ?
           ORDER BY created_at ASC`,
    args: [String(claimId || '').trim(), tenantId],
  });
  const now = nowUtc();
  return r.rows.map((x: any) => ({
    token: String(x.token),
    sentTo: x.email != null ? String(x.email) : null,
    label: x.label != null ? String(x.label) : null,
    status: (x.revoked_at ? 'revoked'
      : x.accepted_at ? 'answered'
      : String(x.expires_at) < now ? 'expired'
      : 'pending') as ConfirmRequestRow['status'],
    answeredBy: x.accepted_by != null ? String(x.accepted_by) : null,
    answeredAt: x.accepted_at != null ? String(x.accepted_at) : null,
    expiresAt: String(x.expires_at),
    createdAt: String(x.created_at),
  }));
}

// ── Sending the request ───────────────────────────────────────────────────────
//
// A confirmation email is a cold message asking a stranger to click a link and vouch for
// a debt. That is also, precisely, what a phishing email looks like — so the message
// carries enough specifics for a real recipient to check it against their own records
// before clicking anything: their company, the amount, the invoice number, and who is
// asking. Reply-to is the financier's own address, never a no-reply, because the sane
// first move for a cautious accounts clerk is to reply and ask.

export interface SendableRequest {
  token:      string;
  /** 'invitation' carries no receivable: it onboards a client rather than asking about a deal. */
  kind:       'debtor' | 'client' | 'client_record' | 'offer' | 'invitation';
  sentTo:     string;
  supplier:   string;
  buyer:      string;
  invoiceNo:  string;
  amount:     number;
  currency:   string;
  expiresAt:  string;
  /** What the sender called themselves when minting it. Shown to the invitee. */
  label:      string | null;
  /** Offer terms, so the email can state them rather than only linking to them. Stated as
   *  the financier wrote them: what is agreed between him and his client is theirs. */
  recourse:   Recourse | null;
  price:      string | null;
  buyerName:  string | null;
}

/**
 * The facts behind one outstanding request, for the tenant that created it. Returns null
 * for anyone else's token, an already-answered one, or one with no address to send to.
 */
export async function getSendableRequest(
  tenantId: string,
  token: string,
): Promise<SendableRequest | null> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT i.token, i.role, i.email, i.label, i.claim_id, i.offer_id, i.expires_at,
                 i.accepted_at, i.revoked_at,
                 i.receivable_id, c.amount AS claim_amount, c.currency AS claim_currency,
                 o.amount AS offer_amount, o.currency AS offer_currency,
                 o.recourse AS offer_recourse, o.price AS offer_price
            FROM receivable_invites i
       LEFT JOIN receivable_claims c ON c.id = i.claim_id
       LEFT JOIN receivable_offers o ON o.id = i.offer_id
           WHERE i.token = ? AND i.from_tenant = ? LIMIT 1`,
    args: [String(token || '').trim(), tenantId],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  if (row.revoked_at || row.accepted_at) return null;
  if (String(row.expires_at) < nowUtc()) return null;
  if (!row.email) return null;

  const label = row.label != null ? String(row.label) : null;

  // A bare invitation onboards someone; there is no deal to describe yet.
  if (!row.receivable_id) {
    return {
      token: String(row.token), kind: 'invitation', sentTo: String(row.email),
      supplier: '', buyer: '', invoiceNo: '', amount: 0, currency: '',
      expiresAt: String(row.expires_at), label, recourse: null, price: null, buyerName: null,
    };
  }

  const rcv = await getReceivableRow(String(row.receivable_id));
  if (!rcv) return null;

  // Key off the ROLE, not on which columns happen to be filled. The first version
  // inferred "has a receivable and no claim, therefore debtor", which sent every
  // non-buyer invite to the debtor confirmation page, where it was correctly refused as
  // "not a confirmation request". Each page expects a specific role, so the mapping has
  // to be the role.
  const isClaim = !!row.claim_id;
  const role = String(row.role || '');
  const kind: SendableRequest['kind'] =
    row.offer_id ? 'offer'                                      // terms, before money moves
    : isClaim ? 'client'                                        // receipt of an advance
    : role === 'buyer' ? 'debtor'                               // the debt is real
    : role === 'borrower' && row.receivable_id ? 'client_record' // the record is correct
    : 'invitation';                                             // onboarding, no deal yet

  // An invitation carries no deal to describe even when it names a receivable.
  if (kind === 'invitation') {
    return {
      token: String(row.token), kind, sentTo: String(row.email),
      supplier: '', buyer: '', invoiceNo: '', amount: 0, currency: '',
      expiresAt: String(row.expires_at), label, recourse: null, price: null, buyerName: null,
    };
  }

  return {
    token: String(row.token),
    kind,
    sentTo: String(row.email),
    supplier: String(rcv.supplier),
    buyer: String(rcv.buyer),
    invoiceNo: String(rcv.invoice_no),
    amount: row.offer_id ? Number(row.offer_amount) : isClaim ? Number(row.claim_amount) : Number(rcv.face),
    currency: String((row.offer_id ? row.offer_currency : isClaim ? row.claim_currency : null) || rcv.currency),
    expiresAt: String(row.expires_at),
    label,
    recourse: row.offer_recourse ? (String(row.offer_recourse) === 'non_recourse' ? 'non_recourse' : 'recourse') : null,
    price: row.offer_price != null ? String(row.offer_price) : null,
    buyerName: String(rcv.buyer),
  };
}

/** How many requests this tenant has created in the last hour. The spam ceiling. */
export async function countRecentInvites(tenantId: string): Promise<number> {
  await ensureReceivablesTables();
  const since = new Date(Date.now() - 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM receivable_invites WHERE from_tenant = ? AND created_at >= ?`,
    args: [tenantId, since],
  });
  return Number((r.rows[0] as any)?.n ?? 0);
}

/**
 * Which page a token actually belongs to, for a link that landed on the wrong one.
 *
 * A person holding a link cannot be told "wrong page" and left there. They did not choose
 * the URL, they clicked what they were sent, and a dead end reads as a broken product
 * rather than a misrouted link.
 */
export async function pathForToken(token: string): Promise<string | null> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT role, claim_id, offer_id, receivable_id, expires_at, revoked_at
            FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token || '').trim()],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  if (row.revoked_at || String(row.expires_at) < nowUtc()) return null;

  const t = encodeURIComponent(String(token).trim());
  if (row.offer_id) return `/verify/offer?token=${t}`;
  if (row.claim_id) return `/verify/countersign?token=${t}`;
  if (String(row.role) === 'buyer' && row.receivable_id) return `/verify/authenticate?token=${t}`;
  if (String(row.role) === 'borrower' && row.receivable_id) return `/verify/attest?token=${t}`;
  return `/verify/invite?token=${t}`;
}

// ── The client confirms the record ────────────────────────────────────────────
//
// The third assertion, and the one that was missing. In the banker-led flow the financier
// types everything: the client's name, the amount, the terms, the goods. The client never
// puts his name to any of it. So if the deal goes wrong he can say "I never told him that"
// and nothing on the record contradicts him.
//
// This asks him, at intake, before any money moves: did we record your deal correctly, and
// is the paperwork we scanned the paperwork you brought? Same shape as the debtor's
// confirmation, and for the same reason — the party who would know is the one worth asking.
//
// A request of this kind is an invite with role 'borrower' and a receivable but no claim.
// The receipt counter-signature is the one WITH a claim; it asks a different question and
// cannot be answered before an advance exists.

export type RecordOutcome = 'accurate' | 'wrong';

export interface RecordAnswers {
  by: string;
  title?: string | null;
  /** What they say is wrong, when they say something is. */
  correction?: string | null;
}

export async function readRecordRequest(token: string): Promise<
  | { ok: true; receivableId: string; supplier: string; buyer: string; invoiceNo: string;
      face: number; currency: string; terms: string | null; dueDate: string | null;
      details: ReceivableDetails | null; documents: DocumentMeta[]; sentTo: string | null }
  | { ok: false; error: string }
> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT receivable_id, role, claim_id, email, expires_at, accepted_at, revoked_at
            FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token || '').trim()],
  });
  if (!r.rows.length) return { ok: false, error: 'not_found' };
  const row = r.rows[0] as any;
  if (row.revoked_at) return { ok: false, error: 'revoked' };
  if (row.accepted_at) return { ok: false, error: 'used' };
  if (String(row.expires_at) < nowUtc()) return { ok: false, error: 'expired' };
  if (row.claim_id || !row.receivable_id || String(row.role) !== 'borrower') {
    return { ok: false, error: 'wrong_kind' };
  }

  const rcv = await getReceivableRow(String(row.receivable_id));
  if (!rcv) return { ok: false, error: 'not_found' };

  return {
    ok: true,
    receivableId: String(rcv.id),
    supplier: String(rcv.supplier), buyer: String(rcv.buyer), invoiceNo: String(rcv.invoice_no),
    face: Number(rcv.face), currency: String(rcv.currency),
    terms: rcv.terms != null ? String(rcv.terms) : null,
    dueDate: rcv.due_date != null ? String(rcv.due_date) : null,
    details: parseDetails(rcv.details_json),
    documents: (await listDocuments(String(rcv.id))).filter((d) => !d.purgedAt),
    sentTo: row.email != null ? String(row.email) : null,
  };
}

export async function confirmRecordByToken(
  token: string,
  outcome: RecordOutcome,
  answers: RecordAnswers,
): Promise<{ ok: true; attestationId: string; receivableId: string } | { ok: false; error: string }> {
  await ensureReceivablesTables();

  const req = await readRecordRequest(token);
  if (!req.ok) return { ok: false, error: req.error };

  const who = clampStr(answers.by, 100);
  if (!who) return { ok: false, error: 'name_required' };

  const sender = await db.execute({
    sql: `SELECT from_tenant FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token).trim()],
  });
  const fromTenant = String((sender.rows[0] as any)?.from_tenant ?? '');

  const title = answers.title ? ` (${clampStr(answers.title, 60)})` : '';
  const amount = `${req.currency} ${req.face.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  let statement: string;
  let role: AttesterRole;
  if (outcome === 'accurate') {
    statement = `Confirms this is their receivable: invoice ${req.invoiceNo} to ${req.buyer} for ${amount}, and that the attached paperwork is what they provided. Answered by ${who}${title} via a single-use link.`;
    role = 'supplier';
  } else {
    const what = clampStr(answers.correction ?? '', 300);
    statement = `DISPUTED — states the record is wrong. Invoice ${req.invoiceNo} to ${req.buyer} for ${amount}.${what ? ` They say: ${what}` : ''} Answered by ${who}${title} via a single-use link.`;
    role = 'other';
  }

  const claimed = await db.execute({
    sql: `UPDATE receivable_invites SET accepted_at = ?, accepted_by = ?
           WHERE token = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), who, String(token).trim()],
  });
  if (!claimed.rowsAffected) return { ok: false, error: 'used' };

  const docs = req.documents.map((d) => ({ sha256: d.sha256, filename: d.filename }));
  const result = await addAttestation(fromTenant, req.receivableId, {
    role, label: req.supplier, statement, docs,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, attestationId: result.attestationId, receivableId: req.receivableId };
}

// ── Requests that nobody answers ──────────────────────────────────────────────
//
// A client who takes the money and goes quiet, or a debtor who never replies, used to
// leave nothing behind at all. The link expired and the record simply had a hole in it,
// with no evidence that anyone had ever asked.
//
// That is backwards here. We cannot make anyone answer. We can prove the asking happened,
// and an unanswered request is itself a fact worth signing: it shows the financier did the
// diligence, and it lets a second financier weigh silence instead of guessing at it.

export interface OpenRequest {
  token: string; receivableId: string; role: string; claimId: string | null;
  email: string | null; expiresAt: string; createdAt: string; remindedAt: string | null;
}

function openRequestRow(x: any): OpenRequest {
  return {
    token: String(x.token),
    receivableId: String(x.receivable_id),
    role: String(x.role),
    claimId: x.claim_id != null ? String(x.claim_id) : null,
    email: x.email != null ? String(x.email) : null,
    expiresAt: String(x.expires_at),
    createdAt: String(x.created_at),
    remindedAt: x.reminded_at != null ? String(x.reminded_at) : null,
  };
}

/** Live requests closing within `hours` that have not been chased yet. */
export async function listRequestsToRemind(hours = 48, limit = 200): Promise<OpenRequest[]> {
  await ensureReceivablesTables();
  const soon = new Date(Date.now() + hours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  const r = await db.execute({
    sql: `SELECT token, receivable_id, role, claim_id, email, expires_at, created_at, reminded_at
            FROM receivable_invites
           WHERE accepted_at IS NULL AND revoked_at IS NULL AND reminded_at IS NULL
             AND email IS NOT NULL AND receivable_id IS NOT NULL
             AND expires_at > ? AND expires_at <= ?
           LIMIT ?`,
    args: [nowUtc(), soon, limit],
  });
  return r.rows.map(openRequestRow);
}

export async function markReminded(token: string): Promise<void> {
  await db.execute({
    sql: `UPDATE receivable_invites SET reminded_at = ? WHERE token = ? AND reminded_at IS NULL`,
    args: [nowUtc(), String(token).trim()],
  });
}

/** Expired, never answered, and the fact of that not yet written down. */
export async function listLapsedRequests(limit = 200): Promise<OpenRequest[]> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT token, receivable_id, role, claim_id, email, expires_at, created_at, reminded_at
            FROM receivable_invites
           WHERE accepted_at IS NULL AND revoked_at IS NULL AND lapse_recorded_at IS NULL
             AND receivable_id IS NOT NULL AND expires_at <= ?
           LIMIT ?`,
    args: [nowUtc(), limit],
  });
  return r.rows.map(openRequestRow);
}

/**
 * Write the silence down. Signed and anchorable like any other record, and filed under
 * role 'other' so it can never be mistaken for somebody's answer.
 *
 * Deliberately does NOT name the address. The public lookup promises no identities, and
 * the person who did not reply consented to even less than the person who did. How many
 * times, and to which address, stays on the financier's own roster.
 */
export async function recordLapse(req: OpenRequest): Promise<boolean> {
  await ensureReceivablesTables();

  const claimed = await db.execute({
    sql: `UPDATE receivable_invites SET lapse_recorded_at = ?
           WHERE token = ? AND lapse_recorded_at IS NULL`,
    args: [nowUtc(), req.token],
  });
  if (!claimed.rowsAffected) return false;

  const owner = await db.execute({
    sql: `SELECT from_tenant FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [req.token],
  });
  const fromTenant = String((owner.rows[0] as any)?.from_tenant ?? '');
  if (!fromTenant) return false;

  const asked = req.role === 'buyer' ? 'the debtor'
    : req.claimId ? 'the client, to confirm the advance reached him'
    : 'the client, to confirm the record';
  const chased = req.remindedAt ? ' A reminder was sent.' : '';

  const rcv = await getReceivableRow(req.receivableId);
  const label = rcv ? String(rcv.buyer) : 'Unanswered request';

  const result = await addAttestation(fromTenant, req.receivableId, {
    role: 'other',
    label: req.role === 'buyer' ? label : (rcv ? String(rcv.supplier) : label),
    statement: `UNANSWERED — a confirmation was requested from ${asked} on ${req.createdAt.slice(0, 10)} and expired without a reply on ${req.expiresAt.slice(0, 10)}.${chased} This records the request, not an answer.`,
    date: req.expiresAt.slice(0, 10),
  });
  return result.ok;
}

/** Outstanding and lapsed requests across a financier's whole book, so nothing rots unseen. */
export async function listOutstandingForTenant(tenantId: string, limit = 200): Promise<Array<{
  receivableId: string; supplier: string; buyer: string; invoiceNo: string;
  role: string; claimId: string | null; email: string | null;
  expiresAt: string; state: 'pending' | 'lapsed';
}>> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT i.receivable_id, i.role, i.claim_id, i.email, i.expires_at,
                 r.supplier, r.buyer, r.invoice_no
            FROM receivable_invites i
            JOIN receivables r ON r.id = i.receivable_id
           WHERE i.from_tenant = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
             AND r.settled_at IS NULL
           ORDER BY i.expires_at ASC
           LIMIT ?`,
    args: [tenantId, limit],
  });
  const now = nowUtc();
  return r.rows.map((x: any) => ({
    receivableId: String(x.receivable_id),
    supplier: String(x.supplier), buyer: String(x.buyer), invoiceNo: String(x.invoice_no),
    role: String(x.role),
    claimId: x.claim_id != null ? String(x.claim_id) : null,
    email: x.email != null ? String(x.email) : null,
    expiresAt: String(x.expires_at),
    state: String(x.expires_at) < now ? 'lapsed' : 'pending',
  }));
}

// ── Offers ────────────────────────────────────────────────────────────────────

export type Recourse = 'recourse' | 'non_recourse';

export interface OfferInput {
  financier: string;
  amount: number;
  currency?: string;
  /** What it costs him, in the financier's own words. Fee structures vary too much to model. */
  price?: string | null;
  recourse: Recourse;
  /** Who pays whom, and when. Disclosed or confidential factoring reads differently here. */
  repayment?: string | null;
  /** Days the offer stands. A credit view taken today should not be acceptable in a month. */
  validDays?: number;
}

export interface PublicOffer {
  id: string; financier: string; amount: number; currency: string;
  price: string | null; recourse: Recourse; repayment: string | null;
  expiresAt: string; createdAt: string;
  acceptedAt: string | null; acceptedBy: string | null;
  declinedAt: string | null; declinedReason: string | null;
  signed: boolean; anchored: boolean; anchoredAt: string | null;
}

const OFFER_TTL_DAYS = 14;

function offerRow(r: any): PublicOffer {
  return {
    id: String(r.id), financier: String(r.financier),
    amount: Number(r.amount), currency: String(r.currency),
    price: r.price != null ? String(r.price) : null,
    recourse: (String(r.recourse) === 'non_recourse' ? 'non_recourse' : 'recourse') as Recourse,
    repayment: r.repayment != null ? String(r.repayment) : null,
    expiresAt: String(r.expires_at), createdAt: String(r.created_at),
    acceptedAt: r.accepted_at != null ? String(r.accepted_at) : null,
    acceptedBy: r.accepted_by != null ? String(r.accepted_by) : null,
    declinedAt: r.declined_at != null ? String(r.declined_at) : null,
    declinedReason: r.declined_reason != null ? String(r.declined_reason) : null,
    signed: !!r.signature_json, anchored: !!r.anchor_json, anchoredAt: anchoredAtOf(r.anchor_json),
  };
}

export async function createOffer(
  tenantId: string,
  receivableId: string,
  input: OfferInput,
): Promise<{ ok: true; offerId: string; digest: string; signed: boolean } | { ok: false; error: string; message?: string }> {
  await ensureReceivablesTables();
  if (!(await ownsReceivable(tenantId, receivableId))) return { ok: false, error: 'not_found' };

  const rcv = await getReceivableRow(String(receivableId).trim());
  if (!rcv) return { ok: false, error: 'not_found' };

  const financier = clampStr(input.financier, 120);
  const amount = Number(input.amount);
  const currency = clampStr(input.currency || rcv.currency, 8).toUpperCase() || rcv.currency;
  if (!financier) return { ok: false, error: 'invalid', message: 'Your firm name is required.' };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid', message: 'The offer amount must be a positive number.' };
  }

  const recourse: Recourse = input.recourse === 'non_recourse' ? 'non_recourse' : 'recourse';
  const price = input.price != null ? clampStr(input.price, 300) || null : null;
  const repayment = input.repayment != null ? clampStr(input.repayment, 300) || null : null;
  const days = Number.isFinite(input.validDays) && (input.validDays as number) > 0
    ? Math.min(90, Math.floor(input.validDays as number))
    : OFFER_TTL_DAYS;
  const expiresAt = new Date(Date.now() + days * 86400_000).toISOString().replace('T', ' ').slice(0, 19);

  const manifest = {
    v: 1, kind: 'financing_offer', receivableId: rcv.id,
    financier, amount, currency, price, recourse, repayment, expiresAt,
  };
  const { signature, digest } = sign(manifest);
  const offerId = randomUUID();

  await db.execute({
    sql: `INSERT INTO receivable_offers
            (id, receivable_id, tenant_id, financier, amount, currency, price, recourse,
             repayment, expires_at, manifest_json, signature_json, digest)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [offerId, rcv.id, tenantId, financier, amount, currency, price, recourse,
           repayment, expiresAt, JSON.stringify(manifest),
           signature ? JSON.stringify(signature) : null, digest],
  });
  return { ok: true, offerId, digest, signed: !!signature };
}

export async function listOffers(receivableId: string): Promise<PublicOffer[]> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT * FROM receivable_offers WHERE receivable_id = ? ORDER BY created_at ASC`,
    args: [String(receivableId || '').trim()],
  });
  return r.rows.map(offerRow);
}

/** What the client sees. No account: he is being offered money, not signing up for software. */
export async function readOfferRequest(token: string): Promise<
  | { ok: true; offer: PublicOffer; supplier: string; buyer: string; invoiceNo: string;
      face: number; currency: string; dueDate: string | null; documents: DocumentMeta[] }
  | { ok: false; error: string }
> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT i.offer_id, i.expires_at, i.accepted_at, i.revoked_at, i.receivable_id
            FROM receivable_invites i WHERE i.token = ? LIMIT 1`,
    args: [String(token || '').trim()],
  });
  if (!r.rows.length) return { ok: false, error: 'not_found' };
  const inv = r.rows[0] as any;
  if (inv.revoked_at) return { ok: false, error: 'revoked' };
  if (inv.accepted_at) return { ok: false, error: 'used' };
  if (String(inv.expires_at) < nowUtc()) return { ok: false, error: 'expired' };
  if (!inv.offer_id) return { ok: false, error: 'wrong_kind' };

  const o = await db.execute({
    sql: `SELECT * FROM receivable_offers WHERE id = ? LIMIT 1`,
    args: [String(inv.offer_id)],
  });
  if (!o.rows.length) return { ok: false, error: 'not_found' };
  const offer = offerRow(o.rows[0]);
  if (offer.acceptedAt || offer.declinedAt) return { ok: false, error: 'used' };
  if (offer.expiresAt < nowUtc()) return { ok: false, error: 'offer_expired' };

  const rcv = await getReceivableRow(String(inv.receivable_id));
  if (!rcv) return { ok: false, error: 'not_found' };

  return {
    ok: true, offer,
    supplier: String(rcv.supplier), buyer: String(rcv.buyer), invoiceNo: String(rcv.invoice_no),
    face: Number(rcv.face), currency: String(rcv.currency),
    dueDate: rcv.due_date != null ? String(rcv.due_date) : null,
    documents: (await listDocuments(String(rcv.id))).filter((d) => !d.purgedAt),
  };
}

/**
 * Accept or decline. Acceptance records a signed attestation reciting the terms, so what he
 * agreed to is on the record and not only in the offer we happened to store.
 */
export async function respondToOffer(
  token: string,
  outcome: 'accept' | 'decline',
  answers: { by: string; title?: string | null; reason?: string | null; initials?: string | null },
): Promise<{ ok: true; attestationId: string; receivableId: string; offerId: string } | { ok: false; error: string }> {
  await ensureReceivablesTables();

  const req = await readOfferRequest(token);
  if (!req.ok) return { ok: false, error: req.error };

  const who = clampStr(answers.by, 100);
  if (!who) return { ok: false, error: 'name_required' };

  const sender = await db.execute({
    sql: `SELECT from_tenant, receivable_id FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token).trim()],
  });
  const fromTenant = String((sender.rows[0] as any)?.from_tenant ?? '');
  const receivableId = String((sender.rows[0] as any)?.receivable_id ?? '');

  const claimed = await db.execute({
    sql: `UPDATE receivable_invites SET accepted_at = ?, accepted_by = ?
           WHERE token = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), who, String(token).trim()],
  });
  if (!claimed.rowsAffected) return { ok: false, error: 'used' };

  const o = req.offer;
  const title = answers.title ? ` (${clampStr(answers.title, 60)})` : '';
  const amt = `${o.currency} ${o.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  const rec = o.recourse === 'non_recourse'
    ? 'non-recourse'
    : 'with recourse';

  let statement: string;
  let role: AttesterRole;
  if (outcome === 'accept') {
    // Initials are taken against the recourse clause specifically, because that is the term
    // people sign without reading and the one they later say they never saw.
    const ini = clampStr(answers.initials ?? '', 8);
    if (!ini) return { ok: false, error: 'initials_required' };
    statement = `Accepts financing of ${amt} from ${o.financier} against invoice ${req.invoiceNo}. ${o.price ? `Charge: ${o.price}. ` : ''}Terms: ${rec}, initialled "${ini}".${o.repayment ? ` Repayment: ${o.repayment}.` : ''} Accepted by ${who}${title} via a single-use link, before funds were advanced.`;
    role = 'supplier';
    await db.execute({
      sql: `UPDATE receivable_offers SET accepted_at = ?, accepted_by = ? WHERE id = ? AND accepted_at IS NULL`,
      args: [nowUtc(), who, o.id],
    });
  } else {
    const why = clampStr(answers.reason ?? '', 300);
    statement = `DECLINED — did not accept financing of ${amt} from ${o.financier} against invoice ${req.invoiceNo}.${why ? ` They say: ${why}` : ''} Answered by ${who}${title} via a single-use link.`;
    role = 'other';
    await db.execute({
      sql: `UPDATE receivable_offers SET declined_at = ?, declined_reason = ? WHERE id = ? AND declined_at IS NULL`,
      args: [nowUtc(), why || null, o.id],
    });
  }

  const result = await addAttestation(fromTenant, receivableId, {
    role, label: req.supplier, statement,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, attestationId: result.attestationId, receivableId, offerId: o.id };
}

/**
 * Record-confirmation requests on one receivable: role 'borrower', no claim, no offer.
 * Separate from listConfirmRequests (the debtor's) and listCountersignRequests (an
 * advance's), because the three ask different questions of different people.
 */
export async function listRecordRequests(
  tenantId: string,
  receivableId: string,
): Promise<ConfirmRequestRow[]> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT token, email, label, expires_at, accepted_at, accepted_by, revoked_at, created_at
            FROM receivable_invites
           WHERE receivable_id = ? AND from_tenant = ? AND role = 'borrower'
             AND claim_id IS NULL AND offer_id IS NULL
           ORDER BY created_at ASC`,
    args: [String(receivableId || '').trim(), tenantId],
  });
  const now = nowUtc();
  return r.rows.map((x: any) => ({
    token: String(x.token),
    sentTo: x.email != null ? String(x.email) : null,
    label: x.label != null ? String(x.label) : null,
    status: (x.revoked_at ? 'revoked'
      : x.accepted_at ? 'answered'
      : String(x.expires_at) < now ? 'expired'
      : 'pending') as ConfirmRequestRow['status'],
    answeredBy: x.accepted_by != null ? String(x.accepted_by) : null,
    answeredAt: x.accepted_at != null ? String(x.accepted_at) : null,
    expiresAt: String(x.expires_at),
    createdAt: String(x.created_at),
  }));
}
