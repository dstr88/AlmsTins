import { describe, it, expect } from 'vitest';
import { classifyUniverse, isSpamSymbol, type RosterEntry } from '../../src/lib/memoryLane';

const entry = (netQty: number, extra: Partial<RosterEntry> = {}): RosterEntry => ({
  netQty,
  weightedAvgCost: 0,
  latestAcquiredAt: '2024-01-01T00:00:00Z',
  lastEventAt: '2025-01-01T00:00:00Z',
  ...extra,
});
const set = (...s: string[]) => new Set<string>(s);
const none = set();

// The kinds of symbols scam airdrops carry: URLs, "visit ... to claim", phishing domains, and
// lookalike spellings of real tickers.
const SPAM = [
  'VISIT EXAMPLE-AIRDROP.COM TO CLAIM REWARDS',
  'APP.CLAIM-TOKENS.CAB',
  'FREE-USD.XYZ',
  'CLAIMNOW.COM',
  'DROP | T.ME/EXAMPLE | VISIT TO CLAIM',
  'ETH [ T.LY/EXAMPLE ] VISIT TO CLAIM REWARD',
  '$ CLAIM FREE TOKENS NOW',
  'UЅDT',                                  // Cyrillic S inside USDT
  'USDТ',                                  // Cyrillic T at the end of USDT
  '\u{1D414}\u{1D412}\u{1D403}\u{1D413}',       // mathematical bold USDT
];
const REAL = ['ETH', 'BTC', 'BTC.B', 'USDC.E', 'WETH', '1INCH', 'LINK', 'ARB', 'AETHWSTETH', 'VARIABLEDEBTUSDC'];

describe('isSpamSymbol', () => {
  it('flags airdrop spam and lookalike spellings', () => {
    for (const s of SPAM) expect(isSpamSymbol(s), s).toBe(true);
  });

  it('leaves real tickers alone, including bridged and Aave token names', () => {
    for (const s of REAL) expect(isSpamSymbol(s), s).toBe(false);
  });
});

describe('classifyUniverse: which coins count as held', () => {
  // The regression this guards: most held coins showed as closed because the lifecycle
  // quantity said zero while real lots were still open.
  it('a coin with lots still open at the year-end is held even when the lifecycle quantity is zero', () => {
    const u = classifyUniverse({ roster: new Map([['ETH', entry(0)]]), withYearGains: none, stillHolding: set('ETH') });
    expect(u.held.has('ETH')).toBe(true);
  });

  it('a coin the lifecycle says is still held counts as held even with no lots open at the year-end', () => {
    const u = classifyUniverse({ roster: new Map([['ADA', entry(5)]]), withYearGains: none, stillHolding: none });
    expect(u.held.has('ADA')).toBe(true);
  });

  it('a fully disposed coin is listed and closed', () => {
    const u = classifyUniverse({ roster: new Map([['XRP', entry(0)]]), withYearGains: none, stillHolding: none });
    expect(u.symbols).toContain('XRP');
    expect(u.held.has('XRP')).toBe(false);
  });

  it('dust below the 8-decimal tolerance is closed', () => {
    const u = classifyUniverse({ roster: new Map([['DOGE', entry(4e-9)]]), withYearGains: none, stillHolding: none });
    expect(u.held.has('DOGE')).toBe(false);
  });

  it('a negative lifecycle quantity (a data gap) is closed unless lots are still open', () => {
    const roster = new Map([['LTC', entry(-3)]]);
    expect(classifyUniverse({ roster, withYearGains: none, stillHolding: none }).held.has('LTC')).toBe(false);
    expect(classifyUniverse({ roster, withYearGains: none, stillHolding: set('LTC') }).held.has('LTC')).toBe(true);
  });
});

describe('classifyUniverse: which coins are listed', () => {
  it('lists every roster symbol plus symbols that only the breakdown knows (no lifecycle group)', () => {
    const u = classifyUniverse({
      roster: new Map([['BTC', entry(1)]]),
      withYearGains: set('SUI'),
      stillHolding: set('XMR'),
    });
    expect([...u.symbols].sort()).toEqual(['BTC', 'SUI', 'XMR']);
  });

  it('hides roster-only spam, keeps real coins, and reports what it hid', () => {
    const roster = new Map<string, RosterEntry>([...SPAM, ...REAL].map((s) => [s, entry(0)]));
    const u = classifyUniverse({ roster, withYearGains: none, stillHolding: none });
    expect([...u.hiddenSpam].sort()).toEqual([...SPAM].sort());
    expect([...u.symbols].sort()).toEqual([...REAL].sort());
  });

  it('a spam symbol is never held, whatever the lifecycle quantity says', () => {
    const u = classifyUniverse({ roster: new Map([['CLAIMNOW.COM', entry(1000)]]), withYearGains: none, stillHolding: none });
    expect(u.hiddenSpam).toEqual(['CLAIMNOW.COM']);
    expect(u.held.size).toBe(0);
  });

  it('a spam-looking symbol with realized gains or open lots this year stays visible (so this page agrees with the tax pages)', () => {
    const weird = 'VISIT EXAMPLE-AIRDROP.COM TO CLAIM REWARDS';
    expect(classifyUniverse({ roster: new Map(), withYearGains: set(weird), stillHolding: none }).hiddenSpam).toEqual([]);
    expect(classifyUniverse({ roster: new Map(), withYearGains: none, stillHolding: set(weird) }).symbols).toContain(weird);
  });
});
