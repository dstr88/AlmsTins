/**
 * reconciliation.ts
 * Shared types for the reconciliation feature.
 * Used by both /api/reconciliation/index.ts and ReconciliationTin.tsx.
 */

export type ReconciliationStatus =
  | 'ok'         // delta ≤ 1% — all good
  | 'over'       // live > tin by > 1% — untracked inflows
  | 'under'      // live < tin by > 1% — missing exports or disposed coins
  | 'missing'    // tin shows a balance, live shows zero
  | 'untracked'; // live shows a balance, tin has no FIFO record

export type SourceBreakdown = {
  kind: 'wallet' | 'exchange';
  label: string;
  amount: number;
};

export type ReconciliationNote = {
  note: string | null;
  flaggedForSupport: boolean;
};

export type ReconciliationItem = {
  asset: string;
  tinAmount: number;
  liveAmount: number;
  tinCostUsd: number | null;
  deltaCoins: number;
  deltaUsd: number | null;
  deltaPercent: number | null;
  status: ReconciliationStatus;
  lastTxDate: string | null;
  sources: SourceBreakdown[];
  existingNote: ReconciliationNote | null;
  /** True when this symbol is filtered as spam/scam (override-aware) — hidden from the main view. */
  filtered: boolean;
};

export function deriveStatus(tinAmt: number, liveAmt: number): ReconciliationStatus {
  if (tinAmt === 0 && liveAmt === 0) return 'ok';
  if (tinAmt > 0 && liveAmt === 0) return 'missing';
  if (tinAmt === 0 && liveAmt > 0) return 'untracked';
  const pct = Math.abs((liveAmt - tinAmt) / tinAmt) * 100;
  if (pct <= 1) return 'ok';
  return liveAmt > tinAmt ? 'over' : 'under';
}
