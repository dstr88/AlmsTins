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

/** New column adds, in order. They run after the registry's original column list. */
export const RECEIVABLE_COLUMN_ADDS: readonly string[] = [
  ADD_ATTESTATION_SOURCE,
  ADD_DISCHARGE_SIGNATURE,
  ADD_DISCHARGE_ANCHOR,
  ADD_DISCHARGE_RECORDED_AT,
  ADD_SETTLEMENT_SIGNATURE,
  ADD_SETTLEMENT_ANCHOR,
  ADD_SETTLEMENT_RECORDED_AT,
];

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

/** New tables, in order. They run after the registry's own CREATEs and before any column add. */
export const RECEIVABLE_TABLE_CREATES: readonly string[] = [CREATE_ANCHOR_ATTEMPTS];
