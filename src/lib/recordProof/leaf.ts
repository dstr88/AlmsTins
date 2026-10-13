// The canonical leaf — one LINE of the Year-Summary tax report (a settled
// disposal, an income receipt, a still-held position, or an unsettled/orphaned
// sell) turned into a fixed-field, schema-versioned, deterministically-serialized
// object that hashes into the Merkle tree.
//
// We hash the REPORT'S OWN LINES (the exact output of buildAnnualBreakdown that
// the PDF prints) rather than re-deriving raw rows — so the proof attests
// precisely "these report figures are unaltered", with zero risk of drifting
// from the numbers shown, and the report stays reproducible by re-running the
// published method on the same inputs.
//
// Determinism: every numeric becomes a fixed-scale decimal STRING
// (toFixedTrimmed) BEFORE it enters the leaf, then RFC-8785 JCS (canonicalize)
// yields byte-identical output on server, browser, and the offline verifier.
// orderLeaves() makes row/return order irrelevant.
//
// PII-FREE BY CONSTRUCTION: no field can carry a wallet address, email, or name.
// (Free-text descriptions — which can hold P2P phone numbers etc. — are excluded.)
// A tx_hash is a PUBLIC on-chain identifier, not identity.

import canonicalize from 'canonicalize';
import { utf8ToBytes } from '@noble/hashes/utils.js';

export const LEAF_SCHEMA_VERSION = 1;

export type LeafKind = 'disposal' | 'income' | 'held' | 'unsettled';
export type Term = 'short' | 'long' | null;
export type BasisSource = 'recorded' | 'estimated' | 'manual' | 'missing' | null;

export type SourceTrust =
  | 'onchain'                    // has a tx hash, re-checkable against the chain
  | `exchange_csv:${string}`     // exchange-attested CSV row (trust, not proof)
  | 'recorded'                   // basis from a recorded acquisition
  | 'estimated'                  // basis from a backfilled/looked-up price
  | 'manual'                     // user-entered basis
  | 'unverified';                // no traceable source

export interface CanonicalLeaf {
  v: number;                     // LEAF_SCHEMA_VERSION
  kind: LeafKind;
  asset: string;                 // uppercased symbol
  amount: string;                // deterministic decimal string
  acquired_at: string | null;    // ISO-8601 …Z (disposal / held)
  disposed_at: string | null;    // ISO-8601 …Z (disposal)
  date: string | null;           // ISO-8601 …Z (income / unsettled event)
  cost_usd: string | null;       // deterministic decimal string
  proceeds_usd: string | null;
  gain_usd: string | null;
  days_held: number | null;
  term: Term;                    // short | long | null
  income_kind: string | null;    // for income lines
  tx_hash: string | null;        // on-chain anchor where the report carries one
  basis_source: BasisSource;
  source: 'lifecycle' | 'pipeline';
  source_trust: SourceTrust;
  election: string;              // cost-basis method, e.g. 'fifo'
}

/**
 * Deterministic decimal string: round to `scale` dp, strip trailing zeros and a
 * trailing dot, normalize -0 → 0; null/undefined/non-finite → null.
 * Number.prototype.toFixed is spec-defined (ECMA-262), so a given numeric value
 * yields identical output across compliant engines.
 */
export function toFixedTrimmed(value: number | string | null | undefined, scale: number): string | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return null;
  let s = n.toFixed(scale);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (/^-0$/.test(s)) s = '0';
  return s;
}

/** Default scales — 18 dp for token amounts, 2 dp for USD. */
export const AMOUNT_SCALE = 18;
export const USD_SCALE = 2;

/** Normalize a timestamp to ISO-8601 …Z (ms); empty/unparseable → null. */
export function normalizeTimestamp(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const raw = String(ts);
  const ms = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Canonical bytes of a leaf (RFC-8785 JCS → UTF-8). */
export function serializeLeaf(leaf: CanonicalLeaf): Uint8Array {
  const json = canonicalize(leaf);
  if (json === undefined) throw new Error('leaf: canonicalize returned undefined');
  return utf8ToBytes(json);
}

// Control-char separators that cannot appear in real field values (defined via
// fromCharCode so no literal control bytes live in the source).
const FIELD_SEP = String.fromCharCode(1);
const NUL = String.fromCharCode(0);

/** The line's primary date for chronological ordering. */
function primaryDate(leaf: CanonicalLeaf): string {
  return leaf.disposed_at ?? leaf.date ?? leaf.acquired_at ?? NUL;
}

/** Stable, collision-resistant sort key. ISO timestamps sort chronologically. */
export function leafSortKey(leaf: CanonicalLeaf): string {
  return [
    primaryDate(leaf),
    leaf.kind,
    leaf.asset,
    leaf.amount,
    leaf.tx_hash ?? NUL,
    leaf.term ?? NUL,
    leaf.proceeds_usd ?? NUL,
    leaf.cost_usd ?? NUL,
    leaf.income_kind ?? NUL,
  ].join(FIELD_SEP);
}

/**
 * Total order over leaves so a shuffled return order always yields the same
 * ordered list → the same Merkle root. Final tiebreaker = canonical bytes, so
 * two genuinely-distinct lines never collide to the same position.
 */
export function orderLeaves(leaves: CanonicalLeaf[]): CanonicalLeaf[] {
  return leaves.slice().sort((a, b) => {
    const ka = leafSortKey(a);
    const kb = leafSortKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    const sa = canonicalize(a) ?? '';
    const sb = canonicalize(b) ?? '';
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}
