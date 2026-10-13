/**
 * ANCHOR_SPEC: every kind of receivables record that can carry a Bitcoin timestamp, in one place.
 *
 * A timestamp (an OpenTimestamps receipt, stored as JSON) pins a record's digest to a time
 * Almstins cannot backdate. Each kind names the table that holds the record, the column with the
 * digest that gets stamped and the column the receipt is stored in. The registry's
 * getRecordForAnchor, setRecordAnchor, listPendingAnchors and listUnanchoredRecords read this
 * map, so adding a kind is one entry here (plus its columns in schema.ts), not a fourth copy of
 * the anchoring code.
 *
 * Every kind's table has an `id` and a `tenant_id`, and every read or write of a record through
 * this map is scoped by tenant_id. Table and column names are interpolated into SQL from these
 * constants only, never from a request.
 *
 * Import-free on purpose: a page script may read the kinds without pulling in the database.
 */

export interface AnchorSpecEntry {
  /** The table holding the record. Its key is `id`; its owner is `tenant_id`. */
  readonly table: string;
  /** The column holding the digest that gets stamped. NULL means there is nothing to stamp yet. */
  readonly digestColumn: string;
  /** The column the timestamp receipt is stored in. */
  readonly anchorColumn: string;
  /** The column holding when this kind's record was written. The anchor cron stamps a kind's
   *  records oldest first by it, and leaves out rows where it is NULL: discharges and
   *  settlements recorded before that time was kept. Those were never stamped when they were
   *  written, and are deliberately left unstamped rather than stamped long after the fact. */
  readonly writtenAtColumn: string;
  /** True when a column above is added at runtime by schema.ts: the kind is usable only once
   *  every column add has applied (receivableColumnsEnsured()). */
  readonly addedColumns: boolean;
  /** True when the anchor cron stamps this kind's unstamped records itself, in batches:
   *  re-verifications (never stamped when they are recorded), and discharges and settlements
   *  (stamped when they are recorded, so the cron only retries a stamp that failed or was rate
   *  limited then). The other kinds are stamped through /api/verify/receivables/anchor, and
   *  diligence acceptances (kind attestation) also when they are recorded. */
  readonly cronStamps: boolean;
}

export const ANCHOR_SPEC = {
  receivable: { table: 'receivables', digestColumn: 'digest', anchorColumn: 'anchor_json', writtenAtColumn: 'created_at', addedColumns: false, cronStamps: false },
  claim: { table: 'receivable_claims', digestColumn: 'digest', anchorColumn: 'anchor_json', writtenAtColumn: 'created_at', addedColumns: false, cronStamps: false },
  attestation: { table: 'receivable_attestations', digestColumn: 'digest', anchorColumn: 'anchor_json', writtenAtColumn: 'created_at', addedColumns: false, cronStamps: false },
  reverification: { table: 'receivable_reverifications', digestColumn: 'digest', anchorColumn: 'anchor_json', writtenAtColumn: 'created_at', addedColumns: false, cronStamps: true },
  claim_discharge: { table: 'receivable_claims', digestColumn: 'discharge_digest', anchorColumn: 'discharge_anchor_json', writtenAtColumn: 'discharge_recorded_at', addedColumns: true, cronStamps: true },
  settlement: { table: 'receivables', digestColumn: 'settlement_digest', anchorColumn: 'settlement_anchor_json', writtenAtColumn: 'settlement_recorded_at', addedColumns: true, cronStamps: true },
} as const satisfies Record<string, AnchorSpecEntry>;

export type AnchorRecordKind = keyof typeof ANCHOR_SPEC;

/** Every kind, in a fixed order (the order listPendingAnchors takes turns in). */
export const ANCHOR_KINDS = Object.keys(ANCHOR_SPEC) as AnchorRecordKind[];

/** True for a kind named in ANCHOR_SPEC (own keys only, so "constructor" is not a kind). */
export function isAnchorKind(kind: unknown): kind is AnchorRecordKind {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(ANCHOR_SPEC, kind);
}

/**
 * A LIKE pattern that matches a stored receipt Bitcoin has confirmed: JSON.stringify writes a
 * confirmed receipt's time as "anchoredAt":"<ISO time>" and a pending one as "anchoredAt":null.
 * Used to leave confirmed receipts out of the pending scan in SQL; the caller still re-checks
 * each row it gets back.
 */
export const CONFIRMED_RECEIPT_LIKE = '%"anchoredAt":"%';
