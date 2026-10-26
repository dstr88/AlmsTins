/**
 * What the wallets hold right now, read the same way the Portfolio page reads it.
 *
 * Lifecycle records drift from real balances wherever a transaction is missing or a transfer is
 * unmatched, so a page that decides "held" from them alone gets it wrong. The Portfolio page
 * (src/pages/api/portfolio/performance.ts) already has the better answer: the latest wallet
 * snapshot per (wallet, chain), spam skipped, plus Aave supply positions, with anything under $1
 * hidden. This module gives other pages that same set without touching that endpoint.
 *
 * Aave is the slow part. Tokens supplied to Aave sit in the pool contract, so wallet snapshots never
 * see them; only the Aave API does, at about three sequential requests per EVM wallet. getHeldNow
 * therefore never waits on Aave for more than a moment: a per-tenant cache is filled by a background
 * refresh, a caller waits briefly for a refresh in flight, and otherwise uses the last good answer.
 */
import { db } from '@/lib/db';
import { getAavePositionsForWallet, type AaveChainSummary, type AavePositionsResponse } from '@/lib/aave/client';
import { aaveSymbolUsdPrice } from '@/lib/aave/pricing';
import { isSpamToken } from './knownContracts';
import { EVM_ADDRESS_ANY_PREFIX } from '@/lib/addressFormats';
import { currentCoinSymbol } from '@/lib/chains';

export type HeldQty = { qty: number; valueUsd: number | null };
/** Keyed by UPPERCASE symbol. */
export type HeldNow = Map<string, HeldQty>;

/** The Portfolio page's dust floor (MIN_VALUE_USD in src/pages/api/portfolio/performance.ts). Keep in sync. */
export const MIN_HELD_VALUE_USD = 1;

/** Keep in sync with src/pages/api/portfolio/performance.ts (WBTC and WETH stay as they are). */
export const AAVE_SYMBOL_NORMALIZE: Record<string, string> = { WPOL: 'POL', WMATIC: 'POL', WAVAX: 'AVAX' };

/** A finite number from whatever the payload carried; missing or unreadable values count as 0. */
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pure. Sums quantity and value per uppercase symbol across snapshot payload_json strings, the way the
 * Portfolio page does: spam symbols skipped, entries with neither a quantity nor a value skipped,
 * unreadable or non-array payloads ignored. Does NOT apply the dust floor.
 */
export function parseSnapshotHoldings(payloads: Array<string | null | undefined>): HeldNow {
  const out: HeldNow = new Map();
  for (const payload of payloads) {
    if (payload == null) continue;
    let tokens: unknown;
    try {
      tokens = JSON.parse(String(payload));
    } catch {
      continue;
    }
    if (!Array.isArray(tokens)) continue;
    for (const t of tokens) {
      if (!t || typeof t !== 'object') continue;
      const sym = currentCoinSymbol(String(t.symbol ?? '').trim().toUpperCase());
      if (!sym || isSpamToken(sym)) continue;
      const qty = num(t.amount);
      const valueUsd = num(t.valueUsd);
      if (qty <= 0 && valueUsd <= 0) continue;
      const prev = out.get(sym);
      out.set(sym, { qty: (prev?.qty ?? 0) + qty, valueUsd: (prev?.valueUsd ?? 0) + valueUsd });
    }
  }
  return out;
}

/** Pure. Keeps only entries worth at least floorUsd, exactly as the Portfolio page hides dust. */
export function applyDustFloor(held: HeldNow, floorUsd: number = MIN_HELD_VALUE_USD): HeldNow {
  const out: HeldNow = new Map();
  for (const [sym, h] of held) {
    if (h.valueUsd != null && h.valueUsd >= floorUsd) out.set(sym, { ...h });
  }
  return out;
}

/**
 * Pure. Adds Aave supply amounts (symbol to amount) into a copy of base. A symbol only Aave knows gets
 * valueUsd null (the supply is not priced here); a symbol the wallets already hold keeps its value
 * and gains the amount.
 */
