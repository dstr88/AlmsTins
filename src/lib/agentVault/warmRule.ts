/**
 * The rules of the warm-address cache (./warmCache.ts) that need no database: how many addresses an
 * account keeps, how long one stays without use, and whether a stored entry may answer a check. Pure
 * and import-free, so tests can run the same rule against an in-memory stand-in.
 */

/** The most addresses one account keeps warm. */
export const WARM_MAX = 10;
/** How long an address stays warm without being used. Each hit starts it again. */
export const WARM_IDLE_MS = 10 * 60_000;

/** One warm address as stored. */
export interface WarmEntry {
  screenedAt: string;
  lastUsedAt: string;
}

/**
 * Whether a stored entry may answer a check made at `now`. Pure, so every rule has a test:
 * used within WARM_IDLE_MS, screened no later than now, and screened after the sanctions mirror last
 * changed. When the mirror's time could not be read (`sanctionsAt` undefined) nothing is used: a
 * fresh screening is the answer to any doubt. A mirror that has never loaded (`null`) leaves nothing
 * to compare; the screening that put the entry here passed its sanctions check, so it stands.
 */
export function warmEntryUsable(entry: WarmEntry, sanctionsAt: string | null | undefined, now: Date): boolean {
  const used = Date.parse(entry.lastUsedAt);
  const screened = Date.parse(entry.screenedAt);
  if (!Number.isFinite(used) || !Number.isFinite(screened)) return false;
  const t = now.getTime();
  if (t - used >= WARM_IDLE_MS || used > t || screened > t) return false;
  if (sanctionsAt === undefined) return false;
  if (sanctionsAt === null) return true;
  const changed = Date.parse(sanctionsAt);
  return Number.isFinite(changed) && screened > changed;
}
