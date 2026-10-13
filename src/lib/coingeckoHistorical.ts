import { getCache, setCache } from '@/lib/tursoCache';

const BASE_URL = 'https://api.coingecko.com/api/v3';
const env = process.env;
const apiKey = env.COINGECKO_API_KEY;
const headers = apiKey ? { 'x-cg-pro-api-key': apiKey } : undefined;

// ────────────────────────────────────────────────
// Cache / rate-limit settings
// ────────────────────────────────────────────────

const COINS_LIST_KEY = 'coingecko:coins:list';
const COINS_TURSO_TTL = 24 * 60 * 60; // 1 day
const COINS_MEM_TTL = 10 * 60;        // 10 min

const HISTORY_TURSO_TTL = 90 * 24 * 60 * 60; // 90 days
const HISTORY_MEM_TTL = 10 * 60;             // 10 min

const memoryCache = new Map<string, { expiresAt: number; payload: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

const getMem = (key: string) => {
  const v = memoryCache.get(key);
  return v && v.expiresAt > Date.now() ? v.payload : null;
};

const setMem = (key: string, payload: unknown, ttlSec: number) => {
  memoryCache.set(key, { expiresAt: Date.now() + ttlSec * 1000, payload });
};

async function fetchJson(url: string, headersOverride?: Record<string, string>) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', ...(headersOverride ?? {}) },
  });

  const text = await res.text();

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = new Error(`CoinGecko HTTP ${res.status}`);
    (err as any).status = res.status;
    (err as any).body = json ?? text;
    throw err;
  }

  return json;
}

// ────────────────────────────────────────────────
// Symbol → CoinGecko ID resolver
// ────────────────────────────────────────────────

/**
 * You MUST have overrides for ambiguous symbols (especially "POL", "TON", etc.).
 * Adjust this map as you discover mismatches.
 */
const SYMBOL_OVERRIDES: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  POL: 'polygon-ecosystem-token', // CoinGecko uses POL for this asset now
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  USDC: 'usd-coin',
  USDT: 'tether',
  DAI: 'dai',
  WBTC: 'wrapped-bitcoin',
  WETH: 'weth',
};

type CoinListRow = { id: string; symbol: string; name: string };

async function getCoinsList(): Promise<CoinListRow[]> {
  const mem = getMem(COINS_LIST_KEY) as CoinListRow[] | null;
  if (mem) return mem;

  const cached = await getCache<CoinListRow[]>(COINS_LIST_KEY);
  if (cached) {
    setMem(COINS_LIST_KEY, cached, COINS_MEM_TTL);
    return cached;
  }

  const existing = inflight.get(COINS_LIST_KEY);
  if (existing) return (await existing) as CoinListRow[];

  const promise = (async () => {
    const url = `${BASE_URL}/coins/list?include_platform=false`;
    const payload = await fetchJson(url, headers);
    if (!Array.isArray(payload)) throw new Error('CoinGecko coins list payload invalid');

    const list = payload
      .map((c: any) => ({
        id: String(c.id ?? ''),
        symbol: String(c.symbol ?? ''),
        name: String(c.name ?? ''),
      }))
      .filter((c: CoinListRow) => c.id && c.symbol);

    setMem(COINS_LIST_KEY, list, COINS_MEM_TTL);
    await setCache(COINS_LIST_KEY, list, COINS_TURSO_TTL);
    return list;
  })();

  inflight.set(COINS_LIST_KEY, promise);
  try {
    return (await promise) as CoinListRow[];
  } finally {
    inflight.delete(COINS_LIST_KEY);
  }
}

export async function getCoingeckoIdBySymbol(symbolRaw: string): Promise<string | null> {
  const symbol = (symbolRaw ?? '').trim().toUpperCase();
  if (!symbol) return null;

  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];

  // Fallback: search the /coins/list by symbol (can be ambiguous!)
  // This is “best effort”; you should add overrides for anything wrong.
  const list = await getCoinsList();
  const matches = list.filter((c) => c.symbol.toUpperCase() === symbol);

  if (!matches.length) return null;

  // Prefer the first match to keep deterministic behavior.
  // If you find a mismatch, add SYMBOL_OVERRIDES.
  return matches[0].id;
}

// ────────────────────────────────────────────────
// Historical day price
// ────────────────────────────────────────────────

