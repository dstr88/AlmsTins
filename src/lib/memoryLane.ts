/**
 * Which coins the Memory Lane page lists, which of them count as held, and the Open card for a held
 * coin that has no lots to build one from.
 *
 * Pure: no db, no env, no I/O, so the rules can be tested without rendering the page. (The import
 * from ./currentHoldings is type-only and is erased at build time.)
 *
 * "Held" must never rest on lifecycle records alone. Their net quantity is a bookkeeping total and
 * drifts from real balances wherever transactions are missing or transfers are unmatched, which is
 * exactly what the Reconciliation panel exists to catch. Used alone, it showed most held coins as
 * "closed". A coin is held when it has lots still open at the end of the selected year (the original
 * test), when the lifecycle says a positive quantity remains (which covers coins bought after that
 * year), or when the wallets hold it right now (latest snapshots at or above the Portfolio dust
 * floor, plus Aave supply), which covers a collateral deposit or a token with no matching buy.
 */
import { isSpamToken } from './knownContracts';
import type { HeldQty } from './currentHoldings';

export type RosterEntry = {
  netQty: number;
  weightedAvgCost: number;
  latestAcquiredAt: string;
  /** Timestamp of the coin's most recent lifecycle event of any kind; '' when it has none. */
  lastEventAt: string;
};

const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

/**
 * Airdrop spam and lookalike spellings: the shared spam patterns (URLs, "visit ... to claim",
 * phishing domains, pipes) plus any non-ASCII character, which catches homoglyph spoofs such as a
 * Cyrillic S inside USDT. Real tickers on the chains Almstins reads are plain ASCII.
 */
export function isSpamSymbol(symbol: string): boolean {
  return isSpamToken(symbol) || /[^\x00-\x7F]/.test(symbol);
}

export type CoinUniverse = {
  /** Every symbol to list, with spam left out. */
  symbols: string[];
  /** The symbols counted as currently held; every other listed symbol is closed. */
  held: Set<string>;
  /** Spam symbols that were left out, so the page can say how many. */
  hiddenSpam: string[];
};

export function classifyUniverse(input: {
  roster: Map<string, RosterEntry>;
  /** Symbols with realized gains or losses in the selected year. */
  withYearGains: Set<string>;
  /** Symbols with lots still open at the end of the selected year. */
  stillHolding: Set<string>;
  /** Symbols the wallets hold right now (see getHeldNow in ./currentHoldings). Optional; empty by default. */
  heldNow?: Set<string>;
}): CoinUniverse {
  const { roster, withYearGains, stillHolding } = input;
  const heldNow = input.heldNow ?? new Set<string>();
  const all = new Set<string>([...roster.keys(), ...withYearGains, ...stillHolding, ...heldNow]);

  const symbols: string[] = [];
  const hiddenSpam: string[] = [];
  for (const sym of all) {
    // A symbol that carries accounting weight this year, or that the wallets hold right now, stays
    // visible even if its name looks like spam: hiding it would make this page disagree with the tax
    // pages or with the Portfolio page.
    const weighty = withYearGains.has(sym) || stillHolding.has(sym) || heldNow.has(sym);
    if (!weighty && isSpamSymbol(sym)) hiddenSpam.push(sym);
    else symbols.push(sym);
  }

  const held = new Set<string>();
  for (const sym of symbols) {
    const r = roster.get(sym);
    if (stillHolding.has(sym) || heldNow.has(sym) || (r && round8(r.netQty) > 0)) held.add(sym);
  }
  return { symbols, held, hiddenSpam };
}

/** One card in the page's Open (currently held) section. */
export type OpenCard = {
  asset: string;
  totalQty: number;
  totalCost: number;
  currentPrice: number | null;
  currentValue: number | null;
  unrealizedGainLoss: number | null;
  shortTermQty: number;
  longTermQty: number;
  soonestLotDaysToLT: number | null;
  noYearActivity?: boolean;
};

/**
 * The Open card for a held coin with no lot still open at the selected year-end (bought after that
 * year, or held without lifecycle lots at all, such as a collateral deposit or a token with no
 * matching buy). The wallets are the truth for quantity; the roster only fills in when they have
 * none. With no known cost basis the unrealized figure stays null rather than showing the whole
 * value as a gain.
 */
export function buildSyntheticOpenCard(input: {
  symbol: string;
  roster?: RosterEntry;
  held?: HeldQty;
  price?: number | null;
}): OpenCard {
  const { symbol, roster, held, price } = input;
  const heldQty = held && Number.isFinite(held.qty) ? held.qty : 0;
  const rosterQty = roster && Number.isFinite(roster.netQty) ? roster.netQty : 0;
  const qty = heldQty > 0 ? heldQty : rosterQty > 0 ? rosterQty : 0;

  let value: number | null = null;
  if (held && typeof held.valueUsd === 'number' && Number.isFinite(held.valueUsd) && held.valueUsd > 0) {
    value = held.valueUsd;
  } else if (typeof price === 'number' && Number.isFinite(price) && price > 0 && qty > 0) {
    value = price * qty;
  }
  const currentPrice = value !== null && value > 0 && qty > 0 ? value / qty : (price ?? null);

  const avgCost = roster && Number.isFinite(roster.weightedAvgCost) ? roster.weightedAvgCost : 0;
  const totalCost = avgCost > 0 ? avgCost * qty : 0;
  const unrealizedGainLoss = totalCost > 0 && value !== null ? value - totalCost : null;

  return {
    asset: symbol,
    totalQty: qty,
    totalCost,
    currentPrice,
    currentValue: value,
    unrealizedGainLoss,
    shortTermQty: 0,
    longTermQty: 0,
    soonestLotDaysToLT: null,
    noYearActivity: true,
  };
}
