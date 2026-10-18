/**
 * How the Vault adds up dollars: one side of a tin's money in or out, as raw sums and nothing else.
 * Pure (no database, no network), so the ledger's totals (./events.ts) and the operator report
 * (./report.ts) share one rounding rule and can never disagree about a cent.
 *
 * A transfer's USD value is the value on the day it happened. A transfer with no value on record
 * (a token that could not be priced) is counted on its own and is never added in as zero. Nothing
 * here nets one side against the other.
 */

/** One side of a tin's money in and out. `usd` adds only the transfers that have a USD value. */
export interface SideTotal {
  count: number;
  pricedCount: number;
  /** Transfers with no USD value on record (a token we could not price). They are counted here, never added in as zero. */
  unpricedCount: number;
  /** USD at the time of each transfer, in dollars rounded to the cent. */
  usd: number;
}

/** A side's running sums while a list is read. `micros` is the dollar total in whole millionths. */
export interface SideSums {
  count: number;
  priced: number;
  unpriced: number;
  micros: number;
}

const MICROS = 1_000_000;

export const emptySums = (): SideSums => ({ count: 0, priced: 0, unpriced: 0, micros: 0 });

/** One transfer's dollar value as whole micro-dollars, so the sum of many is exact. */
export const usdToMicros = (usd: number): number => Math.round(usd * MICROS);

/** Adds one transfer to a side: its value when it has one, a count of its own when it does not. */
export function addTransfer(side: SideSums, usd: number | null): void {
  side.count += 1;
  if (usd === null) {
    side.unpriced += 1;
  } else {
    side.priced += 1;
    side.micros += usdToMicros(usd);
  }
}

/** A side's sums as the SideTotal callers see: the dollar total rounded to the cent. */
export function toSideTotal(s: SideSums): SideTotal {
  return {
    count: s.count,
    pricedCount: s.priced,
    unpricedCount: s.unpriced,
    usd: Math.round(s.micros / (MICROS / 100)) / 100,
  };
}
