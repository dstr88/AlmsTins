/**
 * GA4 Data API client
 *
 * Uses a Google Service Account (RS256 JWT) to fetch analytics data
 * without any third-party dependencies — only Node's built-in crypto.
 *
 * Required env vars:
 *   GA4_PROPERTY_ID  — numeric property ID (e.g. "123456789")
 *   GA4_PRIVATE_KEY  — service account private key (PEM, \n-escaped)
 *   GA4_CLIENT_EMAIL — service account email (optional, falls back to constant)
 */

import { createSign } from 'crypto';

const PROPERTY_ID  = process.env.GA4_PROPERTY_ID  ?? '';
const PRIVATE_KEY  = (process.env.GA4_PRIVATE_KEY  ?? '').replace(/\\n/g, '\n');
const CLIENT_EMAIL = process.env.GA4_CLIENT_EMAIL  ?? 'almstins-analytics@almstins.iam.gserviceaccount.com';

// ── Token cache (valid 55 min, re-fetch before the 60-min expiry) ─────────────
let _token: string | null = null;
let _tokenExp = 0;

function b64url(data: string | Buffer): string {
  const b64 = Buffer.isBuffer(data)
    ? data.toString('base64')
    : Buffer.from(data).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_token && now < _tokenExp) return _token;

  if (!PRIVATE_KEY || !CLIENT_EMAIL) {
    throw new Error('GA4_PRIVATE_KEY or GA4_CLIENT_EMAIL not set');
  }

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const sig = b64url(sign.sign(PRIVATE_KEY));
  const jwt = `${header}.${payload}.${sig}`;

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`GA4 token error: ${data.error ?? JSON.stringify(data)}`);

  _token    = data.access_token;
  _tokenExp = now + 3300; // refresh 5 min early
  return _token;
}

// ── Core report runner ────────────────────────────────────────────────────────

interface ReportRow { [key: string]: string | number }

async function runReport(body: object): Promise<ReportRow[]> {
  if (!PROPERTY_ID) return [];
  const token = await getAccessToken();

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  const data = await res.json() as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
    dimensionHeaders?: { name: string }[];
    metricHeaders?:    { name: string }[];
    error?: { message: string };
  };

  if (data.error) {
    console.warn('[ga4] report error:', data.error.message);
    return [];
  }

  const dimNames = (data.dimensionHeaders ?? []).map((h) => h.name);
  const metNames = (data.metricHeaders   ?? []).map((h) => h.name);

  return (data.rows ?? []).map((row) => {
    const out: ReportRow = {};
    dimNames.forEach((n, i) => { out[n] = row.dimensionValues[i]?.value ?? ''; });
    metNames.forEach((n, i) => { out[n] = Number(row.metricValues[i]?.value ?? 0); });
    return out;
  });
}

// ── Public helpers ─────────────────────────────────────────────────────────────

export interface GA4Summary {
  totalUsers:        number;
  newUsers:          number;
  sessions:          number;
  checkerViews:      number;
  loginViews:        number;
  conversionRate:    string;   // e.g. "12.4%"
  topPages:          { page: string; views: number; users: number }[];
  topSources:        { source: string; sessions: number; newUsers: number }[];
  topCountries:      { country: string; sessions: number }[];
  dailySessions:     { date: string; sessions: number }[];
}

export async function getGA4Summary(days = 28): Promise<GA4Summary | null> {
  if (!PROPERTY_ID || !PRIVATE_KEY) return null;

  const dateRange = { startDate: `${days}daysAgo`, endDate: 'today' };

  try {
    const [overview, pages, sources, countries, daily] = await Promise.all([
      // 1 — Overall totals
      runReport({
        dateRanges: [dateRange],
        metrics: [
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'sessions' },
        ],
      }),

      // 2 — Top pages
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: 'pagePath' }],
        metrics:    [{ name: 'screenPageViews' }, { name: 'totalUsers' }],
        orderBys:   [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 10,
      }),

      // 3 — Traffic sources
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: 'sessionSource' }],
        metrics:    [{ name: 'sessions' }, { name: 'newUsers' }],
        orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),

      // 4 — Countries
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: 'country' }],
        metrics:    [{ name: 'sessions' }],
        orderBys:   [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),

      // 5 — Daily sessions (trend)
      runReport({
        dateRanges: [dateRange],
        dimensions: [{ name: 'date' }],
        metrics:    [{ name: 'sessions' }],
        orderBys:   [{ dimension: { dimensionName: 'date' }, desc: false }],
      }),
    ]);

    const tot      = overview[0] ?? {};
    const totalUsers  = Number(tot.totalUsers  ?? 0);
    const newUsers    = Number(tot.newUsers    ?? 0);
    const sessions    = Number(tot.sessions    ?? 0);

    // Pull wallet-checker and login view counts from pages
    const checkerRow = pages.find((r) => String(r.pagePath).includes('/wallet-checker'));
    const loginRow   = pages.find((r) => String(r.pagePath).includes('/login'));
    const checkerViews = Number(checkerRow?.screenPageViews ?? 0);
    const loginViews   = Number(loginRow?.screenPageViews   ?? 0);
    const convRate     = checkerViews > 0
      ? ((loginViews / checkerViews) * 100).toFixed(1) + '%'
      : '—';

    return {
      totalUsers,
      newUsers,
      sessions,
      checkerViews,
      loginViews,
      conversionRate: convRate,
      topPages: pages.map((r) => ({
        page:  String(r.pagePath),
        views: Number(r.screenPageViews),
        users: Number(r.totalUsers),
      })),
      topSources: sources.map((r) => ({
        source:   String(r.sessionSource),
        sessions: Number(r.sessions),
        newUsers: Number(r.newUsers),
      })),
      topCountries: countries.map((r) => ({
        country:  String(r.country),
        sessions: Number(r.sessions),
      })),
      dailySessions: daily.map((r) => ({
        date:     String(r.date),
        sessions: Number(r.sessions),
      })),
    };
  } catch (err) {
    console.warn('[ga4] getGA4Summary failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
