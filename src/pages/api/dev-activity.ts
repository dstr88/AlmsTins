import type { APIRoute } from 'astro';

/**
 * /api/dev-activity
 *
 * Returns 52 weeks of commit activity for Ethereum, Polygon, Avalanche,
 * and Arbitrum by summing GitHub participation stats across each chain's
 * canonical core repos.
 *
 * Uses the public GitHub API — no key required (60 req/hr unauthenticated).
 * Responses are cached server-side for 1 hour to stay well within limits.
 *
 * GitHub endpoint used:
 *   GET /repos/{owner}/{repo}/stats/participation
 *   → { all: number[52], owner: number[52] }
 *   Each value is the weekly commit count; index 0 = 51 weeks ago, 51 = current week.
 */

const GITHUB_API = 'https://api.github.com';
const TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

type ChainDef = {
  key:   string;
  label: string;
  color: string;
  repos: string[]; // "owner/repo"
};

const CHAINS: ChainDef[] = [
  {
    key:   'ethereum',
    label: 'Ethereum',
    color: '#627eea',
    repos: [
      'ethereum/go-ethereum',
      'ethereum/consensus-specs',
      'ethereum/EIPs',
    ],
  },
  {
    key:   'polygon',
    label: 'Polygon',
    color: '#8247e5',
    repos: [
      'maticnetwork/bor',
      '0xPolygon/polygon-edge',
      '0xPolygon/heimdall',
    ],
  },
  {
    key:   'avalanche',
    label: 'Avalanche',
    color: '#e84142',
    repos: [
      'ava-labs/avalanchego',
      'ava-labs/coreth',
      'ava-labs/subnet-evm',
    ],
  },
  {
    key:   'arbitrum',
    label: 'Arbitrum',
    color: '#28a0f0',
    repos: [
      'OffchainLabs/nitro',
      'OffchainLabs/bold',
      'OffchainLabs/arbitrum-classic',
    ],
  },
];

// ── In-process cache ──────────────────────────────────────────────────────────
type CacheEntry = { expiresAt: number; payload: unknown };
let cache: CacheEntry | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchParticipation(ownerRepo: string): Promise<number[]> {
  const url = `${GITHUB_API}/repos/${ownerRepo}/stats/participation`;
  const res  = await fetchWithTimeout(url, TIMEOUT_MS);

  // GitHub returns 202 while computing stats — treat as empty for this request
  if (res.status === 202 || res.status === 204) return new Array(52).fill(0);
  if (!res.ok) return new Array(52).fill(0);

  const json = await res.json();
  const all  = json?.all;
  if (!Array.isArray(all) || all.length !== 52) return new Array(52).fill(0);
  return all as number[];
}

function sumWeeks(arrays: number[][]): number[] {
  const result = new Array(52).fill(0);
  for (const arr of arrays) {
    for (let i = 0; i < 52; i++) {
      result[i] += arr[i] ?? 0;
    }
  }
  return result;
}

function buildWeekLabels(): string[] {
  const labels: string[] = [];
  const now = new Date();
  // Start from 51 weeks ago (index 0) up to current week (index 51)
  for (let i = 51; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    labels.push(
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    );
  }
  return labels;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept:     'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } finally {
    clearTimeout(id);
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export const GET: APIRoute = async () => {
  // Serve from cache if fresh
  if (cache && cache.expiresAt > Date.now()) {
    return new Response(JSON.stringify(cache.payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });
  }

  try {
    // Fetch all repos for all chains in parallel
    const chainResults = await Promise.all(
      CHAINS.map(async (chain) => {
        const repoWeeks = await Promise.all(
          chain.repos.map((repo) => fetchParticipation(repo)),
        );
        const weekly = sumWeeks(repoWeeks);
        const recent = weekly.slice(-12); // last 12 weeks for trend
        const total  = weekly.reduce((s, v) => s + v, 0);
        const currentWeek = weekly[51] ?? 0;
        const prevWeek    = weekly[50] ?? 0;
        const trend       = prevWeek > 0
          ? Math.round(((currentWeek - prevWeek) / prevWeek) * 100)
          : 0;

        return {
          key:         chain.key,
          label:       chain.label,
          color:       chain.color,
          repos:       chain.repos,
          weekly,      // full 52-week series
          recentWeeks: recent,
          currentWeek,
          trend,       // % change vs prior week
          totalYear:   total,
        };
      }),
    );

    const payload = {
      weekLabels:  buildWeekLabels(),
      chains:      chainResults,
      generatedAt: new Date().toISOString(),
    };

    cache = { expiresAt: Date.now() + CACHE_TTL_MS, payload };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[dev-activity]', message);
    return new Response(JSON.stringify({ error: true, message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
