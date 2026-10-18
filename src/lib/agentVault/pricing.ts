/**
 * What a transfer was worth in USD when it happened.
 *
 * The ledger is append-only, so a price written wrong or left empty today cannot be corrected
 * tomorrow. The rules lean toward "no value on record" over a made-up one:
 *
 *   - A token is priced only when its contract is the known one for that symbol on that chain
 *     (src/lib/knownContracts.ts). A token that copies a famous symbol from another contract is
 *     not USDC because it says so, and is left without a value. An unknown token is left without
 *     a value. Without a value is `null` in the ledger, never 0.
 *   - A stablecoin on its known contract counts at one dollar, the same assumption the import
 *     price backfill makes.
 *   - The chain's own coin and a short list of known tokens use CoinGecko's price for the day of
 *     the transfer (noon UTC), through the same helper the rest of the app uses. The ids come from
 *     the list below, not from a search by symbol, because a symbol search can land on the wrong
 *     coin and a wrong value cannot be corrected later. It is a daily price, not the price at the
 *     minute, and the event says so. Any other asset has no value on record.
 *   - A price that should exist but did not come back (a rate limit, an outage) is not written as
 *     "no value" while it could still arrive: the transfer is deferred and read again on the next
 *     pass. Only after PRICE_RETRY_WINDOW_MS is the missing price accepted as final.
 *
 * The lookups are injected, so the rules are tested without the network.
 */
import { classifyContract, STABLECOIN_SYMBOLS } from '@/lib/knownContracts';
import { NATIVE_SYMBOL, type Transfer } from './transfers';

/** A price missing for a transfer younger than this is treated as "not yet", and older as final. */
export const PRICE_RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** The assets with a CoinGecko id we trust, by upper-case symbol. A token must also be on its known contract (see tokenIsKnown). */
export const COIN_IDS: ReadonlyMap<string, string> = new Map([
  ['ETH', 'ethereum'],
  ['POL', 'polygon-ecosystem-token'],
  ['AVAX', 'avalanche-2'],
  ['WETH', 'weth'],
  ['WBTC', 'wrapped-bitcoin'],
  ['LINK', 'chainlink'],
]);

export interface PricingDeps {
  /** USD for one whole unit on a UTC day (YYYY-MM-DD), or null when there is no price. Never throws. */
  unitPriceUsd(coinId: string, day: string): Promise<number | null>;
}

export type PriceOutcome =
  | { kind: 'priced'; usd: number; unitUsd: number; basis: 'stablecoin_peg' | 'daily_price'; day: string }
  | { kind: 'unpriced'; reason: 'unknown_token' | 'no_price_id' | 'no_price' | 'bad_amount' }
  | { kind: 'retry' };

/** The symbol a bridged token is known by here: `USDC.e` is USDC. */
const baseSymbol = (symbol: string): string => symbol.toUpperCase().replace(/\.E$/, '');

function tokenIsKnown(t: Transfer): boolean {
  if (t.assetContract === null) return false;
  if (classifyContract(t.chain, t.asset, t.assetContract) === 'legitimate') return true;
  const base = baseSymbol(t.asset);
  return base !== t.asset.toUpperCase() && classifyContract(t.chain, base, t.assetContract) === 'legitimate';
}

export async function priceTransfer(t: Transfer, nowMs: number, deps: PricingDeps): Promise<PriceOutcome> {
  const amount = Number(t.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { kind: 'unpriced', reason: 'bad_amount' };
  const day = new Date(t.atSec * 1000).toISOString().slice(0, 10);

  let symbol: string;
  if (t.assetContract === null) {
    symbol = NATIVE_SYMBOL[t.chain];
  } else {
    if (!tokenIsKnown(t)) return { kind: 'unpriced', reason: 'unknown_token' };
    symbol = baseSymbol(t.asset);
    if (STABLECOIN_SYMBOLS.has(t.asset.toUpperCase()) || STABLECOIN_SYMBOLS.has(symbol)) {
      return { kind: 'priced', usd: amount, unitUsd: 1, basis: 'stablecoin_peg', day };
    }
  }

  const coinId = COIN_IDS.get(symbol) ?? null;
  if (!coinId) return { kind: 'unpriced', reason: 'no_price_id' };
  const unitUsd = await deps.unitPriceUsd(coinId, day);
  if (unitUsd === null) {
    return t.atSec * 1000 > nowMs - PRICE_RETRY_WINDOW_MS ? { kind: 'retry' } : { kind: 'unpriced', reason: 'no_price' };
  }
  const usd = amount * unitUsd;
  if (!Number.isFinite(usd)) return { kind: 'unpriced', reason: 'bad_amount' };
  return { kind: 'priced', usd, unitUsd, basis: 'daily_price', day };
}

/** Remembers the answers of another set of lookups for as long as it lives (one pass), so a day's price is asked once. */
export function memoizePricing(inner: PricingDeps): PricingDeps {
  const prices = new Map<string, Promise<number | null>>();
  return {
    unitPriceUsd(coinId, day) {
      const key = `${coinId}|${day}`;
      let hit = prices.get(key);
      if (!hit) prices.set(key, (hit = inner.unitPriceUsd(coinId, day)));
      return hit;
    },
  };
}

/** The app's CoinGecko helpers, loaded on first use so nothing network-shaped is imported until a price is wanted. */
export const defaultPricing: PricingDeps = {
  async unitPriceUsd(coinId, day) {
    try {
      const { getUsdUnitPriceAtTimestampCoinGecko } = await import('@/lib/coingeckoHistorical');
      const r = await getUsdUnitPriceAtTimestampCoinGecko({ coinId, timestampUtcIso: `${day}T12:00:00Z` });
      return r && Number.isFinite(r.unitPriceUsd) && r.unitPriceUsd > 0 ? r.unitPriceUsd : null;
    } catch {
      return null;
    }
  },
};
