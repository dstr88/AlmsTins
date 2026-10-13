// AlmsTins Load Test — k6
//
// Install k6: brew install k6
// Run:        k6 run -e SESSION_COOKIE=<cookie value> load-test.js
// Public only: k6 run -e PUBLIC_ONLY=1 load-test.js
//
// Before running the authenticated scenario:
//   1. Log into almstins.com in your browser
//   2. Open DevTools → Application → Cookies
//   3. Copy the value of the session cookie (usually named "__Secure-authjs.session-token")
//   4. Pass it on the command line with -e SESSION_COOKIE=... (never paste it into this file)

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://almstins.com';

// Session cookie for the authenticated scenario, read from the environment (k6 -e).
// Never commit a cookie value to this file.
const SESSION_COOKIE = __ENV.SESSION_COOKIE || '';
const PUBLIC_ONLY = __ENV.PUBLIC_ONLY === '1';

if (!SESSION_COOKIE && !PUBLIC_ONLY) {
  throw new Error(
    'SESSION_COOKIE is not set. Run: k6 run -e SESSION_COOKIE=<cookie value> load-test.js ' +
    '(or -e PUBLIC_ONLY=1 to run only the public scenario).',
  );
}

// ── Custom metrics ────────────────────────────────────────────────────────────

const coldStartTrend  = new Trend('cold_start_ms');
const portfolioTrend  = new Trend('portfolio_ms');
const needsAttTrend   = new Trend('needs_attention_ms');
const diagnosticsTrend = new Trend('diagnostics_ms');
const networthTrend   = new Trend('networth_ms');
const errorRate       = new Rate('errors');

// ── Test scenarios ────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    // Scenario 1 — public pages, no auth required
    public: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5  },  // ramp up
        { duration: '60s', target: 5  },  // hold
        { duration: '15s', target: 0  },  // ramp down
      ],
      tags: { scenario: 'public' },
    },

    // Scenario 2 — authenticated API endpoints
    // Needs -e SESSION_COOKIE=...; left out entirely with -e PUBLIC_ONLY=1
    ...(SESSION_COOKIE ? { authenticated: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 3  },
        { duration: '90s', target: 3  },
        { duration: '15s', target: 0  },
      ],
      tags: { scenario: 'authenticated' },
      exec: 'authenticatedScenario',
    } } : {}),
  },

  thresholds: {
    http_req_duration:  ['p(95)<3000'],   // 95% of requests under 3s
    errors:             ['rate<0.05'],    // less than 5% errors
    portfolio_ms:       ['p(95)<5000'],
    needs_attention_ms: ['p(95)<4000'],
  },
};

// ── Scenario 1: Public ────────────────────────────────────────────────────────

export default function () {
  // Landing page — measures cold start on first hit
  const loginRes = http.get(`${BASE_URL}/login`, { tags: { name: 'login_page' } });
  const loginOk = check(loginRes, { 'login page 200': (r) => r.status === 200 });
  errorRate.add(!loginOk);
  coldStartTrend.add(loginRes.timings.duration);

  sleep(1);
}

// ── Scenario 2: Authenticated ─────────────────────────────────────────────────

export function authenticatedScenario() {
  if (!SESSION_COOKIE) {
    return; // no cookie set, so skip the authenticated scenario
  }

  const headers = {
    Cookie: `__Secure-authjs.session-token=${SESSION_COOKIE}`,
    'Content-Type': 'application/json',
  };

  // Networth summary (vault hero figure)
  const nwRes = http.get(`${BASE_URL}/api/networth/summary`, { headers, tags: { name: 'networth_summary' } });
  check(nwRes, { 'networth 200': (r) => r.status === 200 });
  networthTrend.add(nwRes.timings.duration);
  errorRate.add(nwRes.status !== 200);
  sleep(0.5);

  // Portfolio performance (heaviest endpoint)
  const pfRes = http.get(`${BASE_URL}/api/portfolio/performance`, { headers, tags: { name: 'portfolio_performance' } });
  check(pfRes, { 'portfolio 200': (r) => r.status === 200 });
  portfolioTrend.add(pfRes.timings.duration);
  errorRate.add(pfRes.status !== 200);
  sleep(0.5);

  // Needs attention
  const naRes = http.get(`${BASE_URL}/api/research/needs-attention`, { headers, tags: { name: 'needs_attention' } });
  check(naRes, {
    'needs-attention 200': (r) => r.status === 200,
    'needs-attention cached': (r) => {
      try { return JSON.parse(r.body).cached === true; } catch { return false; }
    },
  });
  needsAttTrend.add(naRes.timings.duration);
  errorRate.add(naRes.status !== 200);
  sleep(0.5);

  // Diagnostics (11 parallel SQL queries)
  const diagRes = http.get(`${BASE_URL}/api/research/diagnostics`, { headers, tags: { name: 'diagnostics' } });
  check(diagRes, { 'diagnostics 200': (r) => r.status === 200 });
  diagnosticsTrend.add(diagRes.timings.duration);
  errorRate.add(diagRes.status !== 200);

  sleep(2);
}
