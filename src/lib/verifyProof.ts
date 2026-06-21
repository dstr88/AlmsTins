/**
 * Almstins Verify — Phase 3: proof of control (domain attestation).
 *
 * A destination owner proves they control the domain that publishes an address by
 * hosting an Almstins-issued challenge at
 *   https://<domain>/.well-known/almstins-verify.json
 * We fetch it server-side, confirm the challenge token matches the one we issued
 * to THIS tenant for THIS domain (account-bound: copying another entity's file
 * fails — it carries their token, not ours), and read the address list the domain
 * vouches for. The caller then flips any of the tenant's registered destinations
 * whose value appears in that list to proof_status='proven'.
 *
 * This module is pure mechanism — NO database. It returns structured outcome codes
 * (never human prose) so the UI maps them to localized EN/ES/FR copy, the same way
 * the safety overlay maps wallet-check/dapp-check verdicts. Storage + the endpoints
 * that issue/record challenges live in verifyRegistry.ts and the API layer.
 *
 * NON-NEGOTIABLE: read-only, no custody, no fund movement, no attribution. Proving
 * a domain is owner→self self-disclosure ("this domain is mine"), never a global
 * address→identity map.
 */
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { normalizeDestinationValue } from './verifyRegistry';

/** Where the owner publishes the proof. The path is fixed; the file is per-domain. */
export const WELL_KNOWN_PATH = '/.well-known/almstins-verify.json';

const CHALLENGE_PREFIX = 'almstins-verify-';
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 64 * 1024; // a proof file is tiny; cap to avoid a hostile large body

/** Outcome codes — each maps to a localized string in src/i18n/dashboard/verify.ts. */
export type ProofFailCode =
  | 'invalid_domain'     // not a public domain we can fetch (malformed, IP literal, or SSRF-blocked)
  | 'unreachable'        // DNS/connection/timeout/non-200 — file not published or server down
  | 'malformed'          // fetched, but not the JSON shape we expect
  | 'challenge_mismatch'; // file present, but its challenge token isn't the one we issued

export type ProofResult =
  | { ok: true; addresses: string[] } // challenge matched; normalized addresses the domain vouches for
  | { ok: false; code: ProofFailCode };

/** Issue an account-bound challenge token. Stored per (tenant, domain) by the caller. */
export function generateChallenge(): string {
  return CHALLENGE_PREFIX + randomBytes(16).toString('hex');
}

/** The exact file the owner must publish, so the UI/docs can show a copy-paste sample. */
export function buildProofFile(challenge: string, addresses: string[]): string {
  return JSON.stringify({ almstins: { version: 1, challenge, addresses } }, null, 2);
}

// ── SSRF guard ──────────────────────────────────────────────────────────────
// We fetch a user-supplied domain server-side, so an attacker could try to point
// us at internal infrastructure. Defense: https-only, reject IP-literal/localhost
// hosts, resolve DNS and block any private/loopback/link-local/ULA result, no
// redirects, hard timeout, capped body. Residual: DNS-rebinding between our lookup
// and fetch — acceptable for a low-frequency, authenticated, owner-initiated proof.

function ipv4ToLong(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToLong(ip);
  if (n === null) return true; // unparseable → treat as unsafe
  const inRange = (base: string, bits: number): boolean => {
    const b = ipv4ToLong(base);
    if (b === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange('0.0.0.0', 8) ||      // "this network"
    inRange('10.0.0.0', 8) ||     // RFC1918
    inRange('100.64.0.0', 10) ||  // CGNAT
    inRange('127.0.0.0', 8) ||    // loopback
    inRange('169.254.0.0', 16) || // link-local (incl. 169.254.169.254 cloud metadata)
    inRange('172.16.0.0', 12) ||  // RFC1918
    inRange('192.0.0.0', 24) ||   // IETF protocol assignments
    inRange('192.168.0.0', 16) || // RFC1918
    inRange('198.18.0.0', 15) ||  // benchmarking
    inRange('224.0.0.0', 4) ||    // multicast
    inRange('240.0.0.0', 4)       // reserved
  );
}

function isPrivateIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isPrivateIpv4(ip);
  if (fam === 6) {
    const lc = ip.toLowerCase();
    const mapped = lc.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
    if (mapped) return isPrivateIpv4(mapped[1]);
    return (
      lc === '::1' || lc === '::' ||
      lc.startsWith('fc') || lc.startsWith('fd') ||                 // fc00::/7 unique-local
      /^fe[89ab]/.test(lc) ||                                       // fe80::/10 link-local
      lc.startsWith('ff')                                           // multicast
    );
  }
  return true; // not a recognizable IP → unsafe
}

/**
 * Normalize a user-supplied domain to a bare hostname we're willing to fetch, or
 * null if it's not a public domain. Accepts "shop.com", "https://shop.com/x", etc.
 */
export function normalizeProofDomain(raw: string): string | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s || s.length > 253) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//.test(s) ? s : `https://${s}`).hostname;
  } catch {
    return null;
  }
  if (!host || isIP(host)) return null;                 // we attest domains, not IP literals
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return null; // must be a dotted public-style name
  return host;
}

/** Resolve the host and confirm every resolved IP is public. */
async function hostResolvesPublic(host: string): Promise<boolean> {
  try {
    const records = await lookup(host, { all: true });
    if (!records.length) return false;
    return records.every((r) => !isPrivateIp(r.address));
  } catch {
    return false;
  }
}

interface ProofFile { challenge: string; addresses: string[] }

function parseProofFile(text: string): ProofFile | null {
  let data: any;
  try { data = JSON.parse(text); } catch { return null; }
  const node = data?.almstins ?? data; // tolerate either namespaced or flat
  const challenge = typeof node?.challenge === 'string' ? node.challenge.trim() : '';
  const addresses = Array.isArray(node?.addresses)
    ? node.addresses.filter((a: unknown): a is string => typeof a === 'string')
    : [];
  if (!challenge) return null;
  return { challenge, addresses };
}

/**
 * Fetch and verify the proof published at the domain against the challenge we
 * issued. On success, returns the normalized addresses the domain vouches for.
 */
export async function verifyDomainProof(rawDomain: string, expectedChallenge: string): Promise<ProofResult> {
  const host = normalizeProofDomain(rawDomain);
  if (!host) return { ok: false, code: 'invalid_domain' };
  if (!(await hostResolvesPublic(host))) return { ok: false, code: 'invalid_domain' };

  const url = `https://${host}${WELL_KNOWN_PATH}`;
  let text: string;
  try {
    const res = await fetch(url, {
      redirect: 'error', // a redirect could bounce us to an internal host — refuse it
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, code: 'unreachable' };
    const body = await res.text();
    text = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
  } catch {
    return { ok: false, code: 'unreachable' };
  }

  const file = parseProofFile(text);
  if (!file) return { ok: false, code: 'malformed' };
  if (file.challenge !== expectedChallenge) return { ok: false, code: 'challenge_mismatch' };

  // Challenge matched → the domain controller published our token. Hand back the
  // addresses it vouches for, normalized so the caller can match them to the
  // tenant's registered destinations (EVM lowercased; BTC/SOL/LTC case kept).
  const addresses = Array.from(new Set(file.addresses.map(normalizeDestinationValue).filter(Boolean)));
  return { ok: true, addresses };
}
