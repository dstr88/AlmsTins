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
  signManifestWithKey,
  verifyManifestSignature,
  getPublishedKeys,
  getSigningKeyId,
} from '@/lib/recordProof/signing';
import {
  classifyAttestation,
  type AttestationClass,
  type AttestationSource,
} from '@/lib/receivables/attestationClass';
import {
  claimedOf,
  financingStatusOf,
  lifecycleOf,
  type FinancingStatus,
  type Lifecycle,
} from '@/lib/receivables/status';
import {
  ADD_RECEIVABLE_DELETED_AT,
  DDL_LOCK_TIMEOUT,
  FINGERPRINT_COLUMN_ADDS,
  RECEIVABLE_COLUMN_ADDS,
  RECEIVABLE_INDEX_CREATES,
  RECEIVABLE_TABLE_CREATES,
} from '@/lib/receivables/schema';
import {
  resolveAcknowledged,
  withAcknowledged,
  type AckCode,
  type NoticeCode,
} from '@/lib/receivables/acknowledgments';
import { clampCurrency, fingerprintTuples, type FingerprintInput } from '@/lib/receivables/fingerprintNormalize';
import { computeFingerprints, fingerprintKid, type Fingerprints } from '@/lib/receivables/server/fingerprint';
import {
  claimRaisesDuplicate,
  publicDuplicateCheck,
  stateOnly,
  summarizeTwins,
  unavailableCheck,
  type DuplicateCheck,
  type DuplicateState,
  type OwnMatch,
  type PublicDuplicateCheck,
  type TwinRow,
} from '@/lib/receivables/duplicateCheck';
import {
  DUPLICATE_CHECK_LABEL,
  DUPLICATE_DETAIL_ANY_MATCH,
  DUPLICATE_DETAIL_FINANCED,
  DUPLICATE_DETAIL_MATCH,
  DUPLICATE_DETAIL_NO_REFERENCE,
  DUPLICATE_DETAIL_PASS,
  DUPLICATE_DETAIL_REFERENCE_ONLY,
  DUPLICATE_DETAIL_UNAVAILABLE,
  ID_COLLISION_MESSAGE,
  POSSIBLE_DUPLICATE_MESSAGE,
  POSSIBLE_MATCH_MESSAGE,
  UNKNOWN_ACKNOWLEDGMENT_MESSAGE,
} from '@/lib/receivables/copy/duplicate';
import { runWithoutDbContext } from '@/lib/dbContext';
import { withdrawnWriteMessage } from '@/lib/receivables/withdrawn';
import {
  ANCHOR_SPEC,
  ANCHOR_KINDS,
  CONFIRMED_RECEIPT_LIKE,
  isAnchorKind,
  type AnchorRecordKind,
} from '@/lib/receivables/anchorSpec';

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
  /** invoice | purchase_order | contract | milestone | other (their #3) */
  rtype?: string | null;
  paymentMethod?: string | null;
  /** Everything a real contract needs that the seven original fields did not carry. */
  details?: ReceivableDetails | null;
  /** A practice run. Everyone who sees this record is told, including the public check. */
  isTest?: boolean;
}

/**
 * The rest of the paperwork.
 *
 * The rule this exists for: the banker should never need a field and not have it. Five
 * are named because they recur on every deal; `extra` is the escape hatch for the one
 * that does not, so an unusual contract never dead-ends them mid-intake.
 *
 * `buyerRef` is the one to watch. It is the debtor's OWN reference for the obligation —
 * their PO or contract number — and it is the only candidate for a canonical key, because
 * it is the only identifier here that the supplier does not control. Since S3 the duplicate
 * check's strong key is built from it (src/lib/receivables/fingerprintNormalize.ts), and since
 * S4 all three create forms ask for it (BuyerRefField).
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
  /** What the row is (consent, party_dispute, diligence, system_note, party_statement), from
   *  its recorded source, or from its prefix on rows older than the source column. Additive:
   *  read this rather than the statement's opening word. The source itself stays internal. */
  class: AttestationClass;
  signed: boolean;
  anchored: boolean;
  anchoredAt: string | null;
}

/** A past "Verify now" run. tenant_id (who ran it) is never surfaced -- same no-attribution
 *  boundary as claims/attestations -- but the verdict and per-check detail are, since that's
 *  the whole point of a re-verification: contemporaneous evidence of what the control found. */
export interface PublicReverification {
  id: string;
  verdict: 'confirmed' | 'attention';
  checks: ReverifyCheck[];
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
  /** How many confirmations have been requested. A count, never the addresses. It is what
   *  separates "nobody has answered" from "nobody has been asked", which are not the same
   *  fact and should not read the same on screen. */
  requestCount: number;
  /** A practice run. Carried on the PUBLIC read too: a second financier must never mistake
   *  a rehearsal for an encumbrance, and a debtor must never confirm a debt that is not one. */
  isTest: boolean;
  createdAt: string;
  signed: boolean;
  anchored: boolean;
  anchoredAt: string | null;
  settled: boolean;
  settledAt: string | null;
  attestations: PublicAttestation[];
  claims: PublicClaim[];
  reverifications: PublicReverification[];
  claimed: number;
  available: number;
  status: FinancingStatus;
  /** Lifecycle stage: created → financed → settled (released = all claims discharged). */
  lifecycle: Lifecycle;
  /** Whether another record at Almstins matches this one (S3): the state and whether this record
   *  has a debtor reference, nothing more. This status is public (the lookup), so the key that
   *  matched and whether the match is financed are left out (owner decision 9: they go only to a
   *  verified account). Never a count, another record's ID or whose it is. */
  duplicateCheck: PublicDuplicateCheck;
  /** Additive, present only on a record its owner withdrew (S2 soft delete) that another party
   *  has a claim or statement on. Every other field reads as it did before the withdrawal;
   *  lifecycle is unchanged. A live record carries neither key. */
  withdrawn?: true;
  withdrawnAt?: string;
}

/** The answer to a new write on a record its owner withdrew (S2): routes send it as 410. */
export type WithdrawnError = { ok: false; error: 'withdrawn'; message: string; withdrawnAt: string };

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

