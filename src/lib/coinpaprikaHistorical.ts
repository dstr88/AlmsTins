import { getCache, setCache } from '@/lib/tursoCache';

const BASE_URL = 'https://api.coinpaprika.com/v1';

const COINS_KEY = 'coinpaprika:coins:list';
const COINS_TURSO_TTL = 24 * 60 * 60;
const COINS_MEM_TTL = 10 * 60;

const OHLC_TURSO_TTL = 90 * 24 * 60 * 60;
const OHLC_MEM_TTL = 10 * 60;

const memoryCache = new Map<string, { expiresAt: number; payload: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

const getMem = (key: string) => {
  const v = memoryCache.get(key);
  return v && v.expiresAt > Date.now() ? v.payload : null;
};

const setMem = (key: string, payload: unknown, ttlSec: number) => {
  memoryCache.set(key, { expiresAt: Date.now() + ttlSec * 1000, payload });
};

const SYMBOL_OVERRIDES: Record<string, string> = {
  ETH: 'eth-ethereum',
  BTC: 'btc-bitcoin',
  POL: 'matic-polygon',
};

type CoinRow = { id: string; symbol: string; is_active: boolean };

type OhlcRow = {
  time_open: string;
  time_close: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  market_cap: number;
};

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Coinpaprika HTTP ${res.status}`);
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

export async function getCoinIdBySymbol(symbolRaw: string): Promise<string | null> {
  const symbol = symbolRaw.toUpperCase();
  if (SYMBOL_OVERRIDES[symbol]) return SYMBOL_OVERRIDES[symbol];

  const mem = getMem(COINS_KEY) as CoinRow[] | null;
  let coins = mem;

  if (!coins) {
    const cached = await getCache<CoinRow[]>(COINS_KEY);
    if (cached) {
      coins = cached;
      setMem(COINS_KEY, coins, COINS_MEM_TTL);
    }
  }

  if (!coins) {
    const existing = inflight.get(COINS_KEY);
    if (existing) {
      coins = (await existing) as CoinRow[];
    } else {
      const promise = (async () => {
        const payload = await fetchJson(`${BASE_URL}/coins`);
        if (!Array.isArray(payload)) throw new Error('Coin list payload invalid');

        const list = payload
          .map((c: any) => ({
            id: String(c.id),
            symbol: String(c.symbol),
            is_active: Boolean(c.is_active),
          }))
          .filter((c: CoinRow) => c.id && c.symbol);

        setMem(COINS_KEY, list, COINS_MEM_TTL);
        await setCache(COINS_KEY, list, COINS_TURSO_TTL);
        return list;
      })();

      inflight.set(COINS_KEY, promise);
      try {
        coins = (await promise) as CoinRow[];
      } finally {
        inflight.delete(COINS_KEY);
      }
    }
  }

  const match = coins.find((c) => c.is_active && c.symbol.toUpperCase() === symbol);
  return match?.id ?? null;
}

async function tryOhlc(
  coinId: string,
  day: string,
  interval: '1h' | '1d',
  cacheKey: string,
): Promise<OhlcRow[] | null> {
  // mem
  const mem = getMem(cacheKey) as OhlcRow[] | null;
  if (mem) return mem;

  // turso
  const cached = await getCache<OhlcRow[]>(cacheKey);
  if (cached) {
    setMem(cacheKey, cached, OHLC_MEM_TTL);
    return cached;
  }

  // inflight
  const existing = inflight.get(cacheKey);
  if (existing) return (await existing) as OhlcRow[];

  const promise = (async () => {
    const start = `${day}T00:00:00Z`;
    const end = `${day}T23:59:59Z`;
    const url = `${BASE_URL}/coins/${encodeURIComponent(coinId)}/ohlcv/historical?start=${encodeURIComponent(
      start,
    )}&end=${encodeURIComponent(end)}&interval=${encodeURIComponent(interval)}`;

    try {
      const payload = await fetchJson(url);
      if (!Array.isArray(payload) || payload.length === 0) return null;

      setMem(cacheKey, payload, OHLC_MEM_TTL);
      await setCache(cacheKey, payload, OHLC_TURSO_TTL);
      return payload as OhlcRow[];
    } catch (e: any) {
      // 402 = paywall / plan / credits (don’t crash the job)
      if (e?.status === 402) return null;
      throw e;
    }
  })();

  inflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(cacheKey);
  }
}

export async function getUsdUnitPriceAtTimestamp(opts: {
  coinId: string;
  timestampUtcIso: string;
  interval?: '1d' | '1h';
}): Promise<{ unitPriceUsd: number; pricedAtIso: string; confidence: 'historical' } | null> {
  const requested = opts.interval ?? '1d';

  const d = new Date(opts.timestampUtcIso);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid timestamp');

  const day = d.toISOString().slice(0, 10);

  // Try requested interval first, but auto-fallback from 1h → 1d if paywalled
  const intervals: Array<'1h' | '1d'> = requested === '1h' ? ['1h', '1d'] : ['1d'];

  for (const interval of intervals) {
    const cacheKey = `coinpaprika:ohlc:${opts.coinId}:${interval}:${day}`;
    const rows = await tryOhlc(opts.coinId, day, interval, cacheKey);
    if (!rows?.length) continue;

    const row = rows[0];
    return {
      unitPriceUsd: row.close,
      pricedAtIso: row.time_close,
      confidence: 'historical',
    };
  }

  return null; // can't price this (paywall, missing candle, etc.)
}
