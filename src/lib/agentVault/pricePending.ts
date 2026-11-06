/**
 * The pending-price mark a transfer carries when it was recorded before its day's price was in
 * (./dailyPrices.ts fills the value in later). Pure and import-free, so a page in the browser can read
 * the mark without pulling in anything that talks to the database.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COIN = /^[a-z0-9-]{1,64}$/;

/** The coin and day a transfer's price is waiting for, or null when it waits for none (or the mark is not one this file trusts). */
export function pendingPriceOf(detail: Record<string, unknown> | null | undefined): { coinId: string; day: string } | null {
  const p = detail?.price as { pending?: unknown; coinId?: unknown; day?: unknown } | null | undefined;
  if (!p || p.pending !== true || typeof p.coinId !== 'string' || typeof p.day !== 'string') return null;
  return COIN.test(p.coinId) && DAY.test(p.day) ? { coinId: p.coinId, day: p.day } : null;
}