export function mergeAaveSupply(base: HeldNow, aave: Map<string, number>): HeldNow {
  const out: HeldNow = new Map();
  for (const [sym, h] of base) out.set(sym, { ...h });
  for (const [rawSym, amount] of aave) {
    const sym = rawSym.trim().toUpperCase();
    if (!sym || !Number.isFinite(amount) || amount <= 0) continue;
    const prev = out.get(sym);
    out.set(sym, prev ? { qty: prev.qty + amount, valueUsd: prev.valueUsd } : { qty: amount, valueUsd: null });
  }
  return out;
}

/**
 * Pure. The USD price of an Aave-supplied symbol from market tickers, or null when it cannot be priced.
 * tickerPrices maps UPPERCASE ticker symbols to USD prices. This is the one shared rule in
 * src/lib/aave/pricing.ts, the same one the Vault and Portfolio fall back on, under the name this module's
 * callers know.
 */
export const aaveSymbolPrice = aaveSymbolUsdPrice;

/**
 * Pure. An entry with no value (supplied to Aave and not in a wallet snapshot) is kept only when priceOf
 * can price it and its value reaches floorUsd; it then carries that value. Entries that already have a
 * value are left as they are. This mirrors the Portfolio page, which keeps an Aave position only when
 * it is priced at $1 or more, so an unpriced or sub-dollar leftover does not show as held.
 */
export function settleAaveOnlyHoldings(
  held: HeldNow,
  priceOf: (symbol: string) => number | null,
  floorUsd: number = MIN_HELD_VALUE_USD,
): HeldNow {
  const out: HeldNow = new Map();
  for (const [sym, h] of held) {
    if (h.valueUsd != null) {
      out.set(sym, { ...h });
      continue;
    }
    const price = priceOf(sym);
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    const value = price * h.qty;
    if (Number.isFinite(value) && value >= floorUsd) out.set(sym, { qty: h.qty, valueUsd: value });
  }
  return out;
}

// ── I/O ────────────────────────────────────────────────────────────────────────

// The Portfolio page's query: the latest snapshot per (wallet, chain), both tables scoped to the tenant.
const SNAPSHOT_SQL = `WITH latest AS (
  SELECT wallet_id, chain, MAX(captured_at) AS captured_at
  FROM wallet_snapshots WHERE tenant_id = ?
  GROUP BY wallet_id, chain
)
SELECT ws.payload_json
FROM wallet_snapshots ws
JOIN latest l
  ON l.wallet_id   = ws.wallet_id
 AND l.chain       = ws.chain
 AND l.captured_at = ws.captured_at
JOIN wallets w ON w.id = ws.wallet_id
WHERE ws.tenant_id = ? AND w.tenant_id = ?`;

const AAVE_WALLETS_SQL = `SELECT DISTINCT address FROM wallets
WHERE tenant_id = ?
  AND (wallet_type = 'onchain' OR wallet_type IS NULL)`;

const AAVE_FRESH_MS = 10 * 60 * 1000;
const AAVE_STALE_MAX_MS = 24 * 60 * 60 * 1000;
const AAVE_REFRESH_TIMEOUT_MS = 25 * 1000;
const DEFAULT_AAVE_WAIT_MS = 1500;
const MAX_CACHED_TENANTS = 500;

type AaveEntry = { at: number; supply: Map<string, number> };

// Per process and keyed by tenant id: one tenant's entry is never read for another.
const aaveCache = new Map<string, AaveEntry>();
const aaveInFlight = new Map<string, Promise<void>>();
// Bumped by resetHeldNowCache, so a refresh started before a reset can never write into the new cache.
let cacheGeneration = 0;

/** Test hook: forget every cached Aave answer and every refresh in flight. */
export function resetHeldNowCache(): void {
  cacheGeneration += 1;
  aaveCache.clear();
  aaveInFlight.clear();
}