// "Verify now" — one row per on-demand re-verification of a receivable. A signature proves
// what was true when it was signed; it cannot promise the fact stayed true between the advance
// and settlement. So a party re-runs the load-bearing checks at the moment they act, and the
// run is recorded here: a dated, signed verdict + the per-check result. This is the
// contemporaneous evidence that the control ran and what it found — the thing an examiner asks
// for — not a green light that vanishes. tenant_id records WHO checked; never surfaced publicly.
const ENSURE_REVERIFICATIONS_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_reverifications (
    id             TEXT NOT NULL PRIMARY KEY,
    receivable_id  TEXT NOT NULL,
    tenant_id      TEXT NOT NULL,
    verdict        TEXT NOT NULL,
    checks_json    TEXT NOT NULL,
    manifest_json  TEXT NOT NULL,
    signature_json TEXT,
    digest         TEXT NOT NULL,
    anchor_json    TEXT,
    created_at     TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
const ENSURE_REVERIFICATIONS_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_reverifications_rcv ON receivable_reverifications (receivable_id)`;

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
  // Optional free text the discharging financier can attach ("wire received Sept 28").
  // Part of the signed discharge_json manifest, not just this column. Tenant-only: never
  // selected by getReceivableStatus (the public second-financier check) — see its own
  // no-attribution comment. Omitted from the manifest entirely when blank, same convention
  // as roster docs, so discharges signed before this existed stay byte-identical.
  `ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharge_reason TEXT`,
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
  // Practice runs. Marked on the record itself and inside its signed manifest, so the flag
  // travels with every read and cannot be quietly dropped later.
  `ALTER TABLE receivables ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE`,
  // Last-activity clock. Any change to the receivable OR its children (a claim, an
  // attestation, a discharge, a settlement) bumps it, so "recently updated" and the
  // desk's unseen-update badge read one column. COALESCE(updated_at, created_at) on read.
  `ALTER TABLE receivables ADD COLUMN IF NOT EXISTS updated_at TEXT`,
];

// Per-financier read state: the last time a tenant looked at (or acted on) a receivable
// in their desk. An event newer than seen_at reads as an unseen update in Your book —
// the unread-email pattern, so a debtor confirming or a competing claim lands loudly and
// nothing the banker did themselves does. Keyed by (tenant, receivable); a banker only ever
// has read-state for receivables in their own book.
const ENSURE_SEEN_SQL = `
  CREATE TABLE IF NOT EXISTS receivable_seen (
    tenant_id      TEXT NOT NULL,
    receivable_id  TEXT NOT NULL,
    seen_at        TEXT NOT NULL,
    PRIMARY KEY (tenant_id, receivable_id)
  )
`;

/**
 * Offers — terms put to the client, before the money moves.
 *
 * The client's signature is worth most at the moment they want something. They accept because
 * that is how they get funded; once the money has landed they have nothing left to gain and a
 * reason to go quiet. So the binding artifact is taken here, not after.
 *
 * An offer carries what an offer has to carry to be one: the amount, the price, whether it
 * is recourse, how it is repaid, and when it stops being available. Nothing enforces the
 * order against the financier — they are a banker and know not to hand over cash before the
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
// The promissory note or contract the banker takes in at their office. Bytes live base64
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

// Single-flight. Concurrent first requests share one run instead of racing the same DDL. A run
// that throws (a CREATE failed: the database was unreachable, a lock timed out) is forgotten,
// so the next call tries again; a cached rejected promise would fail every later call until
// the process restarted.
let ensurePromise: Promise<void> | null = null;
// True only once every column add (the list below plus schema.ts's) has succeeded. Readers and
// writers of a column added in src/lib/receivables/schema.ts check it and fall back to what
// they did before that column existed, so a failed ALTER never breaks a read.
let columnsEnsured = false;
// Soft delete's own flag (S2): true once receivables.deleted_at is known to exist in this process.
// Every deleted_at branch reads this, never columnsEnsured, so an unrelated ALTER that fails (a
// dropped connection, a lock or statement timeout on another table) cannot make withdrawn records
// read as live again. Sticky: it is never set back to false, because a column does not go away.
let deletedAtReady = false;
// The duplicate check's own flag (S3): true once receivables.fingerprint_ref, fingerprint_inv and
// fingerprint_kid are all known to exist in this process. Every fingerprint reader and writer
// checks this, never columnsEnsured, and without it the check reads "unavailable", so a failed
// ALTER anywhere (on this table or another) can never make a duplicate read as clear. Sticky.
let fingerprintColumnsReady = false;
// After a failed column add: the earliest time the whole (idempotent) ensure runs again.
let columnsRetryAt = 0;
// After a failed index (every column add succeeded): the earliest time the indexes alone run
// again. Their own clock, so an index that keeps failing never re-runs the column adds (each of
// which takes an ACCESS EXCLUSIVE lock) every minute.
let indexRetryAt = 0;
const COLUMN_RETRY_MS = 60_000;

/** Whether every runtime column add has been applied in this process. */
export function receivableColumnsEnsured(): boolean {
  return columnsEnsured;
}

export function ensureReceivablesTables(): Promise<void> {
  const now = Date.now();
  if (ensurePromise && columnsRetryAt && now >= columnsRetryAt) {
    ensurePromise = null;
    columnsRetryAt = 0;
    indexRetryAt = 0;
  }
  if (!ensurePromise) {
    const run = runEnsureReceivablesTables();
    ensurePromise = run;
    run.catch(() => { if (ensurePromise === run) ensurePromise = null; });
  } else if (indexRetryAt && now >= indexRetryAt) {
    // Set only at the end of a run that succeeded, so ensurePromise has resolved. The index
    // retry never rejects (each failure is logged and re-arms this clock).
    indexRetryAt = 0;
    ensurePromise = ensurePromise.then(() => createReceivableIndexes());
  }
  return ensurePromise;
}

/** One ensure DDL statement under DDL_LOCK_TIMEOUT, in its own transaction on the owner pool. */
async function ddlUnderLockTimeout(sql: string): Promise<void> {
  await db.batch([{ sql: DDL_LOCK_TIMEOUT, args: [] }, { sql, args: [] }], 'write');
}

/** Postgres lock_not_available: the statement waited out DDL_LOCK_TIMEOUT. */
const isLockTimeout = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === '55P03';

/** The indexes on added columns. Never throws: a failure is logged and retried on indexRetryAt. */
async function createReceivableIndexes(): Promise<void> {
  let allIndexes = true;
  for (const sql of RECEIVABLE_INDEX_CREATES) {
    try {
      await ddlUnderLockTimeout(sql);
    } catch (e) {
      allIndexes = false;
      console.error('[receivables] index not applied:', e);
      // The table is locked: the next index would wait out the same timeout.
      if (isLockTimeout(e)) break;
    }
  }
  indexRetryAt = allIndexes ? 0 : Date.now() + COLUMN_RETRY_MS;
}

async function runEnsureReceivablesTables(): Promise<void> {
  await db.execute({ sql: ENSURE_RECEIVABLES_SQL, args: [] });
  await db.execute({ sql: ENSURE_RECEIVABLES_TENANT_IDX, args: [] });
  await db.execute({ sql: ENSURE_CLAIMS_SQL, args: [] });
  await db.execute({ sql: ENSURE_CLAIMS_RCV_IDX, args: [] });
  await db.execute({ sql: ENSURE_REVERIFICATIONS_SQL, args: [] });
  await db.execute({ sql: ENSURE_REVERIFICATIONS_IDX, args: [] });
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
  await db.execute({ sql: ENSURE_SEEN_SQL, args: [] });
  for (const sql of RECEIVABLE_TABLE_CREATES) await db.execute({ sql, args: [] });
  // Each column add runs under DDL_LOCK_TIMEOUT (see schema.ts). The first add that waits out the
  // timeout ends the list for this run: every later add would queue behind the same lock for
  // another three seconds while holding up that table's reads. The skipped adds are retried a
  // minute later, and each column's own readiness (below) never fails open in the meantime.
  let allColumns = true;
  let locked = false;
  let fingerprintAdds = 0;
  for (const sql of [...ENSURE_SETTLEMENT_COLS, ...RECEIVABLE_COLUMN_ADDS]) {
    try {
      await ddlUnderLockTimeout(sql);
      if (sql === ADD_RECEIVABLE_DELETED_AT) deletedAtReady = true;
      if (FINGERPRINT_COLUMN_ADDS.includes(sql)) fingerprintAdds++;
    } catch (e) {
      allColumns = false;
      console.error('[receivables] column not applied:', e);
      if (isLockTimeout(e)) { locked = true; break; }
    }
  }
  if (fingerprintAdds === FINGERPRINT_COLUMN_ADDS.length) fingerprintColumnsReady = true;
  // Indexes on added columns (S3's partial fingerprint indexes), each on its own and after every
  // column add, so no read runs before them. A failure is logged and retried on its own clock; it
  // gates nothing, because a missing index makes the twin query slower, never wrong. Skipped while
  // the table is locked: the whole ensure runs again in a minute anyway.
  if (!locked) await createReceivableIndexes();
  // ADD COLUMN IF NOT EXISTS takes a table lock first, so it can time out on a column that is
  // already there. A zero-row read of the column tells the two apart.
  if (!deletedAtReady) {
    try {
      await db.execute({ sql: `SELECT deleted_at FROM receivables LIMIT 0`, args: [] });
      deletedAtReady = true;
    } catch { /* not there yet: soft delete stays off until a later ensure adds it */ }
  }
  if (!fingerprintColumnsReady) {
    try {
      await db.execute({ sql: `SELECT fingerprint_ref, fingerprint_inv, fingerprint_kid FROM receivables LIMIT 0`, args: [] });
      fingerprintColumnsReady = true;
    } catch { /* not there yet: the duplicate check reads unavailable until a later ensure adds them */ }
  }
  columnsEnsured = allColumns;
  columnsRetryAt = allColumns ? 0 : Date.now() + COLUMN_RETRY_MS;
  // A full re-run creates the indexes again, so only a run whose columns all landed keeps an
  // index retry of its own.
  if (!allColumns) indexRetryAt = 0;
}

/** Bump a receivable's last-activity clock. Any change to it or a child (claim,
 *  attestation, discharge, settlement) calls this. Keyed by id ONLY, with no tenant
 *  filter: a competing claim registered by another financier must still float the
 *  record to the top of the creator's book. Non-fatal — sorting falls back to created_at. */
async function touchReceivable(receivableId: string): Promise<void> {
  try {
    await db.execute({ sql: `UPDATE receivables SET updated_at = ? WHERE id = ?`, args: [nowUtc(), String(receivableId)] });
  } catch { /* non-fatal */ }
}

/** Record that this tenant has seen (opened, or just acted on) a receivable, so only
 *  later changes read as unseen updates in their book. Upsert; non-fatal. */
export async function markReceivableSeen(tenantId: string, receivableId: string): Promise<void> {
  await ensureReceivablesTables();
  try {
    await db.execute({
      sql: `INSERT INTO receivable_seen (tenant_id, receivable_id, seen_at) VALUES (?, ?, ?)
            ON CONFLICT (tenant_id, receivable_id) DO UPDATE SET seen_at = excluded.seen_at`,
      args: [tenantId, String(receivableId), nowUtc()],
    });
  } catch { /* non-fatal */ }
}

/** Sign a manifest with the Almstins key. Returns null when no key is configured
 *  (fail-closed: the record is stored UNSIGNED rather than crashing). The stored key ID and
 *  public key are the seed's, the key that made the signature, never the published-key
 *  override, so a record signed during a key rotation still verifies. */
function sign(manifest: object): { signature: Signature | null; digest: string } {
  const bytes = canonicalManifestBytes(manifest);
  const digest = sha256hex(bytes);
  const sig = signManifestWithKey(bytes);
  if (!sig) return { signature: null, digest };
  return {
    signature: { keyId: sig.keyId, alg: sig.alg, signatureHex: sig.signatureHex, publicKeyHex: sig.publicKeyHex },
    digest,
  };
}

const clampStr = (s: unknown, n: number): string => String(s ?? '').trim().slice(0, n);
const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export type CreateReceivableResult =
  /** restored: present (true) only when this brought back a record the same tenant withdrew.
   *  duplicateCheck: whether another record matches this one (S3), the same answer the public check
   *  gives; ownMatches: the creating tenant's own matching records, present only when there are any. */
  | {
      ok: true; id: string; digest: string; signed: boolean; keyId: string | null; restored?: true;
      duplicateCheck: DuplicateCheck; ownMatches?: OwnMatch[];
    }
  | { ok: false; error: 'invalid'; message: string }
  /** The exact details are on record under another account. duplicateCheck covers the submitted
   *  details, that record included, so the second filer learns whether it is recorded as financed. */
  | { ok: false; error: 'id_collision'; message: string; duplicateCheck: DuplicateCheck; ownMatches?: OwnMatch[] };

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

/** A create's fields after the create clamps, before validation. Shared with the duplicate
 *  precheck, so a submitted form and the record it would become fingerprint the same. */
interface ClampedReceivable {
  supplier: string; buyer: string; invoiceNo: string; currency: string; face: number;
  terms: string | null; dueDate: string | null; acknowledgedAt: string | null;
  rtype: string | null; paymentMethod: string | null;
  details: ReceivableDetails | null; isTest: boolean;
}

function clampReceivableInput(input: ReceivableInput): ClampedReceivable {
  return {
    supplier: clampStr(input.supplier, 160),
    buyer: clampStr(input.buyer, 160),
    invoiceNo: clampStr(input.invoiceNo, 80),
    currency: clampCurrency(input.currency),
    face: Number(input.face),
    terms: input.terms != null ? clampStr(input.terms, 80) || null : null,
    dueDate: isYmd(input.dueDate) ? input.dueDate : null,
    acknowledgedAt: isYmd(input.acknowledgedAt) ? input.acknowledgedAt : null,
    rtype: input.rtype != null ? clampStr(input.rtype, 40) || null : null,
    paymentMethod: input.paymentMethod != null ? clampStr(input.paymentMethod, 40) || null : null,
    // Normalized so two intakes typing the same thing produce the same ID, and so an empty
    // details object never changes the hash of an otherwise identical record.
    details: normalizeDetails(input.details),
    isTest: input.isTest === true,
  };
}

/** The fingerprint fields of clamped create input. Every receivables row is the invoice type. */
function fingerprintInputOf(f: ClampedReceivable): FingerprintInput {
  return {
    recordType: 'invoice', supplier: f.supplier, buyer: f.buyer, invoiceNo: f.invoiceNo,
    buyerRef: f.details?.buyerRef ?? null, face: f.face, currency: f.currency, isTest: f.isTest,
  };
}

/** The fingerprint fields of a stored row, recomputed from the row itself (never its stored hashes). */
function fingerprintInputFromRow(row: {
  supplier: unknown; buyer: unknown; invoice_no: unknown; face: unknown; currency: unknown;
  details_json: unknown; is_test: unknown;
}): FingerprintInput {
  return {
    recordType: 'invoice',
    supplier: String(row.supplier ?? ''), buyer: String(row.buyer ?? ''), invoiceNo: String(row.invoice_no ?? ''),
    buyerRef: parseDetails(row.details_json)?.buyerRef ?? null,
    face: Number(row.face), currency: String(row.currency ?? ''),
    isTest: row.is_test === true || row.is_test === 1 || String(row.is_test) === 'true',
  };
}

export async function createReceivable(
  tenantId: string,
  input: ReceivableInput,
): Promise<CreateReceivableResult> {
  await ensureReceivablesTables();
  const fields = clampReceivableInput(input);
  const {
    supplier, buyer, invoiceNo, currency, face, terms, dueDate, acknowledgedAt, rtype, paymentMethod, details, isTest,
  } = fields;

  if (!supplier || !buyer || !invoiceNo) {
    return { ok: false, error: 'invalid', message: 'Supplier, buyer, and invoice number are required.' };
  }
  if (!Number.isFinite(face) || face <= 0) {
    return { ok: false, error: 'invalid', message: 'Face value must be a positive number.' };
  }

  const receivable: Record<string, unknown> =
    { supplier, buyer, invoiceNo, face, currency, terms, dueDate, acknowledgedAt, rtype, paymentMethod };
  if (details) receivable.details = details;
  // In the manifest, so the ID differs from the same deal recorded for real and the flag
  // is covered by the signature. A test record cannot be laundered into a real one.
  if (isTest) receivable.isTest = true;
  const manifest = { v: 1, kind: 'receivable', receivable };
  const { signature, digest } = sign(manifest);
  const id = sha256hex(canonicalManifestBytes(manifest));

  // Deterministic ID -> a re-create of the identical receivable, by the SAME tenant, is
  // idempotent. Without this check, a DIFFERENT tenant submitting byte-identical fields
  // would silently succeed against the first tenant's row instead: the INSERT is skipped
  // (the id already exists), but the caller was told ok:true as if they had created it,
  // while every later owner-gated action against "their" receivable would then fail.
  //
  // Soft delete (S2): a withdrawn row is never removed, so this collision is permanent. Another
  // tenant gets id_collision whether or not the original was withdrawn. That is intentional:
  // before S2 a hard delete let a second tenant re-create the identical record and shadow the
  // first one's evidence (its claims and statements). The same tenant re-recording a record it
  // withdrew brings it back (restored: true); its revoked requests and purged files stay closed.
  //
  // Duplicate check (S3): the fingerprints are computed from these fields and stored with the row
  // (NULL without a key, and not at all until the fingerprint columns are confirmed). The manifest
  // and the ID never change for them.
  const fpInput = fingerprintInputOf(fields);
  const withDeleted = deletedAtReady;
  const withFp = fingerprintColumnsReady;
  const existing = await db.execute({
    sql: `SELECT id, tenant_id${withDeleted ? ', deleted_at' : ''}${withFp ? ', fingerprint_kid' : ''} FROM receivables WHERE id = ? LIMIT 1`,
    args: [id],
  });
  let restored = false;
  if (existing.rows.length) {
    const row = existing.rows[0] as any;
    const existingTenant = String(row.tenant_id);
    if (existingTenant !== tenantId) {
      // The submitted details' duplicate check, that record included (excludeId null): the second
      // filer learns whether it is recorded as financed, never whose it is.
      const dup = await duplicateCheckFor(fpInput, null, tenantId);
      return {
        ok: false, error: 'id_collision', message: ID_COLLISION_MESSAGE,
        duplicateCheck: dup.check, ...(dup.ownMatches.length ? { ownMatches: dup.ownMatches } : {}),
      };
    }
    if (withDeleted && row.deleted_at != null) {
      const back = await db.execute({
        sql: `UPDATE receivables SET deleted_at = NULL, updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL`,
        args: [nowUtc(), id, tenantId],
      });
      restored = back.rowsAffected > 0;
    }
    // A repeat or a restore of a row fingerprinted under an older key (or never): store the current
    // fingerprints now rather than waiting for the backfill.
    if (withFp) await refreshFingerprints(id, tenantId, fpInput, row.fingerprint_kid);
  } else {
    const fp = withFp ? computeFingerprints(fpInput) : null;
    await db.execute({
      sql: `INSERT INTO receivables
              (id, tenant_id, supplier, buyer, invoice_no, face, currency, terms, due_date, acknowledged_at, rtype, payment_method, details_json, is_test, manifest_json, signature_json, digest${withFp ? ', fingerprint_ref, fingerprint_inv, fingerprint_kid' : ''})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${withFp ? ', ?, ?, ?' : ''})`,
      args: [
        id, tenantId, supplier, buyer, invoiceNo, face, currency, terms, dueDate, acknowledgedAt, rtype, paymentMethod,
        details ? JSON.stringify(details) : null, isTest,
        JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest,
        ...(withFp ? [fp?.ref ?? null, fp?.inv ?? null, fp?.kid ?? null] : []),
      ],
    });
  }
  await touchReceivable(id);
  // The creator has, by definition, seen the record they just made, so it does not show
  // as an unseen update to them; only later events (a debtor confirming, a competing
  // claim) will.
  await markReceivableSeen(tenantId, id);
  const dup = await duplicateCheckFor(fpInput, id, tenantId);
  const created = { ok: true as const, id, digest, signed: !!signature, keyId: signature ? signature.keyId : getSigningKeyId() };
  return {
    ...created,
    ...(restored ? { restored: true as const } : {}),
    duplicateCheck: dup.check,
    ...(dup.ownMatches.length ? { ownMatches: dup.ownMatches } : {}),
  };
}

/** The fields a duplicate precheck takes: what the create form has typed so far. */
export interface PrecheckFields {
  supplier?: string | null;
  buyer: string;
  invoiceNo?: string | null;
  face: number;
  currency: string;
  details?: { buyerRef?: string | null } | null;
  isTest?: boolean;
}

export type PreviewDuplicateResult =
  | { ok: true; duplicateCheck: DuplicateCheck; ownMatches: OwnMatch[] }
  | { ok: false; error: 'invalid'; message: string };

/**
 * The duplicate check for a receivable that is still being typed in (Addendum A): the same chain
 * as createReceivable (create clamps, fingerprints, twins, summary), with no record excluded, so
 * the answer for a set of fields is the one their create would return (a record with these exact
 * details is listed too, where its own create would leave itself out). Writes nothing: no row, no
 * fingerprint, nothing logged about the fields. Needs a debtor, a positive face, a currency, and an
 * invoice number or a debtor reference; answers unavailable under the same fail-closed rule.
 */
export async function previewDuplicateCheck(fields: PrecheckFields, viewerTenantId: string): Promise<PreviewDuplicateResult> {
  const clamped = clampReceivableInput({
    supplier: String(fields.supplier ?? ''), buyer: String(fields.buyer ?? ''), invoiceNo: String(fields.invoiceNo ?? ''),
    face: Number(fields.face), currency: String(fields.currency ?? ''),
    details: fields.details?.buyerRef != null ? { buyerRef: String(fields.details.buyerRef) } : null,
    isTest: fields.isTest === true,
  });
  if (!clamped.buyer || !String(fields.currency ?? '').trim() || !(clamped.invoiceNo || clamped.details?.buyerRef)) {
    return { ok: false, error: 'invalid', message: 'A debtor, a currency, and an invoice number or a debtor reference are required.' };
  }
  if (!Number.isFinite(clamped.face) || clamped.face <= 0) {
    return { ok: false, error: 'invalid', message: 'Face value must be a positive number.' };
  }
  await ensureReceivablesTables();
  const dup = await duplicateCheckFor(fingerprintInputOf(clamped), null, viewerTenantId);
  return { ok: true, duplicateCheck: dup.check, ownMatches: dup.ownMatches };
}

interface ReceivableRow {
  id: string; tenant_id: string; supplier: string; buyer: string; invoice_no: string;
  face: number; currency: string; terms: string | null;
  due_date: string | null; acknowledged_at: string | null;
  rtype: string | null; payment_method: string | null; details_json: string | null; is_test: boolean;
  signature_json: string | null; anchor_json: string | null; settled_at: string | null; created_at: string;
  /** When the owner withdrew it (S2), or null. Always null until deleted_at is confirmed. */
  deleted_at: string | null;
}

/**
 * One receivable by ID, for every reader and writer in this file (the S2 soft-delete rules, in
 * the plan's reader and writer table). By default a withdrawn record reads as missing, so a writer
 * that forgets to handle it fails closed; writers then call withdrawnError() to answer 410 rather
 * than 404. includeDeleted is for the readers that must still see it: the public status (another
 * party's evidence stays answerable), a party discharging its own claim, a client answering a
 * receipt link on an existing claim (readCountersignRequest, affirmClaimByToken), and labels.
 *
 * Until deleted_at is confirmed in this process (deletedAtReady), the column is neither read nor
 * filtered on, and every record reads as live, exactly as before S2.
 *
 * The duplicate check (S3) reads withdrawn rows on its own: the twin query, ENCUMBRANCE_SQL and the
 * book's possibleDuplicate never filter deleted_at. Slices not built yet follow the same table:
 * recordTokenization (S7) and a publication request (S9) take the default and answer withdrawn;
 * endTokenization and tokenize-dispute (S7) take includeDeleted; the C2 store (S5) reads withdrawn rows.
 */
async function getReceivableRow(id: string, opts: { includeDeleted?: boolean } = {}): Promise<ReceivableRow | null> {
  const withDeleted = deletedAtReady;
  const r = await db.execute({
    sql: `SELECT id, tenant_id, supplier, buyer, invoice_no, face, currency, terms, due_date,
                 acknowledged_at, rtype, payment_method, details_json, is_test, signature_json, anchor_json, settled_at, created_at${withDeleted ? ', deleted_at' : ''}
          FROM receivables WHERE id = ?${withDeleted && !opts.includeDeleted ? ' AND deleted_at IS NULL' : ''} LIMIT 1`,
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
    is_test: row.is_test === true || row.is_test === 1 || String(row.is_test) === 'true',
    rtype: row.rtype != null ? String(row.rtype) : null,
    payment_method: row.payment_method != null ? String(row.payment_method) : null,
    signature_json: row.signature_json != null ? String(row.signature_json) : null,
    anchor_json: row.anchor_json != null ? String(row.anchor_json) : null,
    settled_at: row.settled_at != null ? String(row.settled_at) : null,
    created_at: String(row.created_at),
    deleted_at: withDeleted && row.deleted_at != null ? String(row.deleted_at) : null,
  };
}

/** The 410 answer for a write on a record withdrawn at `withdrawnAt`. */
function withdrawnResult(withdrawnAt: string): WithdrawnError {
  return { ok: false, error: 'withdrawn', message: withdrawnWriteMessage(withdrawnAt), withdrawnAt };
}

/**
 * Called by a writer once getReceivableRow (or an owner check) found nothing: is that because the
 * record was withdrawn? Returns the 410 answer, or null when there is no such record at all (the
 * caller answers its own not_found). With `ownerTenantId`, only that tenant's withdrawn record
 * counts, so an owner-only write by anyone else keeps its plain not_found. Null until deleted_at
 * is confirmed in this process.
 */
async function withdrawnError(receivableId: string, ownerTenantId?: string): Promise<WithdrawnError | null> {
  if (!deletedAtReady) return null;
  const r = await db.execute(ownerTenantId === undefined
    ? { sql: `SELECT deleted_at FROM receivables WHERE id = ? LIMIT 1`, args: [receivableId] }
    : { sql: `SELECT deleted_at FROM receivables WHERE id = ? AND tenant_id = ? LIMIT 1`, args: [receivableId, ownerTenantId] });
  const at = (r.rows[0] as any)?.deleted_at;
  return at != null ? withdrawnResult(String(at)) : null;
}

/** For the token readers, whose callers map error codes: 'withdrawn' (410) or 'not_found'. */
async function missingCode(receivableId: string): Promise<'withdrawn' | 'not_found'> {
  return (await withdrawnError(receivableId)) ? 'withdrawn' : 'not_found';
}

/** Sum of active claims against a receivable. */
async function sumActiveClaims(receivableId: string): Promise<number> {
  const r = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) AS s FROM receivable_claims WHERE receivable_id = ? AND status = 'active'`,
    args: [receivableId],
  });
  return Number((r.rows[0] as any)?.s ?? 0);
}

