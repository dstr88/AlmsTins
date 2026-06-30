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
import { lookup, resolveTxt } from 'node:dns/promises';
import { isIP } from 'node:net';

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

export type SafeFetchResult =
  | { ok: true; text: string }
  | { ok: false; code: 'invalid_url' | 'unreachable' };

/**
 * SSRF-guarded GET of a user-supplied public URL (full URL, may have a path). Same
 * defense as the proof fetch: https-only, reject IP-literal/localhost hosts, resolve
 * DNS and block any private result, no redirects, hard timeout, capped body. Used by
 * the published-source swap monitor to read a merchant's OWN public page server-side.
 */
export async function safeFetchPublicUrl(
  rawUrl: string,
  opts: { timeoutMs?: number; maxBytes?: number; accept?: string } = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  let u: URL;
  try {
    const s = (rawUrl ?? '').trim();
    if (!/^https?:\/\//i.test(s)) return { ok: false, code: 'invalid_url' };
    u = new URL(s);
  } catch {
    return { ok: false, code: 'invalid_url' };
  }
  if (u.protocol !== 'https:') return { ok: false, code: 'invalid_url' }; // https only
  const host = normalizeProofDomain(u.hostname);
  if (!host) return { ok: false, code: 'invalid_url' };
  if (!(await hostResolvesPublic(host))) return { ok: false, code: 'invalid_url' };
  try {
    const res = await fetch(u.toString(), {
      redirect: 'error', // a redirect could bounce us to an internal host — refuse it
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: opts.accept ?? 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) return { ok: false, code: 'unreachable' };
    const body = await res.text();
    return { ok: true, text: body.length > maxBytes ? body.slice(0, maxBytes) : body };
  } catch {
    return { ok: false, code: 'unreachable' };
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
  // addresses it vouches for, as published. The caller (verifyRegistry) normalizes
  // both sides when matching them to the tenant's registered destinations.
  const addresses = Array.from(new Set(file.addresses.map((a) => a.trim()).filter(Boolean)));
  return { ok: true, addresses };
}

// ── DNS TXT proof (the easier path for managed-host merchants) ────────────────
// A merchant who can't drop a /.well-known file (Shopify/Wix/Squarespace) can instead
// add a TXT record carrying the same account-bound challenge. DNS control proves the
// same authority a file does. Unlike the file, a TXT record carries NO address list —
// so DNS proves CONTROL (→ reserve the business name), it does not vouch for addresses.

export type DnsTxtResult = { ok: true } | { ok: false; code: 'invalid_domain' | 'unreachable' | 'challenge_mismatch' };

/** Pure: does any published TXT record carry the challenge token? Exported for tests. */
export function txtRecordsContainChallenge(records: string[], challenge: string): boolean {
  if (!challenge) return false;
  return records.some((r) => r.includes(challenge));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/**
 * Verify the challenge is published as a TXT record on the domain (root) or on the
 * dedicated `_almstins-verify.<domain>` host. Read-only DNS lookup — no HTTP, no SSRF
 * surface. Returns ok when any record contains the token.
 */
export async function verifyDnsTxt(rawDomain: string, expectedChallenge: string): Promise<DnsTxtResult> {
  const host = normalizeProofDomain(rawDomain);
  if (!host) return { ok: false, code: 'invalid_domain' };
  const names = [host, `_almstins-verify.${host}`];
  const collected: string[] = [];
  let anyResolved = false;
  for (const name of names) {
    try {
      const recs = await withTimeout(resolveTxt(name), FETCH_TIMEOUT_MS); // string[][]
      anyResolved = true;
      for (const chunks of recs) collected.push(chunks.join(''));
    } catch { /* NXDOMAIN / no TXT / timeout — try the next name */ }
  }
  if (!collected.length) return { ok: false, code: anyResolved ? 'challenge_mismatch' : 'unreachable' };
  return txtRecordsContainChallenge(collected, expectedChallenge) ? { ok: true } : { ok: false, code: 'challenge_mismatch' };
}

// ── Hosted-API-endpoint variant (Verified Entity) ────────────────────────────
// An exchange hosts a live address list on its OWN domain and gives us an API key.
// The domain stays the trust anchor: the endpoint must live on the verified domain
// (or a subdomain), so reachability there proves control. The key is access control
// + live updates, not the root of trust.

export type EntityPullCode = 'invalid_endpoint' | 'unreachable' | 'unauthorized' | 'malformed';
export type EntityPullResult =
  | { ok: true; addresses: Array<{ address: string; chain: string }> }
  | { ok: false; code: EntityPullCode };

/**
 * Validate that an endpoint URL is https and lives on the verified domain (or a
 * subdomain of it). Returns the normalized URL string, or null if it's off-domain,
 * not https, or an IP literal. This is the anchor check — without it, anyone could
 * host an endpoint anywhere and claim addresses.
 */
export function validateEntityEndpoint(endpoint: string, verifiedDomain: string): string | null {
  let u: URL;
  try { u = new URL(endpoint); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const dom = (verifiedDomain ?? '').trim().toLowerCase();
  if (!dom || isIP(host)) return null;
  if (host !== dom && !host.endsWith('.' + dom)) return null; // same domain or subdomain only
  return u.toString();
}

function normalizeEvm(a: string): string {
  const s = a.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(s) ? s.toLowerCase() : s;
}

/** Tolerant parser: {addresses:[{address,chain}]} | {addresses:["0x…"]} | ["0x…"]. */
function parseEntityList(text: string): Array<{ address: string; chain: string }> | null {
  let data: any;
  try { data = JSON.parse(text); } catch { return null; }
  const arr = Array.isArray(data) ? data : Array.isArray(data?.addresses) ? data.addresses : null;
  if (!arr) return null;
  const out: Array<{ address: string; chain: string }> = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      const address = normalizeEvm(item);
      if (address) out.push({ address, chain: '' });
    } else if (item && typeof item.address === 'string') {
      const address = normalizeEvm(item.address);
      if (address) out.push({ address, chain: typeof item.chain === 'string' ? item.chain.trim() : '' });
    }
  }
  // de-dup by address+chain
  const seen = new Set<string>();
  return out.filter((e) => { const k = `${e.address}|${e.chain}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Pull a Verified Entity's live address list from its hosted endpoint using the
 * API key it issued us. Anchored to the verified domain, SSRF-guarded, key sent as
 * a Bearer token. Returns the published addresses, or a structured failure code.
 */
export async function pullEntityList(endpoint: string, apiKey: string, verifiedDomain: string): Promise<EntityPullResult> {
  const url = validateEntityEndpoint(endpoint, verifiedDomain);
  if (!url) return { ok: false, code: 'invalid_endpoint' };
  if (!(await hostResolvesPublic(new URL(url).hostname))) return { ok: false, code: 'invalid_endpoint' };

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return { ok: false, code: 'unreachable' };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, code: 'unauthorized' };
  if (!res.ok) return { ok: false, code: 'unreachable' };

  let text: string;
  try {
    const body = await res.text();
    text = body.length > MAX_BYTES ? body.slice(0, MAX_BYTES) : body;
  } catch {
    return { ok: false, code: 'unreachable' };
  }

  const parsed = parseEntityList(text);
  if (!parsed) return { ok: false, code: 'malformed' };
  return { ok: true, addresses: parsed };
}