export type HistoricalPriceResult = {
  unitPriceUsd: number;
  pricedAtIso: string;
  source: 'coingecko:range' | 'coingecko:history';
  confidence: 'historical';
};

type HistoryPayload = {
  market_data?: {
    current_price?: { usd?: number };
  };
};

type RangePayload = {
  prices?: Array<[number, number]>;
};

function isPublic365DayLimit(err: any) {
  const status = err?.status;
  const code = err?.body?.error?.status?.error_code ?? err?.body?.error_code;
  const msg =
    err?.body?.error?.status?.error_message ??
    err?.body?.error?.error_message ??
    err?.message ??
    '';

  return (
    status === 401 &&
    (code === 10012 ||
      String(msg).toLowerCase().includes('past 365 days') ||
      String(msg).toLowerCase().includes('allowed time range'))
  );
}

const pickNearestPrice = (prices: Array<[number, number]>, targetMs: number) => {
  let best: { ts: number; price: number; dist: number } | null = null;
  for (const [ts, price] of prices) {
    if (!Number.isFinite(ts) || !Number.isFinite(price)) continue;
    const dist = Math.abs(ts - targetMs);
    if (!best || dist < best.dist) best = { ts, price, dist };
  }
  return best;
};

const formatDdMmYyyy = (d: Date) => {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return { dd, mm, yyyy, dateParam: `${dd}-${mm}-${yyyy}` };
};

const getRangeKey = (coinId: string, yyyy: string, mm: string, dd: string, hour: string) =>
  `coingecko:range:${coinId}:${yyyy}-${mm}-${dd}T${hour}`;

const getHistoryKey = (coinId: string, yyyy: string, mm: string, dd: string) =>
  `coingecko:history:${coinId}:${yyyy}-${mm}-${dd}`;

const getRangeWindow = (targetMs: number) => {
  const sixHoursMs = 6 * 60 * 60 * 1000;
  return { fromSec: Math.floor((targetMs - sixHoursMs) / 1000), toSec: Math.floor((targetMs + sixHoursMs) / 1000) };
};

const getRangePrice = async (opts: {
  coinId: string;
  timestampUtcIso: string;
}): Promise<HistoricalPriceResult | null> => {
  const d = new Date(opts.timestampUtcIso);
  if (Number.isNaN(d.getTime())) return null;

  const { dd, mm, yyyy } = formatDdMmYyyy(d);
  const hour = String(d.getUTCHours()).padStart(2, '0');
  const cacheKey = getRangeKey(opts.coinId, yyyy, mm, dd, hour);
  const targetMs = d.getTime();

  const mem = getMem(cacheKey) as RangePayload | null;
  if (mem?.prices?.length) {
    const best = pickNearestPrice(mem.prices, targetMs);
    if (best && best.price > 0) {
      return {
        unitPriceUsd: best.price,
        pricedAtIso: new Date(best.ts).toISOString(),
        source: 'coingecko:range',
        confidence: 'historical',
      };
    }
    return null;
  }

  const cached = await getCache<RangePayload>(cacheKey);
  if (cached) {
    setMem(cacheKey, cached, HISTORY_MEM_TTL);
    const best = cached.prices ? pickNearestPrice(cached.prices, targetMs) : null;
    if (best && best.price > 0) {
      return {
        unitPriceUsd: best.price,
        pricedAtIso: new Date(best.ts).toISOString(),
        source: 'coingecko:range',
        confidence: 'historical',
      };
    }
    return null;
  }

  const existing = inflight.get(cacheKey);
  if (existing) {
    const payload = (await existing) as RangePayload | null;
    const best = payload?.prices ? pickNearestPrice(payload.prices, targetMs) : null;
    if (best && best.price > 0) {
      return {
        unitPriceUsd: best.price,
        pricedAtIso: new Date(best.ts).toISOString(),
        source: 'coingecko:range',
        confidence: 'historical',
      };
    }
    return null;
  }

  const promise = (async () => {
    const { fromSec, toSec } = getRangeWindow(targetMs);
    const url = `${BASE_URL}/coins/${encodeURIComponent(
      opts.coinId,
    )}/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`;
    try {
      const payload = (await fetchJson(url, headers)) as RangePayload;
      setMem(cacheKey, payload, HISTORY_MEM_TTL);
      await setCache(cacheKey, payload, HISTORY_TURSO_TTL);
      return payload;
    } catch (err) {
      if (isPublic365DayLimit(err)) return null;
      const status = (err as any)?.status;
      if (status === 401 || status === 403 || status === 429) return null;
      throw err;
    }
  })();

  inflight.set(cacheKey, promise);
  try {
    const payload = (await promise) as RangePayload | null;
    const best = payload?.prices ? pickNearestPrice(payload.prices, targetMs) : null;
    if (best && best.price > 0) {
      return {
        unitPriceUsd: best.price,
        pricedAtIso: new Date(best.ts).toISOString(),
        source: 'coingecko:range',
        confidence: 'historical',
      };
    }
    return null;
  } finally {
    inflight.delete(cacheKey);
  }
};