/** Never throws, so a catch block that logs with it cannot turn into a rejection of its own. */
function errText(e: unknown): string {
  try {
    return e instanceof Error ? e.message : String(e);
  } catch {
    return 'unreadable error';
  }
}
const isFresh = (e: AaveEntry | undefined, at: number) => e !== undefined && at - e.at < AAVE_FRESH_MS;
const isUsable = (e: AaveEntry | undefined, at: number) => e !== undefined && at - e.at <= AAVE_STALE_MAX_MS;

function dropOldest<V>(m: Map<string, V>, max: number): void {
  while (m.size > max) {
    const oldest = m.keys().next();
    if (oldest.done) return;
    m.delete(oldest.value);
  }
}

function rememberAave(tenantId: string, entry: AaveEntry): void {
  aaveCache.delete(tenantId); // re-insert so the Map's order tracks the newest write
  aaveCache.set(tenantId, entry);
  dropOldest(aaveCache, MAX_CACHED_TENANTS);
}

/** A timer that can be canceled, so a finished wait never leaves one pending. */
function sleep(ms: number): { done: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { done, cancel: () => clearTimeout(timer) };
}

/**
 * Whether a wallet's Aave answer can be trusted. getAavePositionsForWallet reports an outage per chain
 * (ok: false) while its top level stays ok, and a market that is not configured comes back ok with no
 * market, so "ok" alone cannot tell an outage from an empty wallet. A wallet counts when at least one
 * market actually answered, or when there was nothing to ask (an address that is not EVM).
 */
function walletAnswered(chains: AaveChainSummary[]): boolean {
  if (chains.length === 0) return true;
  return chains.some(
    (c) => c != null && c.ok !== false && (c.market != null || (Array.isArray(c.positions) && c.positions.length > 0)),
  );
}

/**
 * One pass over the tenant's on-chain wallets, one wallet at a time. Returns the supplied amount per
 * symbol, or null when no wallet gave a usable answer (an Aave outage) or the caller gave up, so the
 * previous entry is kept instead of being wiped.
 */
async function fetchAaveSupply(tenantId: string, stop: { requested: boolean }): Promise<Map<string, number> | null> {
  const res = await db.execute({ sql: AAVE_WALLETS_SQL, args: [tenantId] });
  const supply = new Map<string, number>();
  const seen = new Set<string>();
  let asked = 0;
  let answered = 0;
  for (const row of res?.rows ?? []) {
    if (stop.requested) return null;
    const address = String(row.address ?? '').trim();
    if (!address) continue;
    // EVM addresses are case-insensitive; a checksummed and a lowercase copy are one wallet.
    const key = EVM_ADDRESS_ANY_PREFIX.test(address) ? address.toLowerCase() : address;
    if (seen.has(key)) continue;
    seen.add(key);
    asked += 1;

    let result: AavePositionsResponse | undefined;
    try {
      result = await getAavePositionsForWallet(address);
    } catch (e) {
      console.warn('[currentHoldings] Aave lookup failed for one wallet (non-fatal):', errText(e));
      continue;
    }
    if (stop.requested) return null;
    if (!result || result.ok === false) continue;
    const chains = Array.isArray(result.chains) ? result.chains : [];
    if (!walletAnswered(chains)) continue;
    answered += 1;

    for (const chain of chains) {
      if (!chain || chain.ok === false || !Array.isArray(chain.positions)) continue;
      for (const pos of chain.positions) {
        if (!pos || pos.side !== 'supply') continue;
        const amount = Number(pos.amount);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const raw = String(pos.assetSymbol ?? '').trim().toUpperCase();
        if (!raw) continue;
        const sym = AAVE_SYMBOL_NORMALIZE[raw] ?? raw;
        supply.set(sym, (supply.get(sym) ?? 0) + amount);
      }
    }
  }
  // No wallet to ask means nothing can be supplied and nothing failed: an empty answer is the truth.
  if (asked === 0) return supply;
  return answered > 0 ? supply : null;
}

