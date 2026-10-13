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
import { createHash } from 'node:crypto';
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

// High-confidence same-rail address detection. EVM (0x) and bech32 are self-evident.
// Legacy base58 (BTC/LTC) is validated by its base58check checksum, so a random base58
// token on the page can't masquerade as an address (≈1-in-4-billion false match).
//
// Solana is deliberately presence-only: its addresses carry NO checksum — *any* 32-byte
// base58 string is a syntactically valid pubkey — so declaring a Solana "conflict" would
// false-positive on any 44-char base58 token (analytics IDs, bundle hashes) and fire a
// bogus swap alert. Under-claim, never over-claim: Solana relies on the presence check.
const EVM_RE = /0x[a-fA-F0-9]{40}/g;
const BTC_BECH32_RE = /\bbc1[02-9ac-hj-np-z]{8,87}\b/gi;
const LTC_BECH32_RE = /\bltc1[02-9ac-hj-np-z]{8,87}\b/gi;
const BTC_LEGACY_RE = /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g; // P2PKH (0x00) / P2SH (0x05)
const LTC_LEGACY_RE = /\b[LM][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g; // L (0x30) / M P2SH (0x32)

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP: Record<string, number> = {};
for (let i = 0; i < B58_ALPHABET.length; i++) B58_MAP[B58_ALPHABET[i]] = i;

function base58Decode(s: string): Uint8Array | null {
  if (!s) return null;
  const bytes: number[] = [0];
  for (const ch of s) {
    const val = B58_MAP[ch];
    if (val === undefined) return null;
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let k = 0; k < s.length && s[k] === '1'; k++) bytes.push(0); // leading '1' → 0x00
  return Uint8Array.from(bytes.reverse());
}

function sha256(b: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(b).digest());
}

/** base58check: 21-byte payload (1 version + 20-byte hash) + 4-byte double-SHA256 checksum. */
function isBase58Check(s: string, versions: number[]): boolean {
  const d = base58Decode(s);
  if (!d || d.length !== 25) return false;
  const payload = d.subarray(0, 21);
  const checksum = d.subarray(21);
  const h = sha256(sha256(payload));
  for (let i = 0; i < 4; i++) if (checksum[i] !== h[i]) return false;
  return versions.includes(d[0]);
}

function matchValidated(text: string, re: RegExp, valid: (s: string) => boolean): string[] {
  return Array.from(text.matchAll(re)).map((m) => m[0]).filter(valid);
}

/** Every high-confidence same-rail address on the page. Deduped by the caller. */
function findRailAddresses(rail: string, text: string): string[] {
  if (isEvm(rail)) return Array.from(text.matchAll(new RegExp(EVM_RE))).map((m) => m[0].toLowerCase());
  if (rail === 'bitcoin') {
    return [
      ...Array.from(text.matchAll(new RegExp(BTC_BECH32_RE))).map((m) => m[0]),
      ...matchValidated(text, new RegExp(BTC_LEGACY_RE), (a) => isBase58Check(a, [0x00, 0x05])),
    ];
  }
  if (rail === 'litecoin') {
    return [
      ...Array.from(text.matchAll(new RegExp(LTC_BECH32_RE))).map((m) => m[0]),
      ...matchValidated(text, new RegExp(LTC_LEGACY_RE), (a) => isBase58Check(a, [0x30, 0x32])),
    ];
  }
  return []; // solana: no checksum → presence-only (see note above)
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

  // Registered address absent — look for a CONFLICTING same-rail address. Legacy base58
  // is checksum-validated; Solana never conflicts (see findRailAddresses note).
  const others = findRailAddresses(rail, text)
    .map((a) => (isEvm(rail) ? a.toLowerCase() : a))
    .filter((a) => a !== needle);
  const conflicts = Array.from(new Set(others));
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