// ── Duplicate check (S3) ─────────────────────────────────────────────────────
//
// A second lender is warned when the receivable it is about to finance matches another record at
// Almstins: same debtor, the debtor's own reference, amount and currency, or same debtor, supplier,
// invoice number, amount and currency, after normalization (src/lib/receivables/fingerprintNormalize.ts).
// The match runs on keyed hashes stored with each row (server/fingerprint.ts), never on plaintext.
//
// Fail closed: the answer is "unavailable" (never a clear) without the key, until the fingerprint
// columns are confirmed in this process, while any row still carries no fingerprint or one made
// under another key (the backfill below fixes those), and on any store error. A record's own
// fingerprints are always recomputed from its row, never read from its stored hashes.
//
// Withdrawn records (S2) are matched and counted like live ones: withdrawing a financed record and
// recording it again must still warn.
//
// The reads that decide the answer (the coverage count, the twin query and the book's match
// flags) are cross-tenant by design, so they run outside the request's tenant context
// (runWithoutDbContext), on the owner pool, the trusted path for system reads. In a request they
// would take the web pool when WEB_DATABASE_URL is set, which is correct only while receivables has
// no row-level security policy; if one were ever added, those reads would see only the viewer's
// rows and another tenant's financed record would read as no match: a clear. What they return
// stays in this module: hashes, booleans, and the tenant only to pick out the viewer's own matches.

/** True when an active claim stands against receivables row `r`. The outer query must alias the
 *  receivables table as r. Evaluated on withdrawn rows too (no deleted_at filter, on purpose). */
export const ENCUMBRANCE_SQL = `EXISTS (SELECT 1 FROM receivable_claims c WHERE c.receivable_id = r.id AND c.status = 'active')`;

/** At most this many matching rows are read per check. Rows with an active claim come first, so
 *  matches that are not financed can never push a financed one out of the window. */
const TWIN_LIMIT = 50;
/** How long a count of rows still needing fingerprints is trusted. */
const COVERAGE_TTL_MS = 60_000;
let staleCount: { kid: string; n: number; at: number } | null = null;

const truthy = (v: unknown): boolean => v === true || v === 1 || String(v) === 'true';

/** Whether every receivables row carries fingerprints under `kid`: the columns are confirmed in this
 *  process and a count (cached for a minute) finds no row without them or under another kid. */
async function coverageOk(kid: string): Promise<boolean> {
  if (!fingerprintColumnsReady) return false;
  const now = Date.now();
  if (!staleCount || staleCount.kid !== kid || now - staleCount.at >= COVERAGE_TTL_MS) {
    // Every tenant's rows, on the owner pool (see above): a count taken under one tenant's context
    // could read 0 and be cached for every caller.
    const r = await runWithoutDbContext(() => db.execute({
      sql: `SELECT COUNT(*) AS n FROM receivables WHERE fingerprint_kid IS NULL OR fingerprint_kid <> ?`,
      args: [kid],
    }));
    staleCount = { kid, n: Number((r.rows[0] as any)?.n ?? 0), at: now };
  }
  return staleCount.n === 0;
}

/** Whether the duplicate check can answer right now: the key parses, the fingerprint columns are
 *  confirmed, and no row is waiting for the backfill. False on any error. */
export async function fingerprintCoverageOk(): Promise<boolean> {
  const kid = fingerprintKid();
  if (!kid) return false;
  try {
    await ensureReceivablesTables();
    return await coverageOk(kid);
  } catch {
    return false;
  }
}

/** The rows whose fingerprints match `fp` under its kid, test with test and real with real. Never
 *  runs without a key to compare: with neither fingerprint there is no query (and no match). */
async function findFingerprintTwins(fp: Fingerprints, isTest: boolean, excludeId: string | null): Promise<TwinRow[]> {
  const branches: string[] = [];
  const branchArgs: string[] = [];
  if (fp.ref) { branches.push('r.fingerprint_ref = ?'); branchArgs.push(fp.ref); }
  if (fp.inv) { branches.push('r.fingerprint_inv = ?'); branchArgs.push(fp.inv); }
  if (!branches.length) return [];
  const withDeleted = deletedAtReady;
  // Every tenant's rows, on the owner pool (see above).
  const r = await runWithoutDbContext(() => db.execute({
    sql: `SELECT r.id, r.tenant_id, r.invoice_no, r.fingerprint_ref, r.fingerprint_inv, r.settled_at${withDeleted ? ', r.deleted_at' : ''},
                 (${ENCUMBRANCE_SQL}) AS encumbered
          FROM receivables r
          WHERE r.fingerprint_kid = ? AND r.is_test = ?${excludeId !== null ? ' AND r.id <> ?' : ''} AND (${branches.join(' OR ')})
          ORDER BY (${ENCUMBRANCE_SQL}) DESC, r.settled_at DESC NULLS LAST, r.id
          LIMIT ${TWIN_LIMIT}`,
    args: [fp.kid, isTest, ...(excludeId !== null ? [excludeId] : []), ...branchArgs],
  }));
  return (r.rows as any[]).map((row) => ({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    invoiceNo: String(row.invoice_no),
    // Which key matched is read here, by comparing strings, so the select list takes no parameters.
    matchedRef: fp.ref !== null && row.fingerprint_ref === fp.ref,
    matchedInv: fp.inv !== null && row.fingerprint_inv === fp.inv,
    encumbered: truthy(row.encumbered),
    settled: row.settled_at != null,
    withdrawn: withDeleted && row.deleted_at != null,
  }));
}

interface DuplicateResult {
  check: DuplicateCheck;
  /** The viewer's own matching records (only when a viewer is given). */
  ownMatches: OwnMatch[];
  /** Every matching record's ID. Internal only: it never leaves this module. */
  twinIds: string[];
}

/** The duplicate check for a record's fingerprint fields, leaving out `excludeId` (the record
 *  itself; null for a precheck or an id_collision, where nothing is excluded). */
async function duplicateCheckFor(input: FingerprintInput, excludeId: string | null, viewerTenantId?: string | null): Promise<DuplicateResult> {
  const hasDebtorReference = fingerprintTuples(input).ref !== null;
  const unavailable: DuplicateResult = { check: unavailableCheck(hasDebtorReference), ownMatches: [], twinIds: [] };
  if (!fingerprintColumnsReady) return unavailable;
  const fp = computeFingerprints(input);
  if (!fp || (!fp.ref && !fp.inv)) return unavailable;
  try {
    if (!(await coverageOk(fp.kid))) return unavailable;
    const twins = await findFingerprintTwins(fp, input.isTest, excludeId);
    const { check, ownMatches } = summarizeTwins(twins, { viewerTenantId, hasDebtorReference });
    return { check, ownMatches, twinIds: twins.map((t) => t.id) };
  } catch (e) {
    console.error('[receivables] duplicate check unavailable:', e instanceof Error ? e.message : 'unknown error');
    return unavailable;
  }
}

/** A stored row's duplicate check, from its own fields, itself left out. */
function duplicateCheckForRow(row: ReceivableRow, viewerTenantId?: string | null): Promise<DuplicateResult> {
  return duplicateCheckFor(fingerprintInputFromRow(row), row.id, viewerTenantId);
}

/** Store the current fingerprints on a row whose kid is not the current one. Non-fatal: the
 *  backfill catches anything this misses. */
async function refreshFingerprints(id: string, tenantId: string, input: FingerprintInput, storedKid: unknown): Promise<void> {
  const fp = computeFingerprints(input);
  if (!fp || storedKid === fp.kid) return;
  try {
    await db.execute({
      sql: `UPDATE receivables SET fingerprint_ref = ?, fingerprint_inv = ?, fingerprint_kid = ?
            WHERE id = ? AND tenant_id = ? AND (fingerprint_kid IS NULL OR fingerprint_kid <> ?)`,
      args: [fp.ref, fp.inv, fp.kid, id, tenantId, fp.kid],
    });
  } catch { /* non-fatal */ }
}

// ── Fingerprint backfill ────────────────────────────────────────────────────
//
// Fills the fingerprints of every row that has none or has them under another kid (rows recorded
// before S3, by an older build during a deploy, or before a key rotation). A fingerprint is a
// derived index, not data, so this runs in-process (owner decision 4) rather than as a hand-run
// script. Started only by explicit triggers (src/lib/receivables/server/fingerprintBackfill.ts:
// the anchor cron, and the create, precheck and lookup routes), never by importing this module.
//
// Safe on the live table: a keyset cursor reads 200 rows at a time, and each row is one UPDATE that
// commits on its own and locks only that row. No batch transaction, no table lock, and updated_at is
// left alone, so no book lights up with unseen updates. Idempotent (the kid condition). Withdrawn
// rows are included. A row that fails is skipped and the cursor moves past it, so a run always ends.
// It runs outside any request's tenant context (runWithoutDbContext), on the owner pool, the trusted
// path for system jobs. Logs counts only: never a key, kid, ID or field.

const BACKFILL_BATCH = 200;
export type FingerprintBackfillState = 'complete' | 'partial' | 'off' | 'failed';
export interface FingerprintBackfillResult { state: FingerprintBackfillState; updated: number; skipped: number; ms: number }

let backfillPromise: Promise<FingerprintBackfillResult> | null = null;
let backfillCompleteLogged = false;

/** Run the backfill, or join the run already going. Without a key it does nothing, before any SQL. */
export function startFingerprintBackfill(): Promise<FingerprintBackfillResult> {
  if (!backfillPromise) {
    const run = runWithoutDbContext(() => runFingerprintBackfill());
    backfillPromise = run;
    const clear = () => { if (backfillPromise === run) backfillPromise = null; };
    run.then(clear, clear);
  }
  return backfillPromise;
}

/** Whether a backfill run is going in this process. */
export function fingerprintBackfillRunning(): boolean {
  return backfillPromise !== null;
}

async function runFingerprintBackfill(): Promise<FingerprintBackfillResult> {
  const started = Date.now();
  const kid = fingerprintKid();
  if (!kid) return { state: 'off', updated: 0, skipped: 0, ms: 0 };
  let updated = 0;
  let skipped = 0;
  try {
    await ensureReceivablesTables();
    if (!fingerprintColumnsReady) return { state: 'failed', updated, skipped, ms: Date.now() - started };
    let cursor = '';
    for (;;) {
      const batch = await db.execute({
        sql: `SELECT id, supplier, buyer, invoice_no, face, currency, details_json, is_test FROM receivables
              WHERE (fingerprint_kid IS NULL OR fingerprint_kid <> ?) AND id > ?
              ORDER BY id LIMIT ${BACKFILL_BATCH}`,
        args: [kid, cursor],
      });
      const rows = batch.rows as any[];
      for (const row of rows) {
        cursor = String(row.id);
        const fp = computeFingerprints(fingerprintInputFromRow(row));
        // The key changed under this run: leave the row for the next one.
        if (!fp || fp.kid !== kid) { skipped++; continue; }
        try {
          const w = await db.execute({
            sql: `UPDATE receivables SET fingerprint_ref = ?, fingerprint_inv = ?, fingerprint_kid = ?
                  WHERE id = ? AND (fingerprint_kid IS NULL OR fingerprint_kid <> ?)`,
            args: [fp.ref, fp.inv, fp.kid, cursor, fp.kid],
          });
          if (w.rowsAffected) updated++;
        } catch {
          skipped++;
        }
      }
      if (rows.length < BACKFILL_BATCH) break;
    }
  } catch {
    console.error('[receivables] fingerprint backfill failed:', { updated, skipped, ms: Date.now() - started });
    staleCount = null;
    return { state: 'failed', updated, skipped, ms: Date.now() - started };
  }
  // Recount on the next check instead of trusting a count taken before this run.
  if (updated || skipped) staleCount = null;
  const ms = Date.now() - started;
  const state: FingerprintBackfillState = skipped ? 'partial' : 'complete';
  if (skipped) console.warn('[receivables] fingerprint backfill skipped rows:', { updated, skipped, ms });
  else if (updated || !backfillCompleteLogged) {
    backfillCompleteLogged = true;
    console.log('[receivables] fingerprint backfill complete', { updated, skipped, ms });
  }
  return { state, updated, skipped, ms };
}

