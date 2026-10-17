/**
 * Which coins the Memory Lane page lists, and which of them count as held.
 *
 * Pure: no db, no env, no I/O, so the rules can be tested without rendering the page.
 *
 * "Held" must never rest on lifecycle net quantity alone. That figure is a bookkeeping total and
 * drifts from real balances wherever transactions are missing or transfers are unmatched, which is
 * exactly what the Reconciliation panel exists to catch. Used alone, it showed most held coins as
 * "closed". A coin is held when it has lots still open at the end of the
 * selected year (the original test) or the lifecycle says a positive quantity remains (which
 * covers coins bought after that year).
 */
import { isSpamToken } from './knownContracts';

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
}): CoinUniverse {
  const { roster, withYearGains, stillHolding } = input;
  const all = new Set<string>([...roster.keys(), ...withYearGains, ...stillHolding]);

  const symbols: string[] = [];
  const hiddenSpam: string[] = [];
  for (const sym of all) {
    // A symbol that carries accounting weight this year stays visible even if its name looks
    // like spam: hiding it would make this page disagree with the tax pages.
    const weighty = withYearGains.has(sym) || stillHolding.has(sym);
    if (!weighty && isSpamSymbol(sym)) hiddenSpam.push(sym);
    else symbols.push(sym);
  }

  const held = new Set<string>();
  for (const sym of symbols) {
    const r = roster.get(sym);
    if (stillHolding.has(sym) || (r && round8(r.netQty) > 0)) held.add(sym);
  }
  return { symbols, held, hiddenSpam };
}