const getHistoryPrice = async (opts: {
  coinId: string;
  timestampUtcIso: string;
}): Promise<HistoricalPriceResult | null> => {
  const d = new Date(opts.timestampUtcIso);
  if (Number.isNaN(d.getTime())) return null;

  const { dd, mm, yyyy, dateParam } = formatDdMmYyyy(d);
  const cacheKey = getHistoryKey(opts.coinId, yyyy, mm, dd);

  const mem = getMem(cacheKey) as HistoryPayload | null;
  if (mem) {
    const p = mem.market_data?.current_price?.usd;
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      return {
        unitPriceUsd: p,
        pricedAtIso: d.toISOString(),
        source: 'coingecko:history',
        confidence: 'historical',
      };
    }
    return null;
  }

  const cached = await getCache<HistoryPayload>(cacheKey);
  if (cached) {
    setMem(cacheKey, cached, HISTORY_MEM_TTL);
    const p = cached.market_data?.current_price?.usd;
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      return {
        unitPriceUsd: p,
        pricedAtIso: d.toISOString(),
        source: 'coingecko:history',
        confidence: 'historical',
      };
    }
    return null;
  }

  const existing = inflight.get(cacheKey);
  if (existing) {
    const payload = (await existing) as HistoryPayload | null;
    const p = payload?.market_data?.current_price?.usd;
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      return {
        unitPriceUsd: p,
        pricedAtIso: d.toISOString(),
        source: 'coingecko:history',
        confidence: 'historical',
      };
    }
    return null;
  }

  const promise = (async () => {
    const url = `${BASE_URL}/coins/${encodeURIComponent(opts.coinId)}/history?date=${encodeURIComponent(
      dateParam,
    )}&localization=false`;
    try {
      const payload = (await fetchJson(url, headers)) as HistoryPayload;
      setMem(cacheKey, payload, HISTORY_MEM_TTL);
      await setCache(cacheKey, payload, HISTORY_TURSO_TTL);
      return payload;
    } catch (err) {
      if (isPublic365DayLimit(err)) return null;
      const status = (err as any)?.status;
      if (status === 401 || status === 403 || status === 429) return null;
      throw err;
    }
  })();

  inflight.set(cacheKey, promise);
  try {
    const payload = (await promise) as HistoryPayload | null;
    const p = payload?.market_data?.current_price?.usd;
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      return {
        unitPriceUsd: p,
        pricedAtIso: d.toISOString(),
        source: 'coingecko:history',
        confidence: 'historical',
      };
    }
    return null;
  } finally {
    inflight.delete(cacheKey);
  }
};

/**
 * CoinGecko range endpoint preferred; history is fallback.
 * Returns null for known “can’t price” cases.
 */
export async function getUsdUnitPriceAtTimestampCoinGecko(opts: {
  coinId: string;
  timestampUtcIso: string;
}): Promise<HistoricalPriceResult | null> {
  const now = Date.now();
  const ts = Date.parse(opts.timestampUtcIso);
  const days365 = 365 * 24 * 60 * 60 * 1000;

  if (!apiKey && Number.isFinite(ts) && now - ts > days365) {
    // Public CoinGecko API only allows historical queries within 365 days.
    // Older timestamps require a paid plan.
    // Public plan cannot access this range.
    return null;
  }

  const range = await getRangePrice(opts);
  if (range) return range;

  try {
    return await getHistoryPrice(opts);
  } catch (e) {
    if (isPublic365DayLimit(e)) return null;
    const status = (e as any)?.status;
    if (status === 401 || status === 403 || status === 429) return null;
    throw e;
  }
}
