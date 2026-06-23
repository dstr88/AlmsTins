// Pure mapping: the Year-Summary breakdown (exactly what the PDF prints) → the
// canonical leaves that hash into the Merkle tree. Because it consumes the SAME
// AnnualBreakdown object that produced the PDF, the proof can never drift from
// the numbers shown. No DB access — fully unit-testable.
//
// NFT holdings are intentionally excluded (they carry wallet/contract identifiers
// and aren't a tax gain/income line); the proof covers the financial lines.

import type { AnnualBreakdown, SettledLot, BasisSource as BdBasisSource } from '@/lib/annualBreakdown';
import {
  type CanonicalLeaf, type SourceTrust, type BasisSource,
  LEAF_SCHEMA_VERSION, toFixedTrimmed, normalizeTimestamp, AMOUNT_SCALE, USD_SCALE,
} from './leaf';

/** The method whose election the report reflects (FIFO is what the export uses). */
const ELECTION = 'fifo';

function basisTrust(bs: BdBasisSource | undefined, txHash: string | null): SourceTrust {
  if (txHash) return 'onchain';
  switch (bs) {
    case 'recorded': return 'recorded';
    case 'estimated': return 'estimated';
    case 'manual': return 'manual';
    case 'missing': return 'unverified';
    default: return 'unverified';
  }
}

export function leavesFromBreakdown(bd: AnnualBreakdown): CanonicalLeaf[] {
  const source = bd.dataSource;
  const leaves: CanonicalLeaf[] = [];

  const disposal = (l: SettledLot, term: 'short' | 'long'): CanonicalLeaf => ({
    v: LEAF_SCHEMA_VERSION, kind: 'disposal', asset: l.asset,
    amount: toFixedTrimmed(l.amount, AMOUNT_SCALE) ?? '0',
    acquired_at: normalizeTimestamp(l.buyDate), disposed_at: normalizeTimestamp(l.sellDate), date: null,
    cost_usd: toFixedTrimmed(l.costUsd, USD_SCALE), proceeds_usd: toFixedTrimmed(l.proceedsUsd, USD_SCALE),
    gain_usd: toFixedTrimmed(l.gainLossUsd, USD_SCALE),
    days_held: Number.isFinite(l.daysHeld) ? l.daysHeld : null, term, income_kind: null,
    tx_hash: null, basis_source: (l.basisSource ?? null) as BasisSource,
    source, source_trust: basisTrust(l.basisSource, null), election: ELECTION,
  });
  for (const l of bd.shortTerm) leaves.push(disposal(l, 'short'));
  for (const l of bd.longTerm) leaves.push(disposal(l, 'long'));

  for (const it of [...bd.income, ...bd.cardRebates]) {
    leaves.push({
      v: LEAF_SCHEMA_VERSION, kind: 'income', asset: it.asset,
      amount: toFixedTrimmed(it.amount, AMOUNT_SCALE) ?? '0',
      acquired_at: null, disposed_at: null, date: normalizeTimestamp(it.date),
      cost_usd: null, proceeds_usd: toFixedTrimmed(it.usdValue, USD_SCALE), gain_usd: null,
      days_held: null, term: null, income_kind: it.kind, tx_hash: null,
      basis_source: null, source, source_trust: 'recorded', election: ELECTION,
    });
  }

  for (const h of bd.stillHolding) {
    leaves.push({
      v: LEAF_SCHEMA_VERSION, kind: 'held', asset: h.asset,
      amount: toFixedTrimmed(h.amount, AMOUNT_SCALE) ?? '0',
      acquired_at: normalizeTimestamp(h.acquiredDate), disposed_at: null, date: null,
      cost_usd: toFixedTrimmed(h.costUsd, USD_SCALE), proceeds_usd: null, gain_usd: null,
      days_held: Number.isFinite(h.daysHeld) ? h.daysHeld : null, term: null, income_kind: null,
      tx_hash: null, basis_source: null, source, source_trust: 'recorded', election: ELECTION,
    });
  }

  for (const u of bd.needsAttention) {
    leaves.push({
      v: LEAF_SCHEMA_VERSION, kind: 'unsettled', asset: u.asset,
      amount: toFixedTrimmed(u.amount, AMOUNT_SCALE) ?? '0',
      acquired_at: null, disposed_at: null, date: normalizeTimestamp(u.sellDate),
      cost_usd: null, proceeds_usd: toFixedTrimmed(u.proceedsUsd, USD_SCALE), gain_usd: null,
      days_held: null, term: null, income_kind: null, tx_hash: u.txHash,
      basis_source: 'missing', source, source_trust: u.txHash ? 'onchain' : 'unverified', election: ELECTION,
    });
  }

  return leaves;
}