export type AddClaimResult =
  /** notices: informational, present only when non-empty (see acknowledgments.ts NOTICE_CODES). A
   *  caller that does not send acceptsWarnings keeps getting a 200 for a claim the warning is
   *  raised on (a financed match for a verified account, any match for any other), with
   *  possible_duplicate here instead of a 409. */
  | { ok: true; claimId: string; digest: string; signed: boolean; claimed: number; available: number; face: number; notices?: NoticeCode[] }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: 'invalid'; message: string }
  | { ok: false; error: 'exceeds_headroom'; message: string; available: number; claimed: number; face: number }
  | { ok: false; error: 'diligence_required'; message: string }
  /** Only for a caller that sent acceptsWarnings: true. The full duplicateCheck for a verified
   *  account, { state } alone for any other (owner decision 9). */
  | { ok: false; error: 'possible_duplicate'; message: string; warnings: ['possible_duplicate']; duplicateCheck: DuplicateCheck | { state: DuplicateState } }
  | { ok: false; error: 'unknown_acknowledgment'; message: string; unknown: string[] }
  | WithdrawnError;

async function hasBuyerAttestation(receivableId: string): Promise<boolean> {
  const r = await db.execute({
    sql: `SELECT 1 FROM receivable_attestations WHERE receivable_id = ? AND role = 'buyer' LIMIT 1`,
    args: [receivableId],
  });
  return r.rows.length > 0;
}

/** A diligence acceptance is filed under role 'other' with a DILIGENCE prefix (see
 * acceptDiligence) -- scoped to the claiming tenant, since each financier accepts this
 * responsibility for themselves, not on another financier's behalf.
 *
 * Source first: a row whose recorded source is 'diligence' counts, and any other recorded
 * source does not, whatever its text says. Only a legacy row (source NULL, written before the
 * column existed) falls back to the prefix. Until the source column is confirmed in this
 * process, the prefix alone decides, as it did before. */
async function hasDiligenceAcceptance(receivableId: string, tenantId: string): Promise<boolean> {
  const r = columnsEnsured
    ? await db.execute({
        sql: `SELECT 1 FROM receivable_attestations
               WHERE receivable_id = ? AND tenant_id = ?
                 AND (source = ? OR (source IS NULL AND statement LIKE ?))
               LIMIT 1`,
        args: [receivableId, tenantId, 'diligence' satisfies AttestationSource, 'DILIGENCE —%'],
      })
    : await db.execute({
        sql: `SELECT 1 FROM receivable_attestations WHERE receivable_id = ? AND tenant_id = ? AND statement LIKE 'DILIGENCE —%' LIMIT 1`,
        args: [receivableId, tenantId],
      });
  return r.rows.length > 0;
}

/**
 * Register a financing claim against a receivable. A claim over the unencumbered headroom
 * answers exceeds_headroom with the available figure, so the caller can warn; force:true (or
 * acknowledge: ['exceeds_headroom']) records it anyway and signs acknowledged: ['exceeds_headroom']
 * into the claim (see src/lib/receivables/acknowledgments.ts).
 *
 * Duplicate check (S3), after the diligence and headroom checks: when the receivable matches
 * another record that is recorded as financed, a caller that sent acceptsWarnings: true gets
 * possible_duplicate (409 at the route) until it resubmits with acknowledge: ['possible_duplicate'],
 * which is then signed into the claim. Any other caller's claim is recorded as before, and its
 * answer carries notices: ['possible_duplicate']. When the check cannot run, the claim is recorded
 * and the answer carries notices: ['duplicate_check_unavailable']; that is never a 409. A recorded
 * claim bumps the matching records' last-activity clocks, so an earlier financier's book shows it.
 * The check and the insert can race, the same as the headroom check (documented gap).
 *
 * Tiered by opts.verifiedViewer (from the route's session, owner decision 9): a verified account
 * gets the warning only for a financed match, with the full duplicateCheck on the 409. Any other
 * account gets it for any match, with { state } only, so neither the 409, the notice nor its
 * absence tells that account whether the match is financed.
 *
 * Signed with the Almstins key; the returned digest can be Bitcoin-anchored via
 * /api/verify/anchor. tenant_id is private provenance, never surfaced.
 */
export async function addClaim(
  tenantId: string,
  receivableId: string,
  input: {
    financier: string; amount: number; currency?: string; date?: string; force?: boolean;
    acceptsWarnings?: boolean; acknowledge?: unknown[];
  },
  opts: { verifiedViewer?: boolean } = {},
): Promise<AddClaimResult> {
  await ensureReceivablesTables();
  const rid = String(receivableId || '').trim();
  const rcv = await getReceivableRow(rid);
  if (!rcv) return (await withdrawnError(rid)) ?? { ok: false, error: 'not_found', message: 'No receivable found for that ID.' };

  const financier = clampStr(input.financier, 120);
  const amount = Number(input.amount);
  const currency = clampStr(input.currency || rcv.currency, 8).toUpperCase() || rcv.currency;
  const date = isYmd(input.date) ? input.date! : nowUtc().slice(0, 10);
  if (!financier) return { ok: false, error: 'invalid', message: 'A financier name is required.' };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'invalid', message: 'Claim amount must be a positive number.' };
  }
  const requested: unknown[] = Array.isArray(input.acknowledge) ? input.acknowledge : [];
  const unknownCodes = resolveAcknowledged([], requested).unknown;
  if (unknownCodes.length) {
    return { ok: false, error: 'unknown_acknowledgment', message: UNKNOWN_ACKNOWLEDGMENT_MESSAGE, unknown: unknownCodes };
  }
  const headroomAcknowledged = input.force === true || requested.includes('exceeds_headroom');

  // No genuine debtor confirmation on record -- financing this receivable would rest
  // entirely on the supplier's word. Almstins does not verify a debtor's identity itself
  // (that's what the token-gated /verify/authenticate flow is for); it also refuses to let
  // that gap pass silently. Before a claim is allowed through, the claiming financier must
  // accept responsibility for having verified this relationship themselves -- see
  // acceptDiligence(). Skipped for test records, matching the pledge-boundary warning's
  // existing test-mode exemption. One acceptance per (tenant, receivable) covers every
  // later claim by that same financier on the same receivable.
  if (rcv.is_test !== true && !(await hasBuyerAttestation(rcv.id)) && !(await hasDiligenceAcceptance(rcv.id, tenantId))) {
    return {
      ok: false, error: 'diligence_required',
      message: 'No debtor confirmation is on record for this receivable. Accept responsibility for having verified it yourself before financing.',
    };
  }

  // The stored ID, never the caller's string: an ID sent with stray spaces still finds the
  // record above (it is trimmed there), so summing claims by the untrimmed string found none
  // and the headroom check passed against the full face value.
  const claimed = await sumActiveClaims(rcv.id);
  const available = rcv.face - claimed;
  if (amount > available && !headroomAcknowledged) {
    return {
      ok: false, error: 'exceeds_headroom',
      message: `Only ${available} of ${rcv.face} ${rcv.currency} is unencumbered; ${claimed} is already claimed.`,
      available, claimed, face: rcv.face,
    };
  }

  // The duplicate check (S3), recomputed from the record now. Raised for a verified caller only
  // when the match is recorded as financed, for any other caller on any match (see above); a 409
  // only for a caller that accepts warnings.
  const verifiedViewer = opts.verifiedViewer === true;
  const dup = await duplicateCheckForRow(rcv);
  const raised: AckCode[] = [
    ...(amount > available ? ['exceeds_headroom' as const] : []),
    ...(claimRaisesDuplicate(dup.check, verifiedViewer) ? ['possible_duplicate' as const] : []),
  ];
  // force:true is the caller's explicit "I saw the headroom warning and am going ahead". It is
  // signed into the claim, but only when the claim really is over the headroom; a force within
  // headroom acknowledges nothing, so its bytes and digest are the same as an unforced claim.
  // The same holds for every code: only a code that was raised AND acknowledged is signed. The key
  // is omitted when empty, so every claim manifest written before this keeps its digest.
  const { acknowledged, outstanding } = resolveAcknowledged(raised, [
    ...(headroomAcknowledged ? ['exceeds_headroom'] : []),
    ...requested,
  ]);
  const duplicateOutstanding = outstanding.includes('possible_duplicate');
  if (duplicateOutstanding && input.acceptsWarnings === true) {
    return verifiedViewer
      ? { ok: false, error: 'possible_duplicate', message: POSSIBLE_DUPLICATE_MESSAGE, warnings: ['possible_duplicate'], duplicateCheck: dup.check }
      : { ok: false, error: 'possible_duplicate', message: POSSIBLE_MATCH_MESSAGE, warnings: ['possible_duplicate'], duplicateCheck: stateOnly(dup.check) };
  }
  const notices: NoticeCode[] = [
    ...(dup.check.state === 'unavailable' ? ['duplicate_check_unavailable' as const] : []),
    ...(duplicateOutstanding ? ['possible_duplicate' as const] : []),
  ];
  const manifest = withAcknowledged(
    { v: 1, kind: 'financing_claim', receivableId: rcv.id, financier, amount, currency, date },
    acknowledged,
  );
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
  await touchReceivable(rcv.id);
  // Decision 19: the matching records' clocks move too, so the financier on an earlier record sees
  // an unseen update in their book. Their IDs never leave this module.
  for (const twinId of dup.twinIds) await touchReceivable(twinId);
  const newClaimed = claimed + amount;
  const result = { ok: true as const, claimId, digest, signed: !!signature, claimed: newClaimed, available: rcv.face - newClaimed, face: rcv.face };
  return notices.length ? { ...result, notices } : result;
}

/**
 * PUBLIC read — the second financier's check. Given a receivable ID, return its status
 * and every claim standing against it. NEVER returns tenant_id or any identity: only the
 * self-chosen financier label, amount, and date (no-attribution boundary). Returns null
 * when the ID is unknown.
 *
 * A record its owner withdrew (S2) is read too. When another tenant has a claim or a statement on
 * it, the answer is the normal status plus the additive withdrawn: true and withdrawnAt (lifecycle
 * unchanged), so that party's evidence stays answerable. Otherwise it answers null, the same
 * found: false a never-recorded ID gets. "Another tenant" is the row's tenant_id: answers that
 * came back through the owner's own request links are stored under the owner, so they do not
 * count here. (S7 adds another tenant's tokenizations to this check.)
 *
 * Its duplicateCheck is the public one (publicDuplicateCheck): the state and hasDebtorReference.
 */
export async function getReceivableStatus(receivableId: string): Promise<ReceivableStatus | null> {
  return (await readReceivableStatus(receivableId))?.status ?? null;
}

/** The public status, plus the full duplicate check for this module's own tiered answers (Verify
 *  now gives a verified account the basis and the financed wording). The full check never leaves
 *  this module except through such a tiered answer. */
async function readReceivableStatus(receivableId: string): Promise<{ status: ReceivableStatus; duplicate: DuplicateCheck } | null> {
  await ensureReceivablesTables();
  const rcv = await getReceivableRow(String(receivableId || '').trim(), { includeDeleted: true });
  if (!rcv) return null;
  if (rcv.deleted_at != null && !(await hasOtherPartyEvidence(rcv.id, rcv.tenant_id))) return null;

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

  // source is read only once its column is confirmed; without it every row classifies the
  // legacy way (by prefix, never as consent), which can only under-state a row, never forge one.
  const withSource = columnsEnsured;
  const ar = await db.execute({
    sql: `SELECT id, role, label, statement, attested_at, ${withSource ? 'source, ' : ''}signature_json, anchor_json
          FROM receivable_attestations WHERE receivable_id = ? ORDER BY created_at ASC`,
    args: [rcv.id],
  });
  const attestations: PublicAttestation[] = (ar.rows as any[]).map((r) => {
    const role = (['buyer', 'supplier', 'inspector'].includes(String(r.role)) ? String(r.role) : 'other') as AttesterRole;
    const statement = String(r.statement);
    return {
      id: String(r.id),
      role,
      label: String(r.label),
      statement,
      date: String(r.attested_at),
      class: classifyAttestation(role, statement, withSource ? r.source : null),
      signed: !!r.signature_json,
      anchored: !!r.anchor_json,
      anchoredAt: anchoredAtOf(r.anchor_json),
    };
  });

  const rr = await db.execute({
    sql: `SELECT id, verdict, checks_json, created_at, signature_json, anchor_json
          FROM receivable_reverifications WHERE receivable_id = ? ORDER BY created_at ASC`,
    args: [rcv.id],
  });
  const reverifications: PublicReverification[] = (rr.rows as any[]).map((r) => ({
    id: String(r.id),
    verdict: (String(r.verdict) === 'confirmed' ? 'confirmed' : 'attention') as 'confirmed' | 'attention',
    checks: JSON.parse(String(r.checks_json)) as ReverifyCheck[],
    date: String(r.created_at),
    signed: !!r.signature_json,
    anchored: !!r.anchor_json,
    anchoredAt: anchoredAtOf(r.anchor_json),
  }));

  const dr = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM receivable_documents WHERE receivable_id = ? AND data IS NOT NULL`,
    args: [rcv.id],
  });
  const docCount = Number((dr.rows[0] as any)?.n ?? 0);

  const qr = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM receivable_invites WHERE receivable_id = ? AND revoked_at IS NULL`,
    args: [rcv.id],
  });
  const reqCount = Number((qr.rows[0] as any)?.n ?? 0);

  const claimed = claimedOf(claims);
  const available = rcv.face - claimed;
  const financing = financingStatusOf(claimed, rcv.face);
  const settled = !!rcv.settled_at;
  const lifecycle = lifecycleOf({ settled, claimed, hadClaims: claims.length > 0 });
  // No viewer, so no own matches. The status carries only the public part.
  const { check: duplicate } = await duplicateCheckForRow(rcv);

  const status: ReceivableStatus = {
    id: rcv.id,
    supplier: rcv.supplier, buyer: rcv.buyer, invoiceNo: rcv.invoice_no,
    face: rcv.face, currency: rcv.currency, terms: rcv.terms,
    dueDate: rcv.due_date, acknowledgedAt: rcv.acknowledged_at,
    rtype: rcv.rtype, paymentMethod: rcv.payment_method,
    details: parseDetails(rcv.details_json),
    documentCount: docCount,
    requestCount: reqCount,
    isTest: rcv.is_test === true,
    createdAt: rcv.created_at, signed: !!rcv.signature_json,
    anchored: !!rcv.anchor_json, anchoredAt: anchoredAtOf(rcv.anchor_json),
    settled, settledAt: rcv.settled_at,
    attestations,
    reverifications,
    claims, claimed, available, status: financing, lifecycle,
    duplicateCheck: publicDuplicateCheck(duplicate),
    ...(rcv.deleted_at != null ? { withdrawn: true as const, withdrawnAt: rcv.deleted_at } : {}),
  };
  return { status, duplicate };
}

/** Does any tenant other than the owner have a claim (active or discharged) or a statement on
 *  this receivable? Read only for a withdrawn record. */
