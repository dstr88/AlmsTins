import type { APIRoute } from 'astro';
import { checkLocalPhishingDb } from '@/lib/phishingDomains';

/**
 * /api/dapp-check?url={url}
 *
 * Checks a URL/domain against every free scam-detection source available:
 *
 * Keyless (no API key needed):
 *   1. MetaMask eth-phishing-detect  — 198K+ crypto phishing domains (GitHub)
 *   2. ScamSniffer blocklist         — 345K+ crypto phishing domains (GitHub)
 *   3. GoPlus Security               — live web3 phishing API
 *   4. URLScan.io                    — search existing security scans
 *   5. OpenPhish public feed         — ~300 active phishing URLs (GitHub)
 *
 * Optional (activated by env vars):
 *   6. Google Safe Browsing          — GOOGLE_SAFE_BROWSING_KEY
 *   7. VirusTotal                    — VIRUSTOTAL_API_KEY
 */

const TIMEOUT_MS      = 12_000;  // per-request API calls (GoPlus, URLScan, etc.)
const LIST_TIMEOUT_MS = 45_000;  // one-time list downloads — needs to survive cold start + GitHub fetch
const LIST_TTL_MS     = 4 * 60 * 60 * 1000; // 4 hours

// ── Static list cache ─────────────────────────────────────────────────────────
type ListCache = {
  metamask:    { blacklist: Set<string>; whitelist: Set<string> } | null;
  scamsniffer: Set<string> | null;
  openphish:   string[] | null;
  loadedAt:    number;
};

const lists: ListCache = {
  metamask:    null,
  scamsniffer: null,
  openphish:   null,
  loadedAt:    0,
};

// Track whether a background load is already in flight so we don't double-fetch
let listsLoading = false;

async function loadListsInBackground(): Promise<void> {
  if (listsLoading) return;
  if (Date.now() - lists.loadedAt < LIST_TTL_MS) return;
  listsLoading = true;

  try {
    const [mm, ss, op] = await Promise.allSettled([
      fetchWithTimeout(
        'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/master/src/config.json',
        LIST_TIMEOUT_MS,
      ).then((r) => r.json()),
      fetchWithTimeout(
        'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json',
        LIST_TIMEOUT_MS,
      ).then((r) => r.json()),
      fetchWithTimeout(
        'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt',
        LIST_TIMEOUT_MS,
      ).then((r) => r.text()),
    ]);

    if (mm.status === 'fulfilled' && mm.value?.blacklist) {
      lists.metamask = {
        blacklist: new Set((mm.value.blacklist as string[]).map((d) => d.toLowerCase())),
        whitelist: new Set((mm.value.whitelist as string[]).map((d) => d.toLowerCase())),
      };
    }
    if (ss.status === 'fulfilled' && Array.isArray(ss.value)) {
      lists.scamsniffer = new Set((ss.value as string[]).map((d) => d.toLowerCase()));
    }
    if (op.status === 'fulfilled' && typeof op.value === 'string') {
      lists.openphish = op.value.trim().split('\n').filter(Boolean);
    }
    lists.loadedAt = Date.now();
  } finally {
    listsLoading = false;
  }
}

// Kick off list loading immediately at module init so lists are ready
// (or nearly ready) by the time the first user request arrives.
loadListsInBackground();

