/**
 * Almstins Verify — Phase 5 published-source swap monitor.
 *
 * A merchant attaches the PUBLIC page where they publish a destination (a "pay to
 * this address" page, a donation page, an invoice, a checkout that embeds a Stripe
 * link). The watchman cron fetches that page server-side (SSRF-guarded, read-only)
 * and checks the registered value is still the one shown — catching a swap on the
 * merchant's own published surface, which the on-save proof can't see after the fact.
 *
 * Boundary: read-only, no custody, no attribution. We read the merchant's OWN public
 * page and compare to the value they registered themselves. Nothing is written about
 * anyone else; the page content is never stored.
 *
 * Detection is deliberately conservative (fail-safe / under-claim): we only report a
 * 'swapped' (alert-worthy) when the registered value is GONE and a high-confidence
 * CONFLICTING same-kind value is present. Anything ambiguous (page restructured,
 * value rendered by JS, below the byte cap) is 'missing' — recorded, never alerted.
 */
import { safeFetchPublicUrl } from './verifyProof';
import { normalizeDestinationValue, type DestinationKind } from './verifyRegistry';

export type MonitorOutcome =
  | 'present'      // the registered value still appears on the page
  | 'swapped'      // registered value gone + a conflicting same-kind value present → ALERT
  | 'missing'      // registered value not found, no clear replacement (changed/JS/below cap) → no alert
  | 'unreachable'  // couldn't fetch the page (transient) → no alert
  | 'invalid_url'; // monitor URL not a fetchable public https URL

export interface MonitorResult {
  outcome: MonitorOutcome;
  /** Conflicting same-kind values found when 'swapped' (for the alert body). */
  found: string[];
}

const PAGE_MAX_BYTES = 512 * 1024; // real pages are bigger than a proof file

/** High-confidence same-rail address patterns. Noisy formats (legacy base58, Solana)
 *  are intentionally absent: we use them for the registered value's own presence
 *  check, but never to declare a *conflicting* address (would false-positive). */
const EVM_RE = /0x[a-fA-F0-9]{40}/g;
const BTC_BECH32_RE = /\bbc1[02-9ac-hj-np-z]{8,87}\b/gi;
const LTC_BECH32_RE = /\bltc1[02-9ac-hj-np-z]{8,87}\b/gi;

function railAddressRegex(rail: string): RegExp | null {
  if (rail === 'ethereum' || rail === 'polygon' || rail === 'avalanche') return new RegExp(EVM_RE);
  if (rail === 'bitcoin') return new RegExp(BTC_BECH32_RE);
  if (rail === 'litecoin') return new RegExp(LTC_BECH32_RE);
  return null; // solana / legacy-base58 BTC: presence-only, no conflict detection
}

/** EVM is case-insensitive (checksum vs lowercase); other chains are case-sensitive. */
function isEvm(rail: string): boolean {
  return rail === 'ethereum' || rail === 'polygon' || rail === 'avalanche';
}

/**
 * Pure analysis: given the destination and the fetched page text, decide the outcome.
 * Exported for unit tests; no I/O.
 */
export function analyzePublishedHtml(
  kind: DestinationKind,
  rail: string,
  registeredValue: string,
  pageText: string,
): MonitorResult {
  const text = pageText ?? '';
  const registered = normalizeDestinationValue(registeredValue);
  if (!registered) return { outcome: 'missing', found: [] };

  if (kind === 'qr') {
    // URL / payment link. Registered value normalizes to scheme+host+path.
    let host = '';
    try { host = new URL(registered).host.toLowerCase(); } catch { host = ''; }
    const urls = Array.from(text.matchAll(/https?:\/\/[^\s"'<>)]+/gi)).map((m) =>
      normalizeDestinationValue(m[0]),
    );
    const present = urls.some((u) => u === registered);
    if (present) return { outcome: 'present', found: [] };
    // Conflict = a DIFFERENT URL on the same host (e.g. a swapped Stripe link).
    const conflicts = host
      ? Array.from(new Set(urls.filter((u) => {
          if (u === registered) return false;
          try { return new URL(u).host.toLowerCase() === host; } catch { return false; }
        })))
      : [];
    return conflicts.length ? { outcome: 'swapped', found: conflicts } : { outcome: 'missing', found: [] };
  }

  // Crypto address. Presence check first (case-insensitive for EVM).
  const haystack = isEvm(rail) ? text.toLowerCase() : text;
  const needle = isEvm(rail) ? registered.toLowerCase() : registered;
  if (haystack.includes(needle)) return { outcome: 'present', found: [] };

  // Registered address absent — look for a conflicting same-rail address (high-confidence rails only).
  const re = railAddressRegex(rail);
  if (!re) return { outcome: 'missing', found: [] };
  const matches = Array.from(text.matchAll(re)).map((m) =>
    isEvm(rail) ? m[0].toLowerCase() : m[0],
  );
  const conflicts = Array.from(new Set(matches.filter((a) => a !== needle)));
  return conflicts.length ? { outcome: 'swapped', found: conflicts } : { outcome: 'missing', found: [] };
}

/**
 * Fetch the merchant's published page and analyze it. Read-only, SSRF-guarded,
 * non-throwing (fetch failures map to 'unreachable'/'invalid_url').
 */
export async function checkPublishedSource(
  kind: DestinationKind,
  rail: string,
  registeredValue: string,
  monitorUrl: string,
): Promise<MonitorResult> {
  const res = await safeFetchPublicUrl(monitorUrl, { maxBytes: PAGE_MAX_BYTES });
  if (!res.ok) return { outcome: res.code, found: [] };
  return analyzePublishedHtml(kind, rail, registeredValue, res.text);
}