async function hasOtherPartyEvidence(receivableId: string, ownerTenantId: string): Promise<boolean> {
  const claims = await db.execute({
    sql: `SELECT 1 FROM receivable_claims WHERE receivable_id = ? AND tenant_id <> ? LIMIT 1`,
    args: [receivableId, ownerTenantId],
  });
  if (claims.rows.length) return true;
  const statements = await db.execute({
    sql: `SELECT 1 FROM receivable_attestations WHERE receivable_id = ? AND tenant_id <> ? LIMIT 1`,
    args: [receivableId, ownerTenantId],
  });
  return statements.rows.length > 0;
}

// ── "Verify now" — re-check a receivable's proof on demand, and fail closed ────
//
// A signature proves what was true when it was signed. It cannot promise the fact stayed true
// between the advance and settlement — the debtor's acknowledgment, the headroom, the funds
// affirmation can each change while a claim is still outstanding. So a party about to rely on a
// receivable re-runs the load-bearing checks AT THE MOMENT THEY ACT, and the answer fails
// closed: anything that cannot be re-confirmed drops the verdict to 'attention' rather than
// silently passing. Each run is recorded as a dated, signed re-verification — the evidence that
// the control ran and what it found. Reads across tenants are safe (holding the ID makes you a
// party, exactly like registering a claim); the row records WHO checked, scoped by their tenant.

export type ReverifyState = 'pass' | 'warn' | 'fail';
export interface ReverifyCheck { key: string; label: string; state: ReverifyState; detail: string; }
export type ReverifyResult =
  | {
      ok: true;
      verdict: 'confirmed' | 'attention';
      checks: ReverifyCheck[];
      at: string;
      digest: string;
      signed: boolean;
      reverificationId: string | null;
      receivable: {
        id: string; supplier: string; buyer: string; invoiceNo: string;
        face: number; currency: string; claimed: number; available: number;
        status: ReceivableStatus['status']; lifecycle: ReceivableStatus['lifecycle'];
      };
    }
  | { ok: false; error: 'not_found'; message: string }
  | WithdrawnError;

/**
 * Verify now's duplicate row (S3). Pass only when a debtor reference is recorded (the strong key
 * could be compared) and nothing matches; a match, a record with no debtor reference, and a check
 * that cannot run are each a caution, never a fail: Almstins cannot tell a duplicate from an
 * installment, and the person decides. `detailed` (a verified account, owner decision 9) adds
 * whether the match is recorded as financed and when it matched on the debtor's reference alone;
 * otherwise a match reads only as a match.
 */
function duplicateReverifyCheck(dup: DuplicateCheck, detailed: boolean): ReverifyCheck {
  const row = (state: ReverifyState, detail: string): ReverifyCheck => ({ key: 'duplicate', label: DUPLICATE_CHECK_LABEL, state, detail });
  if (dup.state === 'unavailable') return row('warn', DUPLICATE_DETAIL_UNAVAILABLE);
  if (dup.state === 'possible_duplicate') {
    if (!detailed) return row('warn', DUPLICATE_DETAIL_ANY_MATCH);
    const lead = dup.encumbered ? DUPLICATE_DETAIL_FINANCED : DUPLICATE_DETAIL_MATCH;
    return row('warn', dup.basis === 'debtor_reference_only' ? `${lead} ${DUPLICATE_DETAIL_REFERENCE_ONLY}` : lead);
  }
  if (!dup.hasDebtorReference) return row('warn', DUPLICATE_DETAIL_NO_REFERENCE);
  return row('pass', DUPLICATE_DETAIL_PASS);
}

/**
 * Verify now. `verifiedViewer` comes from the route (the caller's session, never the body) and only
 * changes the wording of the duplicate row; every check's state, the verdict and the signed receipt
 * are the same for every caller. The stored re-verification always keeps the plain wording, because
 * the public status lists past re-verifications to anyone holding the ID.
 */
export async function reverifyReceivable(
  tenantId: string,
  receivableId: string,
  opts: { persist?: boolean; verifiedViewer?: boolean } = {},
): Promise<ReverifyResult> {
  await ensureReceivablesTables();
  const id = String(receivableId || '').trim();
  // The status reads withdrawn records (for the public check), but a re-verification is a new
  // signed record, so a withdrawn one answers 410 like every other new write (S2).
  const read = await readReceivableStatus(id);
  const status = read?.status ?? null;
  if (status?.withdrawn) return withdrawnResult(String(status.withdrawnAt));
  if (!read || !status) return (await withdrawnError(id)) ?? { ok: false, error: 'not_found', message: 'No receivable found for that ID.' };

  // Group digits so a detail line reads like the rest of the page (50,000,000 not 50000000).
  const fmtAmt = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 8 });
  const checks: ReverifyCheck[] = [];

  // 1. Integrity — the record has not been altered since it was signed. Load-bearing:
  //    recompute the canonical bytes from the stored manifest, verify the Ed25519 signature,
  //    confirm the digest matches AND the signer is a key Almstins publishes: the current key or
  //    a retired one (ALMSTINS_SIGNING_RETIRED_PUBKEYS), so a key rotation does not fail every
  //    record signed before it. Any failure here is a hard fail: an unverifiable record is
  //    treated as suspect, not trusted. When no key is published at all, an intact record is a
  //    caution (warn), never a pass, since the signer cannot be checked.
  try {
    const r = await db.execute({
      sql: `SELECT manifest_json, signature_json, digest FROM receivables WHERE id = ? LIMIT 1`,
      args: [id],
    });
    const row = r.rows[0] as any;
    const sig = row?.signature_json ? JSON.parse(String(row.signature_json)) : null;
    if (!row?.manifest_json || !sig?.signatureHex || !sig?.publicKeyHex) {
      checks.push({ key: 'integrity', label: 'Record integrity', state: 'fail',
        detail: 'The record is not signed, so it cannot be re-verified against a key.' });
    } else {
      const bytes = canonicalManifestBytes(JSON.parse(String(row.manifest_json)));
      const digestOk = sha256hex(bytes) === String(row.digest);
      const sigOk = verifyManifestSignature(bytes, String(sig.signatureHex), String(sig.publicKeyHex));
      const published = getPublishedKeys();
      const signer = String(sig.publicKeyHex).toLowerCase();
      const keyOk = published.some((k) => k.public_key_hex === signer);
      if (sigOk && digestOk && keyOk) {
        checks.push({ key: 'integrity', label: 'Record integrity', state: 'pass',
          detail: 'Signature verifies and the record is unchanged since it was signed.' });
      } else if (sigOk && digestOk && published.length === 0) {
        // No Almstins key is published at all (a misconfigured server), so the signer cannot be
        // checked against one. Not evidence of tampering, but not a pass either: any key can
        // produce a self-consistent signature, so the verdict drops to attention.
        checks.push({ key: 'integrity', label: 'Record integrity', state: 'warn',
          detail: 'The signature verifies and the record is unchanged, but no Almstins signing key is published right now, so the signer cannot be confirmed.' });
      } else {
        checks.push({ key: 'integrity', label: 'Record integrity', state: 'fail',
          detail: !keyOk && published.length > 0 ? 'Signed by a key that is not a published Almstins key.'
            : !digestOk ? 'The stored record no longer matches its signed fingerprint.'
            : 'The signature does not verify.' });
      }
    }
  } catch {
    checks.push({ key: 'integrity', label: 'Record integrity', state: 'fail',
      detail: 'The integrity check could not be completed, so it is treated as unproven.' });
  }

  // 2. Financing headroom — the duplicate-financing check, recomputed NOW. Over-financed is a
  //    hard fail (a double-pledge is already on record); no headroom left is a caution.
  if (status.status === 'over_financed') {
    checks.push({ key: 'headroom', label: 'Financing headroom', state: 'fail',
      detail: `Claims exceed face value — ${fmtAmt(status.claimed)} claimed against ${fmtAmt(status.face)} ${status.currency}.` });
  } else if (status.available <= 0) {
    checks.push({ key: 'headroom', label: 'Financing headroom', state: 'warn',
      detail: 'Fully encumbered — no unclaimed headroom remains.' });
  } else {
    checks.push({ key: 'headroom', label: 'Financing headroom', state: 'pass',
      detail: `${fmtAmt(status.available)} of ${fmtAmt(status.face)} ${status.currency} is still unencumbered.` });
  }

  // 2b. Duplicate check (S3) — does another record at Almstins match this invoice? Recomputed now
  //    from the record's own fields (see duplicateReverifyCheck). The plain row goes into the
  //    stored re-verification; a verified caller's answer carries the detailed one.
  const storedDuplicate = duplicateReverifyCheck(read.duplicate, false);
  const answeredDuplicate = duplicateReverifyCheck(read.duplicate, opts.verifiedViewer === true);
  checks.push(storedDuplicate);

  // 3. Debtor acknowledgment — a buyer attestation is what turns one firm's word into a debt the
  //    obligor owns. Its absence is the caution the pledge-boundary scream is about.
  const acknowledged = (status.attestations || []).some((a) => a.role === 'buyer');
  checks.push(acknowledged
    ? { key: 'acknowledged', label: 'Debtor acknowledgment', state: 'pass',
        detail: 'The buyer has attested to the debt on record.' }
    : { key: 'acknowledged', label: 'Debtor acknowledgment', state: 'warn',
        detail: 'No buyer attestation — any claim rests on the supplier’s word until the obligor confirms.' });

  // 4. Funds affirmation — a claim is an assertion until the supplier confirms the money
  //    arrived. Only meaningful when active claims exist.
  const activeClaims = (status.claims || []).filter((c) => c.status === 'active');
  if (activeClaims.length) {
    const unaffirmed = activeClaims.filter((c) => !c.affirmed).length;
    checks.push(unaffirmed === 0
      ? { key: 'affirmation', label: 'Funds affirmation', state: 'pass',
          detail: 'Every active claim is supplier-confirmed as funded.' }
      : { key: 'affirmation', label: 'Funds affirmation', state: 'warn',
          detail: `${unaffirmed} active claim${unaffirmed === 1 ? '' : 's'} not yet confirmed as funded by the supplier.` });
  }

  // 5. Durability — is the proof stamped into Bitcoin, or only signed? Signed-but-unanchored is
  //    still evidence, just not yet independently time-stamped. A caution, not a fail.
  checks.push(status.anchored && status.anchoredAt
    ? { key: 'anchor', label: 'Bitcoin anchor', state: 'pass',
        detail: `Anchored to Bitcoin on ${String(status.anchoredAt).slice(0, 10)}.` }
    : { key: 'anchor', label: 'Bitcoin anchor', state: 'warn',
        detail: status.anchored ? 'Anchor pending Bitcoin confirmation.' : 'Signed but not yet anchored to Bitcoin.' });

  // Fail-closed verdict: confirmed ONLY if every check passed. Any warn or fail → attention.
  const verdict: 'confirmed' | 'attention' = checks.every((c) => c.state === 'pass') ? 'confirmed' : 'attention';
  const at = nowUtc();

  const manifest = {
    v: 1, kind: 'reverification', receivableId: status.id, at, verdict,
    face: status.face, claimed: status.claimed, available: status.available,
    checks: checks.map((c) => ({ key: c.key, state: c.state })),
  };
  const { signature, digest } = sign(manifest);

  let reverificationId: string | null = null;
  if (opts.persist !== false) {
    reverificationId = randomUUID();
    await db.execute({
      sql: `INSERT INTO receivable_reverifications
              (id, receivable_id, tenant_id, verdict, checks_json, manifest_json, signature_json, digest)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        reverificationId, status.id, tenantId, verdict, JSON.stringify(checks),
        JSON.stringify(manifest), signature ? JSON.stringify(signature) : null, digest,
      ],
    });
  }

  // The answer: the stored checks, with the duplicate row in the caller's own tier. Its state is
  // the same either way, so the verdict and the signed receipt do not depend on the tier.
  const answered = checks.map((c) => (c === storedDuplicate ? answeredDuplicate : c));
  return {
    ok: true, verdict, checks: answered, at, digest, signed: !!signature, reverificationId,
    receivable: {
      id: status.id, supplier: status.supplier, buyer: status.buyer, invoiceNo: status.invoiceNo,
      face: status.face, currency: status.currency, claimed: status.claimed, available: status.available,
      status: status.status, lifecycle: status.lifecycle,
    },
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
 * dated discharge event and keeps the signature and the full recorded-at time beside the
 * manifest; the digest is Bitcoin-anchorable (kind 'claim_discharge'). Idempotent-safe: a
 * claim already discharged returns 'already_discharged' rather than double-signing.
 */
export async function dischargeClaim(tenantId: string, claimId: string, reason?: string): Promise<DischargeClaimResult> {
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

  const recordedAt = nowUtc();
  const dischargedAt = recordedAt.slice(0, 10);
  const cleanReason = clampStr(reason, 300);
  const manifest: Record<string, unknown> = {
    v: 1, kind: 'claim_discharge',
    receivableId: String(claim.receivable_id), claimId: String(claim.id),
    financier: String(claim.financier), amount: Number(claim.amount),
    currency: String(claim.currency), dischargedAt,
  };
  if (cleanReason) manifest.reason = cleanReason;
  const { signature, digest } = sign(manifest);
  // The signature and recorded-at columns come from schema.ts. Until they are confirmed in this
  // process the discharge is written the old way: still signed in memory, just not kept.
  const written = await db.execute(columnsEnsured
    ? {
        sql: `UPDATE receivable_claims
              SET status = 'discharged', discharged_at = ?, discharge_json = ?, discharge_digest = ?, discharge_reason = ?,
                  discharge_signature_json = ?, discharge_recorded_at = ?
              WHERE id = ? AND tenant_id = ? AND status <> 'discharged'`,
        args: [
          dischargedAt, JSON.stringify(manifest), digest, cleanReason || null,
          signature ? JSON.stringify(signature) : null, recordedAt, claim.id, tenantId,
        ],
      }
    : {
        sql: `UPDATE receivable_claims
              SET status = 'discharged', discharged_at = ?, discharge_json = ?, discharge_digest = ?, discharge_reason = ?
              WHERE id = ? AND tenant_id = ? AND status <> 'discharged'`,
        args: [dischargedAt, JSON.stringify(manifest), digest, cleanReason || null, claim.id, tenantId],
      });
  // Another discharge of this claim landed between the read above and this write. Its manifest
  // is the one stored (and stamped), so this call reports the claim as already discharged rather
  // than returning a digest that was never kept.
  if (!written.rowsAffected) {
    return { ok: false, error: 'already_discharged', message: 'That claim is already discharged.' };
  }

  await touchReceivable(String(claim.receivable_id));
  // includeDeleted: a party may still release its own claim on a withdrawn record (S2), and the
  // figures it gets back must be the record's real face value, not a missing one read as 0.
  const rcv = await getReceivableRow(String(claim.receivable_id), { includeDeleted: true });
  const claimed = rcv ? await sumActiveClaims(rcv.id) : 0;
  const face = rcv?.face ?? 0;
  return { ok: true, digest, signed: !!signature, claimed, available: face - claimed, face };
}

export type SettleReceivableResult =
  | { ok: true; digest: string; signed: boolean; settledAt: string }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: 'already_settled'; message: string }
  | WithdrawnError;

/**
 * Mark a receivable settled — the buyer paid, closing the lifecycle. Tenant-scoped to
 * the receivable's CREATOR (the supplier/originator confirms payment arrived). Signs a
 * dated settlement event and keeps the signature and the full recorded-at time beside the
 * manifest; the digest is Bitcoin-anchorable (kind 'settlement'). Does not itself discharge
 * outstanding claims — a financier releases their own claim via dischargeClaim — but records
 * that the obligation is paid.
 */
export async function settleReceivable(tenantId: string, receivableId: string): Promise<SettleReceivableResult> {
  await ensureReceivablesTables();
  const withDeleted = deletedAtReady;
  const r = await db.execute({
    sql: `SELECT id, supplier, buyer, invoice_no, face, currency, settled_at${withDeleted ? ', deleted_at' : ''} FROM receivables
          WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(receivableId || '').trim(), tenantId],
  });
  if (!r.rows.length) return { ok: false, error: 'not_found', message: 'No receivable of yours found for that ID.' };
  const row = r.rows[0] as any;
  // A settlement is a new signed record: on a withdrawn receivable it answers 410 (S2).
  if (withDeleted && row.deleted_at != null) return withdrawnResult(String(row.deleted_at));
  if (row.settled_at != null) return { ok: false, error: 'already_settled', message: 'That receivable is already settled.' };

  const recordedAt = nowUtc();
  const settledAt = recordedAt.slice(0, 10);
  const manifest = {
    v: 1, kind: 'receivable_settlement',
    receivableId: String(row.id), invoiceNo: String(row.invoice_no),
    face: Number(row.face), currency: String(row.currency), settledAt,
  };
  const { signature, digest } = sign(manifest);
  // Same degrade rule as dischargeClaim: without the schema.ts columns the signature is not kept.
  const written = await db.execute(columnsEnsured
    ? {
        sql: `UPDATE receivables
              SET settled_at = ?, settlement_json = ?, settlement_digest = ?, settlement_signature_json = ?, settlement_recorded_at = ?
              WHERE id = ? AND tenant_id = ? AND settled_at IS NULL`,
        args: [settledAt, JSON.stringify(manifest), digest, signature ? JSON.stringify(signature) : null, recordedAt, row.id, tenantId],
      }
    : {
        sql: `UPDATE receivables SET settled_at = ?, settlement_json = ?, settlement_digest = ?
              WHERE id = ? AND tenant_id = ? AND settled_at IS NULL`,
        args: [settledAt, JSON.stringify(manifest), digest, row.id, tenantId],
      });
  // A concurrent settle won the write: its settlement is the one on record.
  if (!written.rowsAffected) {
    return { ok: false, error: 'already_settled', message: 'That receivable is already settled.' };
  }
  await touchReceivable(row.id);
  return { ok: true, digest, signed: !!signature, settledAt };
}

