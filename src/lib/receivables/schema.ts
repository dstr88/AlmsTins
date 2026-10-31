/**
 * Receivables schema additions, as import-free constants.
 *
 * db:migrate is retired. The registry creates and extends its own tables at runtime with
 * idempotent DDL (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS), run by
 * ensureReceivablesTables in src/lib/receivablesRegistry.ts. Every new statement lands here
 * rather than in the registry, so the schema changes read as one list.
 *
 * New tables are created with the registry's own tables: a failed CREATE fails the whole ensure,
 * which is forgotten and retried on the next call, so no read ever meets a missing relation.
 *
 * Column adds run one at a time, after the tables exist. A failed add is logged, leaves
 * receivableColumnsEnsured() false and is retried on a later call. Readers and writers of a
 * column added here check that flag first and fall back to what they did before the column
 * existed, so a failed ALTER degrades one feature instead of failing every read.
 */

/**
 * receivable_attestations.source: who wrote the row, as an AttestationSource (see
 * src/lib/receivables/attestationClass.ts). NULL on rows written before it existed; those are
 * classified by their statement prefix.
 */
export const ADD_ATTESTATION_SOURCE = 'ALTER TABLE receivable_attestations ADD COLUMN IF NOT EXISTS source TEXT';

/**
 * A discharge's own evidence, kept beside the discharge manifest and digest that were already
 * stored: the signature over that manifest (it used to be computed and thrown away), the
 * Bitcoin timestamp receipt for its digest, and the full recorded-at time (discharged_at holds
 * only the date). NULL on discharges recorded before these columns existed.
 */
export const ADD_DISCHARGE_SIGNATURE = 'ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharge_signature_json TEXT';
export const ADD_DISCHARGE_ANCHOR = 'ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharge_anchor_json TEXT';
export const ADD_DISCHARGE_RECORDED_AT = 'ALTER TABLE receivable_claims ADD COLUMN IF NOT EXISTS discharge_recorded_at TEXT';

/** The same three for a settlement, on the receivable row. */
export const ADD_SETTLEMENT_SIGNATURE = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS settlement_signature_json TEXT';
export const ADD_SETTLEMENT_ANCHOR = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS settlement_anchor_json TEXT';
export const ADD_SETTLEMENT_RECORDED_AT = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS settlement_recorded_at TEXT';

/**
 * receivables.deleted_at: when the owner withdrew the record (S2 soft delete). Deleting a
 * receivable sets this and keeps every row, so other parties' claims and statements stay
 * answerable and a re-recorded duplicate is still matched against it. NULL on a live record;
 * cleared again when the owner records the same details. Until this column is confirmed in the
 * process, reads ignore it and deleting answers unavailable rather than removing rows. It is
 * confirmed on its own (the registry's deletedAtReady: this add succeeded, or a read of the column
 * did), not with the rest of this list, so another add that fails never makes a withdrawn record
 * read as live.
 */
export const ADD_RECEIVABLE_DELETED_AT = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS deleted_at TEXT';

/**
 * The duplicate check's fingerprints (S3): keyed hashes of the record's canonical form (see
 * src/lib/receivables/fingerprintNormalize.ts and server/fingerprint.ts), never the plaintext.
 * fingerprint_ref is the strong key (debtor + the debtor's own reference + amount), fingerprint_inv
 * the fallback (debtor + supplier + invoice number + amount), fingerprint_kid the key and scheme that
 * made them. NULL until computed: a create writes them, and the backfill fills older rows and any
 * row whose kid is not the current one. Nullable with no default, so each add changes the catalog
 * only and rewrites no rows. Confirmed on their own (the registry's fingerprintColumnsReady: all three
 * adds succeeded, or a read of the three did), so another add that fails never makes the duplicate
 * check read as clear.
 */
export const ADD_FINGERPRINT_REF = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS fingerprint_ref TEXT';
export const ADD_FINGERPRINT_INV = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS fingerprint_inv TEXT';
export const ADD_FINGERPRINT_KID = 'ALTER TABLE receivables ADD COLUMN IF NOT EXISTS fingerprint_kid TEXT';
export const FINGERPRINT_COLUMN_ADDS: readonly string[] = [ADD_FINGERPRINT_REF, ADD_FINGERPRINT_INV, ADD_FINGERPRINT_KID];

/** New column adds, in order. They run after the registry's original column list. */
export const RECEIVABLE_COLUMN_ADDS: readonly string[] = [
  ADD_ATTESTATION_SOURCE,
  ADD_DISCHARGE_SIGNATURE,
  ADD_DISCHARGE_ANCHOR,
  ADD_DISCHARGE_RECORDED_AT,
  ADD_SETTLEMENT_SIGNATURE,
  ADD_SETTLEMENT_ANCHOR,
  ADD_SETTLEMENT_RECORDED_AT,
  ADD_RECEIVABLE_DELETED_AT,
  ...FINGERPRINT_COLUMN_ADDS,
];

