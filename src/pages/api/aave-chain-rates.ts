import type { APIRoute } from 'astro';

/**
 * /api/aave-chain-rates?token=USDC&days=30
 *
 * Uses DeFiLlama's public yields API — no API key required.
 * The Graph hosted service was shut down in June 2024 so the old
 * aave-rates endpoint no longer returns data.
 *
 * Returns historical supply APY + TVL for USDC/USDT/WETH across
 * Ethereum, Polygon, Avalanche, and Arbitrum (Aave V3).
 */

const LLAMA_POOLS_URL  = 'https://yields.llama.fi/pools';
const LLAMA_CHART_BASE = 'https://yields.llama.fi/chart';
const TIMEOUT_MS       = 20_000;

const TARGET_CHAINS = ['Ethereum', 'Polygon', 'Avalanche', 'Arbitrum'] as const;
type TargetChain = typeof TARGET_CHAINS[number];

// DeFiLlama chain name → our key
const CHAIN_KEY: Record<TargetChain, string> = {
  Ethereum: 'ethereum',
  Polygon:  'polygon',
  Avalanche:'avalanche',
  Arbitrum: 'arbitrum',
};

// Simple in-process cache so repeated page loads don't hammer DeFiLlama
let poolsCache: { expiresAt: number; data: LlamaPool[] } | null = null;
const POOLS_TTL_MS = 10 * 60 * 1000; // 10 min

type LlamaPool = {
  pool:    string;   // UUID
  chain:   string;
  project: string;
  symbol:  string;
  apy:     number;
  apyBase: number | null;
  tvlUsd:  number;
};

type ChartPoint = {
  timestamp: string;  // ISO date string
  tvlUsd:    number;
  apy:       number | null;
  apyBase:   number | null;
};

async function fetchPools(): Promise<LlamaPool[]> {
  const now = Date.now();
  if (poolsCache && poolsCache.expiresAt > now) return poolsCache.data;

  const res = await fetchWithTimeout(LLAMA_POOLS_URL, TIMEOUT_MS);
  if (!res.ok) throw new Error(`DeFiLlama pools API returned ${res.status}`);
  const json = await res.json();
  const data = (json.data ?? []) as LlamaPool[];
  poolsCache = { expiresAt: now + POOLS_TTL_MS, data };
  return data;
}

function pickPool(pools: LlamaPool[], chain: string, symbol: string): LlamaPool | undefined {
  // Normalize: USDC.e / USDC-E / USDC should all match "USDC"
  const normalised = symbol.toUpperCase();

  const candidates = pools.filter(
    (p) =>
      p.project === 'aave-v3' &&
      p.chain === chain &&
      p.symbol.toUpperCase().replace(/[^A-Z]/g, '') === normalised.replace(/[^A-Z]/g, ''),
  );

  if (!candidates.length) return undefined;
  // Pick the pool with the highest TVL (most representative market)
  return candidates.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0];
}

async function fetchChartData(poolId: string): Promise<ChartPoint[]> {
  const res = await fetchWithTimeout(`${LLAMA_CHART_BASE}/${poolId}`, TIMEOUT_MS);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data ?? []) as ChartPoint[];
}

export const GET: APIRoute = async ({ url }) => {
  const token = (url.searchParams.get('token') ?? 'USDC').toUpperCase();
  const days   = Math.min(365, Math.max(7, Number(url.searchParams.get('days') ?? '30')));

  try {
    const allPools = await fetchPools();

    // Find one pool per chain for the requested token
    const chainPools = TARGET_CHAINS.map((chain) => ({
      chain,
      key:  CHAIN_KEY[chain],
      pool: pickPool(allPools, chain, token),
    }));

    // Fetch historical chart data for every pool in parallel
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

    const results = await Promise.all(
      chainPools.map(async ({ chain, key, pool }) => {
        if (!pool) {
          return { chain, key, currentApy: null, currentTvlUsd: null, history: [] };
        }

        const chart = await fetchChartData(pool.pool);
        const filtered = chart
          .filter((p) => p.timestamp >= cutoff)
          .map((p) => ({
            date:     p.timestamp.slice(0, 10),
            apy:      p.apyBase ?? p.apy ?? 0,
            tvlUsd:   p.tvlUsd ?? 0,
          }));

        return {
          chain,
          key,
          currentApy:    pool.apy,
          currentTvlUsd: pool.tvlUsd,
          poolId:        pool.pool,
          history:       filtered,
        };
      }),
    );

    return new Response(JSON.stringify({ token, days, chains: results }), {
      status: 200,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[aave-chain-rates]', message);
    return new Response(JSON.stringify({ error: true, message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}