// ── #3: list a tenant's own receivables ──────────────────────────────────────

export interface ReceivableSummary {
  id: string; supplier: string; buyer: string; invoiceNo: string;
  face: number; currency: string; settled: boolean; createdAt: string; isTest: boolean;
  /** Last activity on the record or a child (COALESCE(updated_at, created_at)). */
  updatedAt: string;
  /** True when that activity is newer than the last time this tenant looked — an unseen
   *  update for the desk's badge/bold/dot. */
  updated: boolean;
  /** False when this tenant only holds an active claim against a receivable someone else
   *  created -- a second lender's row, not theirs. Owner-only actions (settle, invite,
   *  upload documents) should not be offered on a row where this is false. */
  mine: boolean;
  /** The owner withdrew it (S2). Only ever true on a row where mine is false: an owner's own
   *  withdrawn records are not listed to the owner. */
  withdrawn: boolean;
  withdrawnAt: string | null;
  /** How this tenant relates to the row (S3): 'owner' when it recorded it, 'claimant' when it only
   *  holds an active claim on someone else's. The book's claimed-only mark reads this. */
  relation: 'owner' | 'claimant';
  /** Whether another record at Almstins matches this one (S3), recorded as financed or not; null
   *  while the duplicate check is unavailable. Never says which record or whose. */
  possibleDuplicate: boolean | null;
}

/** The receivables this tenant created, PLUS any receivable someone else created that this
 *  tenant holds an active claim against -- a second lender used to have no way to find a
 *  deal back in their own book once they'd claimed against it, short of keeping the ID
 *  themselves. Each row is flagged `mine` so the desk knows which owner-only actions to
 *  offer. Newest activity first, with an unseen-update flag from the tenant's own
 *  read-state (never the receivable owner's, now that the owner and viewer can differ).
 *
 *  Soft delete (S2): the owner's withdrawn records are hidden from the owner, even one the owner
 *  also claimed against. A claimant's row on a record someone else withdrew stays listed, marked
 *  withdrawn. (S7 keeps a tokenizer's rows listed the same way.) */
export async function listReceivables(tenantId: string): Promise<ReceivableSummary[]> {
  await ensureReceivablesTables();
  const withDeleted = deletedAtReady;
  const claimedByMe = `EXISTS (SELECT 1 FROM receivable_claims c WHERE c.receivable_id = r.id AND c.tenant_id = ? AND c.status = 'active')`;
  const r = await db.execute(withDeleted
    ? {
        sql: `SELECT r.id, r.supplier, r.buyer, r.invoice_no, r.face, r.currency, r.settled_at,
                     r.created_at, r.is_test, r.deleted_at,
                     COALESCE(r.updated_at, r.created_at) AS last_activity,
                     s.seen_at AS seen_at,
                     (r.tenant_id = ?) AS mine
              FROM receivables r
              LEFT JOIN receivable_seen s ON s.receivable_id = r.id AND s.tenant_id = ?
              WHERE (r.tenant_id = ? AND r.deleted_at IS NULL)
                 OR (r.tenant_id <> ? AND ${claimedByMe})
              ORDER BY COALESCE(r.updated_at, r.created_at) DESC
              LIMIT 200`,
        args: [tenantId, tenantId, tenantId, tenantId, tenantId],
      }
    : {
        sql: `SELECT r.id, r.supplier, r.buyer, r.invoice_no, r.face, r.currency, r.settled_at,
                     r.created_at, r.is_test,
                     COALESCE(r.updated_at, r.created_at) AS last_activity,
                     s.seen_at AS seen_at,
                     (r.tenant_id = ?) AS mine
              FROM receivables r
              LEFT JOIN receivable_seen s ON s.receivable_id = r.id AND s.tenant_id = ?
              WHERE r.tenant_id = ?
                 OR ${claimedByMe}
              ORDER BY COALESCE(r.updated_at, r.created_at) DESC
              LIMIT 200`,
        args: [tenantId, tenantId, tenantId, tenantId],
      });
  const matched = await matchedReceivableIds((r.rows as any[]).map((row) => String(row.id)));
  return (r.rows as any[]).map((row) => {
    const lastActivity = String(row.last_activity ?? row.created_at);
    const seenAt = row.seen_at != null ? String(row.seen_at) : null;
    const mine = truthy(row.mine);
    return {
      id: String(row.id), supplier: String(row.supplier), buyer: String(row.buyer),
      invoiceNo: String(row.invoice_no), face: Number(row.face), currency: String(row.currency),
      settled: row.settled_at != null, createdAt: String(row.created_at),
      isTest: row.is_test === true || row.is_test === 1 || String(row.is_test) === 'true',
      updatedAt: lastActivity,
      // A row with no seen record (created before this feature) is treated as seen, so an
      // existing book does not light up as one giant pile of updates on first load.
      updated: seenAt != null && lastActivity > seenAt,
      mine,
      withdrawn: withDeleted && row.deleted_at != null,
      withdrawnAt: withDeleted && row.deleted_at != null ? String(row.deleted_at) : null,
      relation: mine ? 'owner' as const : 'claimant' as const,
      possibleDuplicate: matched ? matched.has(String(row.id)) : null,
    };
  });
}

/**
 * The book's duplicate flags (S3): which of these listed IDs another record at Almstins matches,
 * financed or not, withdrawn matches included (the same as the twin query). A second query, on the
 * owner pool (see "Duplicate check" above), keyed by IDs the tenant's own listing already returned,
 * so it can never list or reveal a row the tenant could not see. Null, so every flag reads null
 * (unavailable), while the duplicate check cannot answer (no key, unconfirmed columns, rows still
 * waiting for the backfill) and on any error.
 */
async function matchedReceivableIds(ids: string[]): Promise<Set<string> | null> {
  const kid = fingerprintColumnsReady ? fingerprintKid() : null;
  if (!kid) return null;
  try {
    if (!(await coverageOk(kid))) return null;
    if (!ids.length) return new Set();
    const r = await runWithoutDbContext(() => db.execute({
      sql: `SELECT r.id FROM receivables r
            WHERE r.id IN (${ids.map(() => '?').join(', ')})
              AND EXISTS (SELECT 1 FROM receivables t WHERE t.id <> r.id AND t.fingerprint_kid = ? AND (t.fingerprint_ref = r.fingerprint_ref OR t.fingerprint_inv = r.fingerprint_inv))`,
      args: [...ids, kid],
    }));
    return new Set((r.rows as any[]).map((row) => String(row.id)));
  } catch (e) {
    console.error('[receivables] duplicate flags unavailable:', e instanceof Error ? e.message : 'unknown error');
    return null;
  }
}

export type DeleteReceivableResult =
  | { ok: true; withdrawnAt: string }
  | { ok: false; error: 'not_found' | 'unavailable' };

/**
 * Withdraw a receivable this tenant created (S2 soft delete). Nothing is removed: deleted_at is
 * set and every row stays, so other parties' claims and statements stay answerable on the public
 * check, a party can still release its own claim, and a re-recorded duplicate can still be matched
 * against it (the duplicate check's twin query and ENCUMBRANCE_SQL read withdrawn rows too).
 * Before S2 this deleted the owner's own claims, statements and re-verifications, and every offer,
 * document, request, access grant and read marker on the record, which let a financed record
 * vanish and be recorded again clean.
 *
 * In one transaction (db.batch) it also:
 *   - revokes the owner's open requests for the record (receivable-bound, plus the claim-bound
 *     ones on the owner's own claims), so every outstanding link stops working. Answered ones,
 *     and other tenants', are left as they are;
 *   - closes the record's pending offers by ending them now (expires_at). An offer has no status
 *     column, and marking it declined would read as the client declining. Its signed manifest
 *     keeps the expiry it was offered with;
 *   - drops attached files' bytes, keeping the filename, size and sha256 tombstone, the same as
 *     purgeDocuments;
 *   - (S9) will withdraw the record's pending publications here.
 * Claims, statements, re-verifications, access grants and read markers are kept on purpose, and
 * updated_at is bumped so a claimant's book shows the change as an unseen update.
 *
 * Withdrawing again answers ok with the first withdrawal's time. Until deleted_at is confirmed in
 * this process it answers unavailable: it never falls back to a hard delete.
 */
