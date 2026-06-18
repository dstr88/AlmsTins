import { db } from '@/lib/db';

let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS known_phishing_domains (
      domain        TEXT PRIMARY KEY,
      source        TEXT NOT NULL DEFAULT 'token_airdrop',
      confirmed_at  TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))
    )
  `);
  tableReady = true;
}

// URL shorteners whose domains should not be added to the phishing list —
// they're delivery mechanisms, not the phishing sites themselves.
const URL_SHORTENERS = new Set(['t.me', 't.ly', 'fli.so', 'bit.ly', 'tinyurl.com']);

/**
 * Extract phishing domains from a spam token name/symbol.
 * Spam airdrops embed their drainer URL directly in the token name,
 * e.g. "VISIT TRUSTBOX.SITE TO CLAIM" → ["trustbox.site"]
 */
export function extractSpamDomains(symbol: string, name?: string | null): string[] {
  const text = `${symbol} ${name ?? ''}`.toLowerCase();
  const regex = /(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]*\.[a-z]{2,}(?:\.[a-z]{2,})?)/g;
  const domains = new Set<string>();
  for (const match of text.matchAll(regex)) {
    const domain = match[1].replace(/^www\./, '');
    if (!URL_SHORTENERS.has(domain)) {
      domains.add(domain);
    }
  }
  return [...domains];
}

/**
 * Persist phishing domains to the DB. Fire-and-forget — caller does not await.
 * Uses ON CONFLICT DO NOTHING so duplicates are silently skipped.
 * Newly added domains are reported to VirusTotal and URLScan in the background.
 */
export async function savePhishingDomains(
  domains: string[],
  source = 'token_airdrop',
): Promise<void> {
  if (!domains.length) return;
  try {
    await ensureTable();

    // Identify which domains are truly new (not already in DB)
    const existing = await db.execute({
      sql: `SELECT domain FROM known_phishing_domains WHERE domain IN (${domains.map(() => '?').join(',')})`,
      args: domains,
    });
    const existingSet = new Set(
      (existing.rows as unknown as { domain: string }[]).map((r) => r.domain),
    );
    const newDomains = domains.filter((d) => !existingSet.has(d));

    await db.batch(
      domains.map((domain) => ({
        sql: `INSERT INTO known_phishing_domains (domain, source) VALUES (?, ?)
ON CONFLICT DO NOTHING`,
        args: [domain, source],
      })),
    );

    // Report only genuinely new domains upstream — no point re-submitting known ones
    if (newDomains.length) void reportToExternalDbs(newDomains);
  } catch {
    // Non-fatal — phishing DB enrichment should never break the main flow
  }
}

/**
 * Submit newly discovered phishing domains to external security databases.
 * VirusTotal (VIRUSTOTAL_API_KEY) and URLScan.io (URLSCAN_API_KEY) are supported.
 * Both are opt-in via env vars and entirely non-fatal.
 */
async function reportToExternalDbs(domains: string[]): Promise<void> {
  const vtKey      = ((process.env as Record<string, string>).VIRUSTOTAL_API_KEY  ?? '') as string;
  const urlscanKey = ((process.env as Record<string, string>).URLSCAN_API_KEY     ?? '') as string;
  if (!vtKey && !urlscanKey) return;

  for (const domain of domains) {
    const fullUrl = `https://${domain}`;

    // VirusTotal — check first, submit only if not yet analyzed (saves quota)
    if (vtKey) {
      try {
        const urlId = Buffer.from(fullUrl).toString('base64url').replace(/=/g, '');
        const check = await fetch(`https://www.virustotal.com/api/v3/urls/${urlId}`, {
          headers: { 'x-apikey': vtKey },
          signal: AbortSignal.timeout(8_000),
        });
        if (check.status === 404) {
          await fetch('https://www.virustotal.com/api/v3/urls', {
            method: 'POST',
            headers: { 'x-apikey': vtKey, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `url=${encodeURIComponent(fullUrl)}`,
            signal: AbortSignal.timeout(8_000),
          });
        }
      } catch { /* non-fatal */ }
    }

    // URLScan.io — submit for public scan (requires URLSCAN_API_KEY)
    if (urlscanKey) {
      try {
        await fetch('https://urlscan.io/api/v1/scan/', {
          method: 'POST',
          headers: { 'API-Key': urlscanKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: fullUrl, visibility: 'public' }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch { /* non-fatal */ }
    }
  }
}

/**
 * Check whether a domain is in the local phishing database.
 * Returns the matching row or null.
 */
export async function checkLocalPhishingDb(
  domain: string,
): Promise<{ domain: string; source: string } | null> {
  try {
    await ensureTable();
    const res = await db.execute({
      sql: `SELECT domain, source FROM known_phishing_domains WHERE domain = ? LIMIT 1`,
      args: [domain.toLowerCase()],
    });
    if (!res.rows.length) return null;
    const row = res.rows[0] as unknown as { domain: string; source: string };
    return row;
  } catch {
    return null;
  }
}

/**
 * Scan all wallet snapshots for spam token names, extract domains,
 * and populate known_phishing_domains. Run once via the admin seed endpoint.
 */
export async function seedPhishingDomainsFromSnapshots(): Promise<{
  tokensScanned: number;
  domainsFound: number;
  domainsInserted: number;
}> {
  const { isSpamToken } = await import('@/lib/knownContracts');

  const snaps = await db.execute({
    sql: `SELECT DISTINCT payload_json FROM wallet_snapshots WHERE payload_json IS NOT NULL`,
    args: [],
  });

  let tokensScanned = 0;
  const allDomains = new Set<string>();

  for (const row of snaps.rows as unknown as { payload_json: string }[]) {
    let tokens: Array<{ symbol?: string; name?: string }> = [];
    try { tokens = JSON.parse(row.payload_json); } catch { continue; }
    if (!Array.isArray(tokens)) continue;

    for (const t of tokens) {
      const sym = (t.symbol ?? '').toString().trim();
      if (!sym) continue;
      tokensScanned++;
      if (!isSpamToken(sym, t.name ?? null)) continue;
      for (const d of extractSpamDomains(sym, t.name ?? null)) {
        allDomains.add(d);
      }
    }
  }

  const domains = [...allDomains];
  await savePhishingDomains(domains, 'token_airdrop_seed');

  return { tokensScanned, domainsFound: domains.length, domainsInserted: domains.length };
}
