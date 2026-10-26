/**
 * The USD price a Bitcoin or Litecoin row is stored at: the coin's price on the transaction's UTC
 * day, never the price on the day of the sync. Same convention as the import price backfill
 * (src/lib/priceMissingImportTransactions.ts): CoinGecko at 12:00 UTC of that day, through
 * src/lib/coingeckoHistorical.ts and its caches (memory, then the shared cache table, 90 days) and
 * rate-limit handling. When CoinGecko has no price (without a Pro key it reaches back 365 days; a
 * 429, an outage), Coinbase Exchange's public candles are asked for the same coin and day
 * (src/lib/coinbaseHistorical.ts, price_source 'coinbase:candles'). A day neither prices gives
 * null: the row is stored without a value, so "Fill Missing Prices" and Needs Attention pick it up,
 * instead of a price from another day.
 *
 * Used by the sync (src/lib/sync/syncBtcAddress.ts) and by the one-time correction of rows stored
 * before this (src/scripts/correctUtxoPrices.ts), so both store the same value for the same row.
 */

import { coingeckoReaches, getCoingeckoIdBySymbol, getUsdUnitPriceAtTimestampCoinGecko } from '@/lib/coingeckoHistorical';
import { COINBASE_SOURCE, coinbaseDayUsdPrice } from '@/lib/coinbaseHistorical';

export type DayPrice = { unitPriceUsd: number; source: string };
export type DayPriceLookup = (symbol: string, day: string) => Promise<DayPrice | null>;

/**
 * Distinct days within CoinGecko's reach (coingeckoReaches) one sync looks up, newest first:
 * CoinGecko's public rate limit is low. A day past the cap is stored without a value and the next
 * syncs price it (syncUtxoAddress fills a row of its own whose value is still empty), as does
 * "Fill Missing Prices". Older days go straight to the Coinbase fallback, which answers 74 days
 * per request, so they are not capped.
 */
export const MAX_PRICE_DAYS_PER_SYNC = 30;

/** The UTC day (YYYY-MM-DD) of an ISO timestamp, or null. */
export function utcDay(iso: string): string | null {
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

/** CoinGecko's price for the day, or null. Never throws. */
async function coingeckoDayPrice(symbol: string, day: string): Promise<DayPrice | null> {
	try {
		const coinId = await getCoingeckoIdBySymbol(symbol);
		if (!coinId) return null;
		const r = await getUsdUnitPriceAtTimestampCoinGecko({ coinId, timestampUtcIso: `${day}T12:00:00Z` });
		if (!r || !Number.isFinite(r.unitPriceUsd) || r.unitPriceUsd <= 0) return null;
		return { unitPriceUsd: r.unitPriceUsd, source: r.source };
	} catch {
		return null;
	}
}

/**
 * The coin's USD price on one UTC day: CoinGecko first, then (Bitcoin and Litecoin only) Coinbase.
 * Null when neither has one. Never throws.
 */
export const dailyUsdPrice: DayPriceLookup = async (symbol, day) => {
	const cg = await coingeckoDayPrice(symbol, day);
	if (cg) return cg;
	const fallback = await coinbaseDayUsdPrice(symbol, day);
	return fallback === null ? null : { unitPriceUsd: fallback, source: COINBASE_SOURCE };
};

/** Whether CoinGecko can be asked for the day (else only the fallback can price it). */
export const coingeckoReachesDay = (day: string): boolean => coingeckoReaches(`${day}T12:00:00Z`);

/**
 * Prices for the given days, each looked up once, newest first, at most `max` of those CoinGecko
 * reaches (`reaches`); days beyond its reach are all looked up. A day past the cap is absent from
 * the map (not looked up); a day with no price maps to null.
 */
export async function priceDays(
	symbol: string,
	days: Iterable<string>,
	opts: { max?: number; lookup?: DayPriceLookup; reaches?: (day: string) => boolean } = {},
): Promise<Map<string, DayPrice | null>> {
	const { max = MAX_PRICE_DAYS_PER_SYNC, lookup = dailyUsdPrice, reaches = coingeckoReachesDay } = opts;
	let budget = Math.max(0, max);
	const out = new Map<string, DayPrice | null>();
	for (const day of [...new Set(days)].sort().reverse()) {
		if (reaches(day)) {
			if (budget === 0) continue;
			budget--;
		}
		out.set(day, await lookup(symbol, day));
	}
	return out;
}

/** A row's USD value at a unit price, in cents, as the sync has always rounded it. */
export function usdAt(amount: number, unitPriceUsd: number): number {
	return Math.round(Math.abs(amount) * unitPriceUsd * 100) / 100;
}