/**
 * Partial indexes for the duplicate check's twin query: only rows that carry a fingerprint are
 * indexed. They run after the column adds, each on its own. A failed index is logged and retried
 * on its own a minute later (the column adds do not run again for it), and gates nothing: without
 * it the twin query is a slower scan, never a wrong answer.
 *
 * Built without CONCURRENTLY on purpose: they are created while every fingerprint is still NULL,
 * so the build is one scan into an empty index. If this is ever switched to CONCURRENTLY, note
 * that IF NOT EXISTS skips an INVALID index left by a cancelled build forever, so the ensure would
 * then need a pg_index.indisvalid check that drops and recreates it.
 */
export const CREATE_FP_REF_IDX = 'CREATE INDEX IF NOT EXISTS receivables_fp_ref ON receivables (fingerprint_ref) WHERE fingerprint_ref IS NOT NULL';
export const CREATE_FP_INV_IDX = 'CREATE INDEX IF NOT EXISTS receivables_fp_inv ON receivables (fingerprint_inv) WHERE fingerprint_inv IS NOT NULL';

/** New indexes on added columns, in order. They run after every column add. */
export const RECEIVABLE_INDEX_CREATES: readonly string[] = [CREATE_FP_REF_IDX, CREATE_FP_INV_IDX];

/**
 * Run before each column add and each index above, in the same transaction (one db.batch, which
 * the Postgres shim sends to the owner pool and wraps in BEGIN/COMMIT). ADD COLUMN IF NOT EXISTS
 * takes an ACCESS EXCLUSIVE lock even when the column is already there, and CREATE INDEX IF NOT
 * EXISTS takes a SHARE lock before it checks the name. Without a limit, one of them waiting behind
 * a long transaction on the table would queue every later read and write of that table behind it.
 * With it, the statement gives up after three seconds and the ensure carries on: a column whose add
 * timed out is confirmed by a zero-row read when it is already there, its feature stays off (fail
 * closed) when it is not, and the add is retried a minute later.
 */
export const DDL_LOCK_TIMEOUT = `SET LOCAL lock_timeout = '3s'`;

/**
 * receivable_anchor_attempts: when the anchor cron last asked about a record's timestamp, and
 * how many times. Rate bookkeeping only, keyed by (kind, record_id) and holding no tenant data.
 * The cron reads the oldest attempts first, so a receipt the calendars never confirm drops to
 * the back of the queue instead of taking a slot on every run.
 */
export const CREATE_ANCHOR_ATTEMPTS = `
  CREATE TABLE IF NOT EXISTS receivable_anchor_attempts (
    kind            TEXT NOT NULL,
    record_id       TEXT NOT NULL,
    last_attempt_at TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, record_id)
  )
`;

/**
 * receivable_status_events (aging A1): a claim's one-click status updates, append-only. One row =
 * one signed, dated event by the claim's own financier — `extended` (new_promised_date + a
 * mandatory structured reason_code, optional reason_note) or `unpaid` (optional reason_note).
 * Nothing here is ever updated or deleted; only the Bitcoin receipt (anchor_json) is written onto
 * a row after the fact, through the generic tenant-scoped setRecordAnchor (ANCHOR_SPEC
 * status_event). The receivable's own due_date is never rewritten — it sits inside the signed
 * manifest and the record's ID — these events layer the dated chain that moved it.
 *
 * reason_code / reason_note are tenant-tier data: the public status never selects them (D3) —
 * the aging state and the dated chain are public, the reasons are not.
 */
export const CREATE_STATUS_EVENTS = `
  CREATE TABLE IF NOT EXISTS receivable_status_events (
    id                TEXT NOT NULL PRIMARY KEY,
    tenant_id         TEXT NOT NULL,
    receivable_id     TEXT NOT NULL,
    claim_id          TEXT NOT NULL,
    kind              TEXT NOT NULL,
    new_promised_date TEXT,
    reason_code       TEXT,
    reason_note       TEXT,
    manifest_json     TEXT NOT NULL,
    signature_json    TEXT,
    digest            TEXT NOT NULL,
    anchor_json       TEXT,
    created_at        TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
  )
`;
/** The new table's own indexes. The registry creates them right after the table creates, the
 *  same way the core tables' indexes run (not RECEIVABLE_INDEX_CREATES, which holds only
 *  indexes on columns added at runtime); a failure fails the whole ensure, which is retried. */
export const CREATE_STATUS_EVENTS_RCV_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_status_events_rcv ON receivable_status_events (receivable_id)`;
export const CREATE_STATUS_EVENTS_CLAIM_IDX =
  `CREATE INDEX IF NOT EXISTS receivable_status_events_claim ON receivable_status_events (claim_id)`;

/** New tables, in order. They run after the registry's own CREATEs and before any column add. */
export const RECEIVABLE_TABLE_CREATES: readonly string[] = [
  CREATE_ANCHOR_ATTEMPTS,
  CREATE_STATUS_EVENTS,
];