/** Starts the tenant's background refresh. The returned promise never rejects and settles within the cap. */
function startAaveRefresh(tenantId: string, now: () => number): Promise<void> {
  const generation = cacheGeneration;
  const stop = { requested: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      stop.requested = true;
      resolve(null);
    }, AAVE_REFRESH_TIMEOUT_MS);
  });

  let run: Promise<void> | undefined;
  run = (async () => {
    try {
      const supply = await Promise.race([fetchAaveSupply(tenantId, stop), timedOut]);
      if (supply) {
        if (generation === cacheGeneration) rememberAave(tenantId, { at: now(), supply });
      } else if (stop.requested) {
        console.warn('[currentHoldings] Aave refresh timed out; keeping the previous answer');
      } else {
        console.warn('[currentHoldings] Aave gave no usable answer; keeping the previous answer');
      }
    } catch (e) {
      console.warn('[currentHoldings] Aave refresh failed (non-fatal):', errText(e));
    } finally {
      clearTimeout(timer);
      // Only clear our own entry: after a reset, or once the cap dropped us, it may belong to a newer refresh.
      if (run !== undefined && aaveInFlight.get(tenantId) === run) aaveInFlight.delete(tenantId);
    }
  })();

  aaveInFlight.set(tenantId, run);
  dropOldest(aaveInFlight, MAX_CACHED_TENANTS);
  return run;
}

/**
 * Every coin the tenant's wallets hold right now: the latest snapshots at or above the dust floor, plus
 * Aave supply unless includeAave is false. Waits at most aaveWaitMs for Aave; a refresh that takes
 * longer keeps running and fills the cache for the next call. An Aave problem never throws out of
 * here; a failed snapshot query does (the caller decides what to show).
 */
export async function getHeldNow(
  tenantId: string,
  opts: { includeAave?: boolean; aaveWaitMs?: number; now?: () => number } = {},
): Promise<HeldNow> {
  const includeAave = opts.includeAave !== false;
  const now = opts.now ?? Date.now;
  const waitMs =
    typeof opts.aaveWaitMs === 'number' && Number.isFinite(opts.aaveWaitMs)
      ? Math.max(0, opts.aaveWaitMs)
      : DEFAULT_AAVE_WAIT_MS;

  // Start (or join) the Aave refresh before the snapshot query so the slow part overlaps it.
  let refresh: Promise<void> | null = null;
  if (includeAave) {
    try {
      if (!isFresh(aaveCache.get(tenantId), now())) {
        refresh = aaveInFlight.get(tenantId) ?? startAaveRefresh(tenantId, now);
      }
    } catch (e) {
      console.warn('[currentHoldings] Aave refresh could not start (non-fatal):', errText(e));
    }
  }
  const budget = refresh ? sleep(waitMs) : null;

  let held: HeldNow;
  try {
    const res = await db.execute({ sql: SNAPSHOT_SQL, args: [tenantId, tenantId, tenantId] });
    const payloads = (res?.rows ?? []).map((r) => (r.payload_json == null ? null : String(r.payload_json)));
    held = applyDustFloor(parseSnapshotHoldings(payloads));
  } catch (e) {
    budget?.cancel();
    throw e;
  }
  if (!includeAave) return held;

  try {
    if (refresh && budget && !isFresh(aaveCache.get(tenantId), now())) {
      await Promise.race([refresh, budget.done]);
    }
    // The refreshed entry when the refresh finished in time, else the previous one while it is usable.
    const entry = aaveCache.get(tenantId);
    return entry && isUsable(entry, now()) ? mergeAaveSupply(held, entry.supply) : held;
  } catch (e) {
    console.warn('[currentHoldings] Aave merge skipped (non-fatal):', errText(e));
    return held;
  } finally {
    budget?.cancel();
  }
}
