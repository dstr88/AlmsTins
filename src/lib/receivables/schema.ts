/**
 * Receivables schema additions, as import-free constants.
 *
 * db:migrate is retired. The registry creates and extends its own tables at runtime with
 * idempotent DDL (CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS), run by
 * ensureReceivablesTables in src/lib/receivablesRegistry.ts. Every new statement lands here
 * rather than in the registry, so the schema changes read as one list.
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

/** New column adds, in order. They run after the registry's original column list. */
export const RECEIVABLE_COLUMN_ADDS: readonly string[] = [ADD_ATTESTATION_SOURCE];