export async function deleteReceivable(tenantId: string, receivableId: string): Promise<DeleteReceivableResult> {
  await ensureReceivablesTables();
  if (!deletedAtReady) return { ok: false, error: 'unavailable' };
  const id = String(receivableId || '').trim();
  const owned = await db.execute({
    sql: `SELECT id, deleted_at FROM receivables WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [id, tenantId],
  });
  if (!owned.rows.length) return { ok: false, error: 'not_found' };
  const already = (owned.rows[0] as any).deleted_at;
  if (already != null) return { ok: true, withdrawnAt: String(already) };

  // A claim-bound request can be stored without its receivable (createInvite takes claimId
  // alone), so the owner's own claims are looked up to revoke those too.
  const ownClaims = await db.execute({
    sql: `SELECT id FROM receivable_claims WHERE receivable_id = ? AND tenant_id = ?`,
    args: [id, tenantId],
  });
  const now = nowUtc();
  const results = await db.batch([
    {
      sql: `UPDATE receivables SET deleted_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
      args: [now, now, id, tenantId],
    },
    {
      sql: `UPDATE receivable_invites SET revoked_at = ?
             WHERE receivable_id = ? AND from_tenant = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
      args: [now, id, tenantId],
    },
    ...(ownClaims.rows as any[]).map((c) => ({
      sql: `UPDATE receivable_invites SET revoked_at = ?
             WHERE claim_id = ? AND from_tenant = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
      args: [now, String(c.id), tenantId],
    })),
    {
      sql: `UPDATE receivable_offers SET expires_at = ?
             WHERE receivable_id = ? AND tenant_id = ? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at > ?`,
      args: [now, id, tenantId, now],
    },
    {
      sql: `UPDATE receivable_documents SET data = NULL, purged_at = ?
             WHERE receivable_id = ? AND tenant_id = ? AND data IS NOT NULL`,
      args: [now, id, tenantId],
    },
    // (S9) withdraw the record's pending publications here, in the same batch.
  ], 'write');

  // A concurrent withdrawal won the first statement: its time is the one on record.
  if (!Number((results as any[])?.[0]?.rowsAffected ?? 0)) {
    const again = await db.execute({
      sql: `SELECT deleted_at FROM receivables WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [id, tenantId],
    });
    const at = (again.rows[0] as any)?.deleted_at;
    return at != null ? { ok: true, withdrawnAt: String(at) } : { ok: false, error: 'not_found' };
  }
  return { ok: true, withdrawnAt: now };
}

// ── #2: Stage 2 buyer/party attestation ──────────────────────────────────────

export type AddAttestationResult =
  | { ok: true; attestationId: string; digest: string; signed: boolean }
  | { ok: false; error: 'not_found'; message: string }
  | { ok: false; error: 'invalid'; message: string }
  | WithdrawnError;

/**
 * Record a party's signed attestation about a receivable. The load-bearing one is the
 * BUYER acknowledging the debt ("I owe ₦100m for invoice X, due Y") — the obligor
 * attesting against their own interest, which is what makes a claim trustworthy. Bound
 * to the receivable hash; signed; the digest is Bitcoin-anchorable. tenant_id is private
 * provenance, never surfaced — only the self-chosen label is public.
 *
 * v1: signed with the Almstins key on the attester's authenticated self-disclosure. v2:
 * the attester proves control of their own address and signs with their own key.
 *
 * `source` records which flow wrote the row (see attestationClass.ts). It is required, so
 * every writer states its provenance, and it is what readers classify by: a typed statement
 * that merely opens with "DISPUTED —" is not a dispute. It is stored beside the row, not in
 * the signed manifest, so manifests and digests keep their existing shape.
 *
 * On a record its owner withdrew (S2) it answers 410 withdrawn and records nothing.
 */
export async function addAttestation(
  tenantId: string,
  receivableId: string,
  input: AttestationInput,
): Promise<AddAttestationResult> {
  return writeAttestation(tenantId, receivableId, input, {});
}

type AttestationInput = {
  role: AttesterRole; label: string; statement: string; date?: string;
  docs?: Array<{ sha256: string; filename: string }>; source: AttestationSource;
};

/** The sources that answer an existing claim (affirmClaimByToken): the only statements still
 *  recorded on a withdrawn record. */
const CLAIM_ANSWER_SOURCES: ReadonlySet<AttestationSource> = new Set<AttestationSource>(['receipt_confirmation', 'receipt_dispute']);

/**
 * addAttestation's body. `answersClaim` is set only by affirmClaimByToken, the client's answer on a
 * claim-bound receipt link: that answer confirms or contests a claim already on the record (another
 * party's existing evidence), so it is still recorded after the owner withdrew the record, the way
 * dischargeClaim still runs (S2). It covers the two receipt sources only; every other statement on
 * a withdrawn record answers 410 withdrawn, as addAttestation does. Not exported, so no route can
 * set it.
 */
async function writeAttestation(
  tenantId: string,
  receivableId: string,
  input: AttestationInput,
  opts: { answersClaim?: true },
): Promise<AddAttestationResult> {
  await ensureReceivablesTables();
  const rid = String(receivableId || '').trim();
  const includeDeleted = opts.answersClaim === true && CLAIM_ANSWER_SOURCES.has(input.source);
  const rcv = await getReceivableRow(rid, { includeDeleted });
  if (!rcv) return (await withdrawnError(rid)) ?? { ok: false, error: 'not_found', message: 'No receivable found for that ID.' };

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
  const sigJson = signature ? JSON.stringify(signature) : null;
  // Without a confirmed source column the row is written the old way (source NULL), which
  // readers classify by prefix and never as consent: a degraded write, not a failed one.
  await db.execute(columnsEnsured
    ? {
        sql: `INSERT INTO receivable_attestations
                (id, receivable_id, tenant_id, role, label, statement, attested_at, manifest_json, signature_json, digest, source)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [attestationId, rcv.id, tenantId, role, label, statement, date, JSON.stringify(manifest), sigJson, digest, input.source],
      }
    : {
        sql: `INSERT INTO receivable_attestations
                (id, receivable_id, tenant_id, role, label, statement, attested_at, manifest_json, signature_json, digest)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [attestationId, rcv.id, tenantId, role, label, statement, date, JSON.stringify(manifest), sigJson, digest],
      });
  // Covers every "someone else answered" event — a debtor acknowledgment, a dispute, and
  // (via affirmClaimByToken, which records its result through here) a client's receipt
  // confirmation. Each floats the record up as an unseen update in the creator's book.
  await touchReceivable(rcv.id);
  return { ok: true, attestationId, digest, signed: !!signature };
}

export type DiligenceMethod = 'phone' | 'relationship' | 'correspondence' | 'other';

const DILIGENCE_METHOD_TEXT: Record<DiligenceMethod, string> = {
  phone: 'a phone call',
  relationship: 'an existing relationship with the debtor',
  correspondence: 'written correspondence (email or letter)',
  other: 'another method',
};

/**
 * The financier's own accountability record -- not a debtor confirmation, and never
 * mistaken for one. Required by addClaim()'s diligence_required gate when a financier
 * wants to finance a receivable with no genuine buyer attestation on file. Filed under
 * role 'other' with a DILIGENCE prefix (same pattern as the existing DISPUTED prefix),
 * never role 'buyer': this is the financier vouching for their own process, not evidence
 * the debtor confirmed anything. Almstins organizes and proves; it does not verify a
 * debtor's identity on the financier's behalf -- that stays the financier's own job, and
 * their own risk, on the record in their own name.
 */
export async function acceptDiligence(
  tenantId: string,
  receivableId: string,
  input: { financier: string; method: DiligenceMethod; note?: string },
): Promise<AddAttestationResult> {
  const methodText = DILIGENCE_METHOD_TEXT[input.method] ?? DILIGENCE_METHOD_TEXT.other;
  const note = clampStr(input.note || '', 300);
  const statement = `DILIGENCE — accepts responsibility for having personally verified this debtor via ${methodText}. Almstins has not independently confirmed this.${note ? ` Note: ${note}` : ''}`;
  return addAttestation(tenantId, receivableId, {
    role: 'other',
    label: clampStr(input.financier, 120),
    statement,
    source: 'diligence',
  });
}

// ── #1: Bitcoin anchoring — attach a receipt to a registry record ─────────────
//
// Which records can carry a timestamp, and which columns hold each kind's digest and receipt,
// is ANCHOR_SPEC (src/lib/receivables/anchorSpec.ts). Every read and write here is scoped by
// tenant_id; only listPendingAnchors and listUnanchoredRecords scan across tenants, for the
// anchor cron, and they return each row's tenant so the cron writes back through the
// tenant-scoped setRecordAnchor.

export type { AnchorRecordKind } from '@/lib/receivables/anchorSpec';

/** A kind whose columns schema.ts adds is usable only once every column add has applied. */
function anchorKindReady(kind: AnchorRecordKind): boolean {
  return !ANCHOR_SPEC[kind].addedColumns || columnsEnsured;
}

/**
 * A record's digest + current anchor receipt, scoped to the tenant that owns it. The
 * digest is what gets stamped into Bitcoin; the anchor endpoint orchestrates the
 * stamp/upgrade and calls setRecordAnchor to persist the receipt. Returns null when the
 * record isn't found, isn't this tenant's, or has nothing to stamp yet (a claim that was
 * never discharged, a receivable that was never settled).
 */
export async function getRecordForAnchor(
  tenantId: string, kind: AnchorRecordKind, id: string,
): Promise<{ digest: string; anchorJson: string | null } | null> {
  await ensureReceivablesTables();
  if (!isAnchorKind(kind) || !anchorKindReady(kind)) return null;
  const { table, digestColumn, anchorColumn } = ANCHOR_SPEC[kind];
  const r = await db.execute({
    sql: `SELECT ${digestColumn} AS digest, ${anchorColumn} AS anchor_json FROM ${table} WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(id || '').trim(), tenantId],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  if (row.digest == null) return null;
  return { digest: String(row.digest), anchorJson: row.anchor_json != null ? String(row.anchor_json) : null };
}

/** Persist an anchor receipt (JSON) onto a record. Tenant-scoped; a record with no digest to
 *  stamp yet is left alone. */
export async function setRecordAnchor(
  tenantId: string, kind: AnchorRecordKind, id: string, anchorJson: string,
): Promise<void> {
  await ensureReceivablesTables();
  if (!isAnchorKind(kind) || !anchorKindReady(kind)) return;
  const { table, digestColumn, anchorColumn } = ANCHOR_SPEC[kind];
  await db.execute({
    sql: `UPDATE ${table} SET ${anchorColumn} = ? WHERE id = ? AND tenant_id = ? AND ${digestColumn} IS NOT NULL`,
    args: [anchorJson, String(id || '').trim(), tenantId],
  });
}

export interface PendingAnchor { kind: AnchorRecordKind; id: string; tenantId: string; anchorJson: string }

/** Rows one kind's scan may return: enough to fill a whole run if no other kind has work. */
const scanLimit = (limit: number) => Math.max(1, Math.min(500, Math.floor(limit) || 1));

/**
 * Every still-pending anchor across the registry tables (cross-tenant maintenance).
 * "Pending" = a receipt is stored but Bitcoin has not confirmed it yet (no anchoredAt).
 * OpenTimestamps sends no push, so the upgrade-anchors cron uses this to find receipts
 * that are ready to be pulled down and persisted, without anyone opening the page.
 * Returns tenant_id per row so the caller persists via the tenant-scoped setRecordAnchor.
 *
 * Per-kind quotas: the kinds take turns filling the run, so a backlog of one kind (fifty pending
 * claims) cannot starve another (one pending settlement); a kind with less work hands its share
 * to the rest. Within a kind, records the cron has asked about least recently come first
 * (receivable_anchor_attempts), so a receipt that never confirms rotates to the back instead of
 * taking a slot on every run; records never asked about come first of all, newest first.
 */
export async function listPendingAnchors(limit = 100): Promise<PendingAnchor[]> {
  await ensureReceivablesTables();
  const perKind: PendingAnchor[][] = [];
  for (const kind of ANCHOR_KINDS) {
    if (!anchorKindReady(kind)) continue;
    const { table, anchorColumn } = ANCHOR_SPEC[kind];
    const r = await db.execute({
      sql: `SELECT t.id, t.tenant_id, t.${anchorColumn} AS anchor_json
            FROM ${table} t
            LEFT JOIN receivable_anchor_attempts a ON a.record_id = t.id AND a.kind = ?
            WHERE t.${anchorColumn} IS NOT NULL AND t.${anchorColumn} NOT LIKE ?
            ORDER BY a.last_attempt_at ASC NULLS FIRST, t.created_at DESC
            LIMIT ${scanLimit(limit)}`,
      args: [kind, CONFIRMED_RECEIPT_LIKE],
    });
    const rows: PendingAnchor[] = [];
    for (const row of r.rows as any[]) {
      const aj = String(row.anchor_json);
      if (anchoredAtOf(aj)) continue; // already confirmed — nothing to pull
      rows.push({ kind, id: String(row.id), tenantId: String(row.tenant_id), anchorJson: aj });
    }
    perKind.push(rows);
  }
  return takeTurns(perKind, limit);
}

/** Interleave lists one item at a time (a, b, c, a, b, ...) up to `limit` items. */
function takeTurns<T>(lists: T[][], limit: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      if (i < l.length && out.length < limit) out.push(l[i]);
    }
  }
  return out;
}

export interface UnanchoredRecord { kind: AnchorRecordKind; id: string; tenantId: string }

/** How many unstamped rows of one kind the cron batch looks at, so that tenants beyond the first
 *  few rows still get their turn. */
const UNANCHORED_SCAN = 500;

/**
 * Records of the cron-stamped kinds (ANCHOR_SPEC cronStamps: re-verifications, and discharges and
 * settlements whose stamp failed when they were recorded) that have a digest but no timestamp
 * yet, across tenants, for the anchor cron to stamp in a batch.
 *
 * Fair by tenant: every tenant with work gets one record before any tenant gets a second, and no
 * tenant gets more than `perTenant` in one batch, so one account adding re-verifications faster
 * than the cron stamps them cannot crowd out the others. Within a tenant the kinds take turns.
 * Records come oldest first (by ANCHOR_SPEC writtenAtColumn), so a backlog drains in arrival
 * order and newer records never jump ahead of it forever; a record the cron has already asked
 * about rotates behind every record it has not (receivable_anchor_attempts), least recently
 * asked first.
 */
export async function listUnanchoredRecords(limit = 20, perTenant = 10): Promise<UnanchoredRecord[]> {
  await ensureReceivablesTables();
  const perKind: UnanchoredRecord[][] = [];
  for (const kind of ANCHOR_KINDS) {
    const spec = ANCHOR_SPEC[kind];
    if (!spec.cronStamps || !anchorKindReady(kind)) continue;
    const r = await db.execute({
      sql: `SELECT t.id, t.tenant_id
            FROM ${spec.table} t
            LEFT JOIN receivable_anchor_attempts a ON a.record_id = t.id AND a.kind = ?
            WHERE t.${spec.anchorColumn} IS NULL AND t.${spec.digestColumn} IS NOT NULL
              AND t.${spec.writtenAtColumn} IS NOT NULL
            ORDER BY a.last_attempt_at ASC NULLS FIRST, t.${spec.writtenAtColumn} ASC
            LIMIT ${UNANCHORED_SCAN}`,
      args: [kind],
    });
    perKind.push((r.rows as any[]).map((row) => ({ kind, id: String(row.id), tenantId: String(row.tenant_id) })));
  }
  // Kinds take turns, then each tenant's share is capped and the tenants take turns, in the order
  // their first record came up.
  const cap = Math.max(1, Math.floor(perTenant) || 1);
  const byTenant = new Map<string, UnanchoredRecord[]>();
  for (const rec of takeTurns(perKind, Number.MAX_SAFE_INTEGER)) {
    const mine = byTenant.get(rec.tenantId) ?? [];
    if (!byTenant.has(rec.tenantId)) byTenant.set(rec.tenantId, mine);
    if (mine.length < cap) mine.push(rec);
  }
  return takeTurns([...byTenant.values()], limit);
}

/** Note that the cron just asked about this record's timestamp, so it rotates to the back of the
 *  next scan. Bookkeeping only, keyed by kind and record ID (no tenant data); never throws. */
export async function recordAnchorAttempt(kind: AnchorRecordKind, id: string): Promise<void> {
  try {
    await ensureReceivablesTables();
    await db.execute({
      sql: `INSERT INTO receivable_anchor_attempts (kind, record_id, last_attempt_at, attempts)
            VALUES (?, ?, ?, 1)
            ON CONFLICT (kind, record_id) DO UPDATE
            SET last_attempt_at = excluded.last_attempt_at, attempts = receivable_anchor_attempts.attempts + 1`,
      args: [kind, String(id), nowUtc()],
    });
  } catch { /* bookkeeping only */ }
}

/** Forget a record's attempts once its timestamp is stamped or confirmed. Never throws. */
export async function clearAnchorAttempts(kind: AnchorRecordKind, id: string): Promise<void> {
  try {
    await ensureReceivablesTables();
    await db.execute({
      sql: `DELETE FROM receivable_anchor_attempts WHERE kind = ? AND record_id = ?`,
      args: [kind, String(id)],
    });
  } catch { /* bookkeeping only */ }
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
 * re-send, and purging on the hour the link expired would make them re-upload at exactly
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
): Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; error: string } | WithdrawnError> {
  await ensureReceivablesTables();
  if (!INVITE_ROLES.includes(input.role)) return { ok: false, error: 'invalid_role' };

  // Only the tenant that owns a receivable may invite someone onto it. A request about a record
  // the owner withdrew answers 410 withdrawn (S2): its answer could never be recorded.
  const withDeleted = deletedAtReady;
  const receivableId = input.receivableId ? String(input.receivableId).trim() : null;
  if (receivableId) {
    const owns = await db.execute({
      sql: `SELECT ${withDeleted ? 'deleted_at' : '1'} FROM receivables WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [receivableId, fromTenant],
    });
    if (!owns.rows.length) return { ok: false, error: 'not_found' };
    const deletedAt = withDeleted ? (owns.rows[0] as any).deleted_at : null;
    if (deletedAt != null) return withdrawnResult(String(deletedAt));
  }

  // A claim-bound invite asks one question about one advance: did this money arrive?
  // It is not an onboarding link, and acceptInvite refuses to spend it as one.
  const claimId = input.claimId ? String(input.claimId).trim() : null;
  if (claimId) {
    const owns = await db.execute({
      sql: `SELECT receivable_id FROM receivable_claims WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [claimId, fromTenant],
    });
    if (!owns.rows.length) return { ok: false, error: 'claim_not_found' };
    const claimRid = String((owns.rows[0] as any).receivable_id);
    // The answer page reads the advance's own receivable, so a link filed under another one
    // would list on the wrong record.
    if (receivableId && claimRid !== receivableId) {
      return { ok: false, error: 'claim_not_found' };
    }
    // Filed without its receivable: the advance's own record decides (S2).
    if (!receivableId) {
      const withdrawn = await withdrawnError(claimRid);
      if (withdrawn) return withdrawn;
    }
  }

  const token = inviteToken();
  let expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19);

  const offerId = input.offerId ? String(input.offerId).trim() : null;
  if (offerId) {
    const owns = await db.execute({
      sql: `SELECT expires_at, receivable_id FROM receivable_offers WHERE id = ? AND tenant_id = ? LIMIT 1`,
      args: [offerId, fromTenant],
    });
    if (!owns.rows.length) return { ok: false, error: 'offer_not_found' };
    if (!receivableId && !claimId) {
      const withdrawn = await withdrawnError(String((owns.rows[0] as any).receivable_id));
      if (withdrawn) return withdrawn;
    }
    // The invite link is the only way to reach the offer, so it must not expire before
    // the offer itself does -- an offer valid up to OFFER_TTL_DAYS/90 days must not sit
    // behind a link that dies at the flat INVITE_TTL_DAYS/7-day default. Both are the
    // same 'YYYY-MM-DD HH:MM:SS' format, so string comparison sorts chronologically.
    const offerExpiresAt = String((owns.rows[0] as any).expires_at);
    if (offerExpiresAt > expiresAt) expiresAt = offerExpiresAt;
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
  if (!rcv) return { ok: false, error: await missingCode(invite.receivableId) };

  const title = answers.title ? ` (${clampStr(answers.title, 60)})` : '';
  // NOT the address. The statement is published by the public lookup to anyone holding the
  // receivable ID, and that endpoint promises no legal identity. A name is the substance of
  // an attestation and belongs here; a third party's email address is contact information
  // that nobody consented to publish. The address stays on the sender's own roster, which
  // is tenant-scoped, so the financier can still prove where they sent it.
  const via = ' via a single-use link';
  void sentTo;

  let statement: string;
  let role: AttesterRole;
  let source: AttestationSource;
  if (outcome === 'confirmed') {
    const affirm = [
      answers.goodsReceived ? 'goods/services received' : 'receipt NOT affirmed',
      answers.amountCorrect ? 'amount correct' : 'amount NOT affirmed',
      answers.noOffsets ? 'no offsets or disputes' : 'offsets/disputes NOT ruled out',
      answers.notAlreadyPaid ? 'not already paid' : 'prior payment NOT ruled out',
    ].join('; ');
    statement = `Confirms invoice ${rcv.invoice_no} for ${rcv.currency} ${Number(rcv.face).toLocaleString('en-US', { minimumFractionDigits: 2 })}. Their reference: ${ref}. Affirms: ${affirm}. Answered by ${who}${title}${via}.`;
    role = 'buyer';
    source = 'debtor_confirmation';
  } else {
    const why = outcome === 'not_ours' ? 'states this invoice is not theirs' : 'states the amount is wrong';
    statement = `DISPUTED — ${why}. Invoice ${rcv.invoice_no}${ref ? `, their reference: ${ref}` : ''}. Answered by ${who}${title}${via}.`;
    role = 'other';
    source = 'debtor_dispute';
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
    role, label: rcv.buyer, statement, docs, source,
  });
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, attestationId: result.attestationId, receivableId: invite.receivableId };
}