function refreshLists(): void {
  // Non-blocking — fires and forgets. Checks that use these lists
  // return "warming up" results if lists are not yet loaded.
  if (Date.now() - lists.loadedAt >= LIST_TTL_MS) {
    void loadListsInBackground();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDomain(raw: string): string {
  try {
    const href = raw.startsWith('http') ? raw : `https://${raw}`;
    return new URL(href).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/^www\./, '');
  }
}

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// ── Per-source checks ─────────────────────────────────────────────────────────

type SourceResult = {
  name:    string;
  verdict: 'flagged' | 'clean' | 'whitelisted' | 'unscanned' | 'error' | 'skipped';
  detail:  string;
  icon:    string;
};

function checkMetaMask(domain: string): SourceResult {
  const src = 'MetaMask Blocklist';
  if (!lists.metamask) return { name: src, verdict: 'unscanned', detail: 'List is warming up — try again in a moment', icon: '🦊' };
  if (lists.metamask.whitelist.has(domain))
    return { name: src, verdict: 'whitelisted', detail: 'On MetaMask verified-safe list', icon: '🦊' };
  if (lists.metamask.blacklist.has(domain))
    return { name: src, verdict: 'flagged', detail: 'In MetaMask crypto phishing blocklist (198K+ domains)', icon: '🦊' };
  return { name: src, verdict: 'clean', detail: 'Not in MetaMask phishing list', icon: '🦊' };
}

function checkScamSniffer(domain: string): SourceResult {
  const src = 'ScamSniffer';
  if (!lists.scamsniffer) return { name: src, verdict: 'unscanned', detail: 'List is warming up — try again in a moment', icon: '🕵️' };
  if (lists.scamsniffer.has(domain))
    return { name: src, verdict: 'flagged', detail: 'In ScamSniffer crypto phishing blocklist (345K+ domains)', icon: '🕵️' };
  return { name: src, verdict: 'clean', detail: 'Not in ScamSniffer phishing list', icon: '🕵️' };
}

function checkOpenPhish(rawUrl: string): SourceResult {
  const src = 'OpenPhish';
  if (!lists.openphish) return { name: src, verdict: 'unscanned', detail: 'List is warming up — try again in a moment', icon: '🎣' };
  const match = lists.openphish.some((entry) => rawUrl.toLowerCase().includes(entry.toLowerCase().replace(/^https?:\/\//, '')));
  if (match)
    return { name: src, verdict: 'flagged', detail: 'Matches active phishing URL in OpenPhish feed', icon: '🎣' };
  return { name: src, verdict: 'clean', detail: 'Not in OpenPhish active feed', icon: '🎣' };
}

async function checkGoPlus(rawUrl: string): Promise<SourceResult> {
  const src = 'GoPlus Security';
  try {
    const endpoint = `https://api.gopluslabs.io/api/v1/phishing_site?url=${encodeURIComponent(rawUrl)}`;
    const res = await fetchWithTimeout(endpoint, TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const flagged = json?.result?.phishing_site === 1 || json?.result?.phishing_site === '1';
    const contracts: unknown[] = json?.result?.website_contract_security ?? [];
    const detail = flagged
      ? 'Reported as a phishing site by GoPlus Security'
      : contracts.length
        ? `Clean — ${contracts.length} contract(s) detected on page`
        : 'No phishing signals detected';
    return { name: src, verdict: flagged ? 'flagged' : 'clean', detail, icon: '🛡️' };
  } catch (e) {
    return { name: src, verdict: 'error', detail: `Could not reach GoPlus: ${e instanceof Error ? e.message : 'timeout'}`, icon: '🛡️' };
  }
}

async function checkURLScan(domain: string): Promise<SourceResult> {
  const src = 'URLScan.io';
  try {
    const endpoint = `https://urlscan.io/api/v1/search/?q=page.domain:${encodeURIComponent(domain)}&size=5`;
    const res = await fetchWithTimeout(endpoint, TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const results: any[] = json?.results ?? [];
    if (!results.length)
      return { name: src, verdict: 'unscanned', detail: 'No prior scans found — domain is unverified', icon: '🔬' };

    // Check if any scan verdicts flag it as malicious
    const malicious = results.some(
      (r) => r?.verdicts?.overall?.malicious === true || r?.verdicts?.overall?.score > 50,
    );
    if (malicious)
      return { name: src, verdict: 'flagged', detail: 'Flagged as malicious in URLScan.io security scans', icon: '🔬' };

    const latest = results[0]?.task?.time?.slice(0, 10) ?? 'recently';
    return { name: src, verdict: 'clean', detail: `${results.length} scan(s) found, no malicious verdicts (latest: ${latest})`, icon: '🔬' };
  } catch (e) {
    return { name: src, verdict: 'error', detail: `URLScan unavailable: ${e instanceof Error ? e.message : 'timeout'}`, icon: '🔬' };
  }
}

async function checkGoogleSafeBrowsing(rawUrl: string, key: string): Promise<SourceResult> {
  const src = 'Google Safe Browsing';
  try {
    const postRes = await fetchWithTimeout(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`,
      TIMEOUT_MS,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client:     { clientId: 'almstins', clientVersion: '1.0' },
          threatInfo: {
            threatTypes:      ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
            platformTypes:    ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries:    [{ url: rawUrl }],
          },
        }),
      },
    );
    if (!postRes.ok) throw new Error(`HTTP ${postRes.status}`);
    const json = await postRes.json();
    const matches: unknown[] = json?.matches ?? [];
    if (matches.length)
      return { name: src, verdict: 'flagged', detail: `Google flagged as ${(matches[0] as any)?.threatType ?? 'threat'}`, icon: '🔍' };
    return { name: src, verdict: 'clean', detail: 'No threats found by Google Safe Browsing', icon: '🔍' };
  } catch (e) {
    return { name: src, verdict: 'error', detail: `Google Safe Browsing unavailable`, icon: '🔍' };
  }
}

async function checkVirusTotal(rawUrl: string, key: string): Promise<SourceResult> {
  const src = 'VirusTotal';
  try {
    // Try to get existing analysis by URL ID first (no submission quota used)
    const urlId = Buffer.from(rawUrl).toString('base64url').replace(/=/g, '');
    const res = await fetch(`https://www.virustotal.com/api/v3/urls/${urlId}`, {
      headers: { 'x-apikey': key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 404) {
      // Submit for scanning
      const submitRes = await fetch('https://www.virustotal.com/api/v3/urls', {
        method: 'POST',
        headers: { 'x-apikey': key, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `url=${encodeURIComponent(rawUrl)}`,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!submitRes.ok) throw new Error('VT submit failed');
      return { name: src, verdict: 'unscanned', detail: 'Submitted to VirusTotal — check back shortly for results', icon: '🦠' };
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const stats = json?.data?.attributes?.last_analysis_stats ?? {};
    const malicious  = (stats.malicious ?? 0) + (stats.suspicious ?? 0);
    const total      = Object.values(stats).reduce((s: number, v) => s + Number(v), 0);
    if (malicious > 0)
      return { name: src, verdict: 'flagged', detail: `${malicious}/${total} security engines flagged this URL`, icon: '🦠' };
    return { name: src, verdict: 'clean', detail: `${total} engines scanned — no threats found`, icon: '🦠' };
  } catch (e) {
    return { name: src, verdict: 'error', detail: `VirusTotal unavailable`, icon: '🦠' };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export const GET: APIRoute = async ({ url }) => {
  const rawInput = url.searchParams.get('url')?.trim() ?? '';
  if (!rawInput) {
    return json({ error: true, message: 'url parameter is required' }, 400);
  }

  const phase = url.searchParams.get('phase') ?? 'all';

  // Normalize
  const fullUrl = rawInput.startsWith('http') ? rawInput : `https://${rawInput}`;
  const domain  = extractDomain(fullUrl);

  // Trigger background list refresh (non-blocking — lists may still be loading
  // on first cold-start request; static checkers return "warming up" if so)
  refreshLists();

  // Fast phase: only static in-memory list checks (~instant, no network calls)
  if (phase === 'fast') {
    const sources: SourceResult[] = [
      checkMetaMask(domain),
      checkScamSniffer(domain),
      checkOpenPhish(fullUrl),
    ];
    const anyFlagged  = sources.some((s) => s.verdict === 'flagged');
    const isKnownSafe = sources[0].verdict === 'whitelisted';
    const verdict: 'red' | 'yellow' | 'green' =
      isKnownSafe ? 'green' :
      anyFlagged  ? 'red'   :
      sources.some((s) => s.verdict === 'unscanned') ? 'yellow' :
      'green';
    return new Response(
      JSON.stringify({ url: fullUrl, domain, verdict, sources, vtPending: false }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  // Env-var-gated sources
  const gsb  = (process.env as any).GOOGLE_SAFE_BROWSING_KEY ?? import.meta.env.GOOGLE_SAFE_BROWSING_KEY ?? '';
  const vt   = (process.env as any).VIRUSTOTAL_API_KEY       ?? import.meta.env.VIRUSTOTAL_API_KEY       ?? '';

  // Local phishing DB — runs in parallel with external APIs; short-circuit if hit
  const localDbPromise = checkLocalPhishingDb(domain);

  // Run all checks in parallel
  const [localDbHit, goplusResult, urlscanResult, gsbResult, vtResult] = await Promise.all([
    localDbPromise,
    checkGoPlus(fullUrl),
    checkURLScan(domain),
    gsb  ? checkGoogleSafeBrowsing(fullUrl, gsb) : Promise.resolve<SourceResult>({ name: 'Google Safe Browsing', verdict: 'skipped', detail: 'API key not configured (GOOGLE_SAFE_BROWSING_KEY)', icon: '🔍' }),
    vt   ? checkVirusTotal(fullUrl, vt)           : Promise.resolve<SourceResult>({ name: 'VirusTotal',           verdict: 'skipped', detail: 'API key not configured (VIRUSTOTAL_API_KEY)',       icon: '🦠' }),
  ]);

  // Short-circuit: community-confirmed phishing domain
  if (localDbHit) {
    const localResult: SourceResult = {
      name:    'Almstins Community',
      verdict: 'flagged',
      detail:  'Flagged via community-reported phishing airdrop token',
      icon:    '🚨',
    };
    return new Response(
      JSON.stringify({ url: fullUrl, domain, verdict: 'red', sources: [localResult], vtPending: false }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }

  const sources: SourceResult[] = [
    checkMetaMask(domain),
    checkScamSniffer(domain),
    goplusResult,
    urlscanResult,
    checkOpenPhish(fullUrl),
    gsbResult,
    vtResult,
  ];

  // Overall verdict
  const anyFlagged  = sources.some((s) => s.verdict === 'flagged');
  const anyError    = sources.every((s) => s.verdict === 'error' || s.verdict === 'skipped');
  const isKnownSafe = sources.find((s) => s.name === 'MetaMask Blocklist')?.verdict === 'whitelisted';

  // VT "unscanned" means it was just submitted — not a security signal, don't penalise the verdict
  const vtPending = vtResult.verdict === 'unscanned';
  const unscanned = !anyFlagged && sources.some((s) => s.verdict === 'unscanned' && s.name !== 'VirusTotal');

  const verdict: 'red' | 'yellow' | 'green' =
    isKnownSafe ? 'green' :
    anyFlagged  ? 'red'   :
    anyError || unscanned ? 'yellow' :
    'green';

  return new Response(
    JSON.stringify({ url: fullUrl, domain, verdict, sources, vtPending }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    },
  );
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