/** What the answerer sees before answering. No account, so no session to read it from. */
export async function readConfirmRequest(token: string): Promise<
  | { ok: true; supplier: string; buyer: string; invoiceNo: string; face: number; currency: string;
      terms: string | null; dueDate: string | null; receivableId: string;
      sentTo: string | null; documents: DocumentMeta[]; isTest: boolean }
  | { ok: false; error: string }
> {
  await ensureReceivablesTables();
  const invite = await readInvite(token);
  if (!invite.ok) return { ok: false, error: invite.error };
  if (invite.role !== 'buyer' || !invite.receivableId) return { ok: false, error: 'wrong_role' };
  const rcv = await getReceivableRow(invite.receivableId);
  if (!rcv) return { ok: false, error: await missingCode(invite.receivableId) };

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
    receivableId: String(rcv.id), sentTo, documents, isTest: rcv.is_test === true,
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
): Promise<{ ok: true; doc: DocumentMeta } | { ok: false; error: string } | WithdrawnError> {
  await ensureReceivablesTables();

  const withDeleted = deletedAtReady;
  const owns = await db.execute({
    sql: `SELECT ${withDeleted ? 'deleted_at' : '1'} FROM receivables WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [String(receivableId || '').trim(), tenantId],
  });
  if (!owns.rows.length) return { ok: false, error: 'not_found' };
  // No new paperwork on a record its owner withdrew (S2): its files are already tombstones.
  const deletedAt = withDeleted ? (owns.rows[0] as any).deleted_at : null;
  if (deletedAt != null) return withdrawnResult(String(deletedAt));

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
  label:      string | null;   // who they say it went to
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

/** Does this tenant own this receivable? The gate on every owner-only read. A record the owner
 *  withdrew (S2) is no longer theirs to read or act on, so it answers false. */
export async function ownsReceivable(tenantId: string, receivableId: string): Promise<boolean> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT 1 FROM receivables WHERE id = ? AND tenant_id = ?${deletedAtReady ? ' AND deleted_at IS NULL' : ''} LIMIT 1`,
    args: [String(receivableId || '').trim(), tenantId],
  });
  return r.rows.length > 0;
}

/** Did this tenant record this receivable, withdrawn (S2) or not? Only for the owner's read-only
 *  view of what a withdrawal leaves on file: the document list, where each purged file shows as
 *  its filename, size and fingerprint tombstone. Every action still gates on ownsReceivable,
 *  which a withdrawn record fails, and uploads answer 410 through addDocument. */
export async function ownsReceivableRecord(tenantId: string, receivableId: string): Promise<boolean> {
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
// supposed to receive it says they received it. Symmetric with the buyer confirmation, and
// for the same reason — the party with nothing to gain from the lie is the one worth
// asking. They need no account either; the link is the authority.

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
      sentTo: string | null; alreadyAffirmed: boolean; isTest: boolean }
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

  // includeDeleted (S2): the link asks about a claim already on the record, so it stays answerable
  // after the owner withdraws the record, and the answer confirms or contests that claim (see
  // affirmClaimByToken). The owner's own links were revoked by the withdrawal and stopped above;
  // what is left here is another party's link on its own claim.
  const rcv = await getReceivableRow(String(row.receivable_id), { includeDeleted: true });
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
    isTest: rcv.is_test === true,
  };
}

/**
 * Answer a counter-signature request. 'received' marks the claim affirmed; the two
 * disagreements do NOT, and file under role 'other' with a DISPUTED prefix so a denial
 * can never be read downstream as a confirmation. Same shape as confirmByToken.
 *
 * Still answerable after the owner withdraws the record (S2): the answer is about a claim
 * already on it, and a withdrawal must not let the owner keep a client from confirming or
 * disputing another party's advance. The owner's own receipt links were revoked by the
 * withdrawal, so they answer 'revoked' before reaching this point.
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
  let source: AttestationSource;
  if (outcome === 'received') {
    statement = `Confirms receipt of ${registered} advanced by ${req.financier} against invoice ${req.invoiceNo}, registered ${req.claimDate}. Answered by ${who}${title}${via}.`;
    role = 'supplier';
    source = 'receipt_confirmation';
  } else if (outcome === 'not_received') {
    statement = `DISPUTED — states no money was received from ${req.financier} against invoice ${req.invoiceNo}. Claim registered ${req.claimDate} for ${registered}. Answered by ${who}${title}${via}.`;
    role = 'other';
    source = 'receipt_dispute';
  } else {
    const got = Number(answers.amountReceived);
    const gotStr = Number.isFinite(got) && got > 0
      ? `${req.currency} ${got.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : 'a different amount';
    statement = `DISPUTED — states the amount received was ${gotStr}, not the ${registered} registered by ${req.financier} against invoice ${req.invoiceNo}. Answered by ${who}${title}${via}.`;
    role = 'other';
    source = 'receipt_dispute';
  }

  // Claim the token before writing anything, so a forwarded link cannot answer twice.
  const claimed = await db.execute({
    sql: `UPDATE receivable_invites SET accepted_at = ?, accepted_by = ?
           WHERE token = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), who, String(token).trim()],
  });
  if (!claimed.rowsAffected) return { ok: false, error: 'used' };

  // answersClaim: recorded even on a record its owner withdrew (S2), since it confirms or contests
  // a claim already on it.
  const result = await writeAttestation(fromTenant, req.receivableId, {
    role, label: `${req.financier} advance`, statement, source,
  }, { answersClaim: true });
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
   *  the financier wrote them: what is agreed between them and their client is theirs. */
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
// puts their name to any of it. So if the deal goes wrong they can say "I never said that"
// and nothing on the record contradicts them.
//
// This asks them, at intake, before any money moves: did we record your deal correctly, and
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
      details: ReceivableDetails | null; documents: DocumentMeta[]; sentTo: string | null;
      isTest: boolean }
  | { ok: false; error: string }
> {
  await ensureReceivablesTables();
  const r = await db.execute({
    sql: `SELECT receivable_id, role, claim_id, offer_id, email, expires_at, accepted_at, revoked_at
            FROM receivable_invites WHERE token = ? LIMIT 1`,
    args: [String(token || '').trim()],
  });
  if (!r.rows.length) return { ok: false, error: 'not_found' };
  const row = r.rows[0] as any;
  if (row.revoked_at) return { ok: false, error: 'revoked' };
  if (row.accepted_at) return { ok: false, error: 'used' };
  if (String(row.expires_at) < nowUtc()) return { ok: false, error: 'expired' };
  if (row.offer_id || row.claim_id || !row.receivable_id || String(row.role) !== 'borrower') {
    return { ok: false, error: 'wrong_kind' };
  }

  const rcv = await getReceivableRow(String(row.receivable_id));
  if (!rcv) return { ok: false, error: await missingCode(String(row.receivable_id)) };

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
    isTest: rcv.is_test === true,
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
  let source: AttestationSource;
  if (outcome === 'accurate') {
    statement = `Confirms this is their receivable: invoice ${req.invoiceNo} to ${req.buyer} for ${amount}, and that the attached paperwork is what they provided. Answered by ${who}${title} via a single-use link.`;
    role = 'supplier';
    source = 'record_confirmation';
  } else {
    const what = clampStr(answers.correction ?? '', 300);
    statement = `DISPUTED — states the record is wrong. Invoice ${req.invoiceNo} to ${req.buyer} for ${amount}.${what ? ` They say: ${what}` : ''} Answered by ${who}${title} via a single-use link.`;
    role = 'other';
    source = 'record_dispute';
  }

  const claimed = await db.execute({
    sql: `UPDATE receivable_invites SET accepted_at = ?, accepted_by = ?
           WHERE token = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    args: [nowUtc(), who, String(token).trim()],
  });
  if (!claimed.rowsAffected) return { ok: false, error: 'used' };

  const docs = req.documents.map((d) => ({ sha256: d.sha256, filename: d.filename }));
  const result = await addAttestation(fromTenant, req.receivableId, {
    role, label: req.supplier, statement, docs, source,
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

  // includeDeleted for the label only: the statement itself goes through addAttestation, which
  // records nothing on a withdrawn record (S2). The owner's open requests were revoked when it was
  // withdrawn, so listLapsedRequests does not hand those over in the first place.
  const rcv = await getReceivableRow(req.receivableId, { includeDeleted: true });
  const label = rcv ? String(rcv.buyer) : 'Unanswered request';

  const result = await addAttestation(fromTenant, req.receivableId, {
    role: 'other',
    label: req.role === 'buyer' ? label : (rcv ? String(rcv.supplier) : label),
    statement: `UNANSWERED — a confirmation was requested from ${asked} on ${req.createdAt.slice(0, 10)} and expired without a reply on ${req.expiresAt.slice(0, 10)}.${chased} This records the request, not an answer.`,
    date: req.expiresAt.slice(0, 10),
    source: 'unanswered',
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
             AND r.settled_at IS NULL${deletedAtReady ? ' AND r.deleted_at IS NULL' : ''}
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
  /** What it costs them, in the financier's own words. Fee structures vary too much to model. */
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
): Promise<{ ok: true; offerId: string; digest: string; signed: boolean } | { ok: false; error: string; message?: string } | WithdrawnError> {
  await ensureReceivablesTables();
  const rid = String(receivableId || '').trim();
  // ownsReceivable is false for a record the owner withdrew, so the owner's withdrawn record is
  // told apart here: 410 withdrawn for the owner (S2), the plain not_found for anyone else.
  if (!(await ownsReceivable(tenantId, rid))) return (await withdrawnError(rid, tenantId)) ?? { ok: false, error: 'not_found' };

  const rcv = await getReceivableRow(rid);
  if (!rcv) return (await withdrawnError(rid, tenantId)) ?? { ok: false, error: 'not_found' };

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

/** What the client sees. No account: they are being offered money, not signing up for software. */
export async function readOfferRequest(token: string): Promise<
  | { ok: true; offer: PublicOffer; supplier: string; buyer: string; invoiceNo: string;
      face: number; currency: string; dueDate: string | null; documents: DocumentMeta[];
      isTest: boolean }
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
  if (!rcv) return { ok: false, error: await missingCode(String(inv.receivable_id)) };

  return {
    ok: true, offer,
    supplier: String(rcv.supplier), buyer: String(rcv.buyer), invoiceNo: String(rcv.invoice_no),
    face: Number(rcv.face), currency: String(rcv.currency),
    dueDate: rcv.due_date != null ? String(rcv.due_date) : null,
    documents: (await listDocuments(String(rcv.id))).filter((d) => !d.purgedAt),
    isTest: rcv.is_test === true,
  };
}

/**
 * Accept or decline. Acceptance records a signed attestation reciting the terms, so what they
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

  // Validate BEFORE claiming the token. The initials check used to sit after it, so an
  // accept with no initials burned the link: nothing was recorded, and the client came
  // back to "this offer has already been answered" with no way to finish. A rejected
  // answer must leave the request exactly as it found it.
  const initials = outcome === 'accept' ? clampStr(answers.initials ?? '', 8) : '';
  if (outcome === 'accept' && !initials) return { ok: false, error: 'initials_required' };

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
  let source: AttestationSource;
  if (outcome === 'accept') {
    // Initials are taken against the recourse clause specifically, because that is the term
    // people sign without reading and the one they later say they never saw. Checked above,
    // before the token is spent.
    statement = `Accepts financing of ${amt} from ${o.financier} against invoice ${req.invoiceNo}. ${o.price ? `Charge: ${o.price}. ` : ''}Terms: ${rec}, initialled "${initials}".${o.repayment ? ` Repayment: ${o.repayment}.` : ''} Accepted by ${who}${title} via a single-use link, before funds were advanced.`;
    role = 'supplier';
    source = 'offer_acceptance';
    await db.execute({
      sql: `UPDATE receivable_offers SET accepted_at = ?, accepted_by = ? WHERE id = ? AND accepted_at IS NULL`,
      args: [nowUtc(), who, o.id],
    });
  } else {
    const why = clampStr(answers.reason ?? '', 300);
    statement = `DECLINED — did not accept financing of ${amt} from ${o.financier} against invoice ${req.invoiceNo}.${why ? ` They say: ${why}` : ''} Answered by ${who}${title} via a single-use link.`;
    role = 'other';
    source = 'offer_decline';
    await db.execute({
      sql: `UPDATE receivable_offers SET declined_at = ?, declined_reason = ? WHERE id = ? AND declined_at IS NULL`,
      args: [nowUtc(), why || null, o.id],
    });
  }

  const result = await addAttestation(fromTenant, receivableId, {
    role, label: req.supplier, statement, source,
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
