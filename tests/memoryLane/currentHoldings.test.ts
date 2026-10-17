import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * What the wallets hold right now: the parsing rules (pure) and getHeldNow's cache behavior.
 *
 * Hermetic: '@/lib/db' is a stub that records every statement and answers from per-tenant fixtures,
 * and '@/lib/aave/client' is a mock, so no database, network or secret is touched. Every symbol,
 * amount and address below is invented.
 */

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; args: unknown[] }>,
  snapshots: new Map<string, Array<string | null>>(),
  wallets: new Map<string, string[]>(),
  failSnapshots: false,
  failWallets: null as unknown,
}));

const aave = vi.hoisted(() => ({ getAavePositionsForWallet: vi.fn() }));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => {
      const args = stmt.args ?? [];
      state.calls.push({ sql: stmt.sql, args });
      const tenant = String(args[0] ?? '');
      if (/FROM wallet_snapshots/.test(stmt.sql)) {
        if (state.failSnapshots) throw new Error('snapshot query failed');
        return { rows: (state.snapshots.get(tenant) ?? []).map((p) => ({ payload_json: p })), rowsAffected: 0 };
      }
      if (/SELECT DISTINCT address FROM wallets/.test(stmt.sql)) {
        if (state.failWallets !== null) throw state.failWallets;
        return { rows: (state.wallets.get(tenant) ?? []).map((a) => ({ address: a })), rowsAffected: 0 };
      }
      throw new Error(`unexpected SQL in test: ${stmt.sql}`);
    },
  },
}));

vi.mock('@/lib/aave/client', () => ({ getAavePositionsForWallet: aave.getAavePositionsForWallet }));

import {
  AAVE_SYMBOL_NORMALIZE,
  MIN_HELD_VALUE_USD,
  applyDustFloor,
  getHeldNow,
  mergeAaveSupply,
  parseSnapshotHoldings,
  resetHeldNowCache,
  type HeldNow,
} from '../../src/lib/currentHoldings';

// ── fixtures ────────────────────────────────────────────────────────────────────

const T_A = 'tenant-a';
const T_B = 'tenant-b';
const ADDR_A = '0x' + 'a'.repeat(40);
const ADDR_B = '0x' + 'b'.repeat(40);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const payload = (...tokens: Array<Record<string, unknown>>) => JSON.stringify(tokens);
const token = (symbol: string, amount: number, valueUsd: number) => ({ symbol, amount, valueUsd, priceUsd: amount > 0 ? valueUsd / amount : null });

type Pos = { side: 'supply' | 'borrow'; assetSymbol: string; amount: number };
const supply = (assetSymbol: string, amount: number): Pos => ({ side: 'supply', assetSymbol, amount });
const borrow = (assetSymbol: string, amount: number): Pos => ({ side: 'borrow', assetSymbol, amount });

/** A market that answered, shaped like getAavePositionsForWallet's per-chain summary. */
const market = (chain: string, ...positions: Pos[]) => ({
  chain,
  ok: true,
  market: '0x' + 'c'.repeat(40),
  suppliedUsd: 0,
  debtUsd: 0,
  suppliedUsdTotal: 0,
  debtUsdTotal: 0,
  positions: positions.map((p) => ({ marketName: 'Example market', apy: 0, usdValue: 0, ...p })),
});
/** A market whose request failed: the client reports this per chain and keeps the top level ok. */
const failedMarket = (chain: string) => ({
  chain, ok: false, suppliedUsd: 0, debtUsd: 0, suppliedUsdTotal: 0, debtUsdTotal: 0, positions: [], error: 'HTTP 503',
});
/** A market that is not configured: ok, but nothing was asked. */
const unconfiguredMarket = (chain: string) => ({
  chain, ok: true, market: null, status: 'UNAVAILABLE', suppliedUsd: 0, debtUsd: 0, suppliedUsdTotal: 0, debtUsdTotal: 0, positions: [],
});
const answer = (...chains: unknown[]) => ({ ok: true, address: ADDR_A, chains });
const outage = () => answer(failedMarket('ethereum'), failedMarket('polygon'), failedMarket('avalanche'), unconfiguredMarket('ethereum_v4'));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
/** Lets a background refresh that has everything it needs run to the end. */
const settle = () => new Promise((r) => setTimeout(r, 0));
const asObject = (m: HeldNow) => Object.fromEntries(m);

beforeEach(() => {
  resetHeldNowCache();
  state.calls = [];
  state.snapshots = new Map();
  state.wallets = new Map();
  state.failSnapshots = false;
  state.failWallets = null;
  aave.getAavePositionsForWallet.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ── pure parsing ───────────────────────────────────────────────────────────────

describe('parseSnapshotHoldings', () => {
  it('sums quantity and value per symbol across payloads, trimming and uppercasing symbols', () => {
    const held = parseSnapshotHoldings([
      payload(token('eth', 1.5, 3000), token('ADA', 40, 12)),
      payload(token(' ETH ', 0.25, 500), token('DOT', 2, 9)),
    ]);
    expect(asObject(held)).toEqual({
      ETH: { qty: 1.75, valueUsd: 3500 },
      ADA: { qty: 40, valueUsd: 12 },
      DOT: { qty: 2, valueUsd: 9 },
    });
  });

  it('skips airdrop spam symbols, however much they claim to be worth', () => {
    const held = parseSnapshotHoldings([
      payload(token('CLAIM-REWARDS.COM', 1000, 5000), token('VISIT T.ME/EXAMPLE TO CLAIM', 1, 900), token('ADA', 1, 2)),
    ]);
    expect([...held.keys()]).toEqual(['ADA']);
  });

  it('skips an entry with neither a quantity nor a value, but keeps one that has either', () => {
    const held = parseSnapshotHoldings([
      payload(token('ZERO', 0, 0), { symbol: 'NEG', amount: -2, valueUsd: -1 }, { symbol: 'QTYONLY', amount: 3, valueUsd: null }, { symbol: 'VALONLY', amount: 0, valueUsd: 4 }),
    ]);
    expect(asObject(held)).toEqual({
      QTYONLY: { qty: 3, valueUsd: 0 },
      VALONLY: { qty: 0, valueUsd: 4 },
    });
  });

  it('ignores missing and unreadable payloads, non-array JSON and entries that are not objects; missing numbers count as 0', () => {
    const held = parseSnapshotHoldings([
      null,
      undefined,
      '',
      'not json {',
      JSON.stringify({ symbol: 'OBJ', amount: 1, valueUsd: 5 }),
      JSON.stringify('a string'),
      JSON.stringify([null, 7, 'x', { amount: 1, valueUsd: 5 }, { symbol: '', amount: 1, valueUsd: 5 }]),
      JSON.stringify([{ symbol: 'ADA', amount: '2', valueUsd: 'oops' }, { symbol: 'ADA', valueUsd: 3 }]),
    ]);
    expect(asObject(held)).toEqual({ ADA: { qty: 2, valueUsd: 3 } });
  });

  it('does not apply the dust floor itself', () => {
    const held = parseSnapshotHoldings([payload(token('DUST', 0.001, 0.2))]);
    expect(held.get('DUST')).toEqual({ qty: 0.001, valueUsd: 0.2 });
  });
});

describe('applyDustFloor', () => {
  it('keeps entries worth at least $1 (the Portfolio floor) and drops the rest, including unvalued ones', () => {
    expect(MIN_HELD_VALUE_USD).toBe(1);
    const base: HeldNow = new Map([
      ['ETH', { qty: 1, valueUsd: 2000 }],
      ['EDGE', { qty: 1, valueUsd: 1 }],
      ['DUST', { qty: 5, valueUsd: 0.99 }],
      ['NOVALUE', { qty: 5, valueUsd: null }],
    ]);
    expect([...applyDustFloor(base).keys()]).toEqual(['ETH', 'EDGE']);
    expect([...applyDustFloor(base, 0.5).keys()]).toEqual(['ETH', 'EDGE', 'DUST']);
  });

  it('returns a new map and leaves its input alone', () => {
    const base: HeldNow = new Map([['ETH', { qty: 1, valueUsd: 2000 }]]);
    const out = applyDustFloor(base);
    out.get('ETH')!.qty = 99;
    expect(base.get('ETH')).toEqual({ qty: 1, valueUsd: 2000 });
  });
});

describe('mergeAaveSupply', () => {
  it('gives a symbol only Aave knows a null value, and adds the amount to a symbol the wallets already hold', () => {
    const base: HeldNow = new Map([['ETH', { qty: 1, valueUsd: 2000 }]]);
    const merged = mergeAaveSupply(base, new Map([['ETH', 0.5], ['DOT', 12]]));
    expect(asObject(merged)).toEqual({
      ETH: { qty: 1.5, valueUsd: 2000 },
      DOT: { qty: 12, valueUsd: null },
    });
  });

  it('does not mutate the base map or its entries', () => {
    const base: HeldNow = new Map([['ETH', { qty: 1, valueUsd: 2000 }]]);
    mergeAaveSupply(base, new Map([['ETH', 0.5], ['DOT', 12]]));
    expect(asObject(base)).toEqual({ ETH: { qty: 1, valueUsd: 2000 } });
  });

  it('ignores zero, negative and non-finite amounts', () => {
    const merged = mergeAaveSupply(new Map(), new Map([['A', 0], ['B', -1], ['C', Number.NaN], ['D', Infinity]]));
    expect(merged.size).toBe(0);
  });
});

// ── getHeldNow ──────────────────────────────────────────────────────────────────

describe('getHeldNow: snapshots', () => {
  it('reads the latest snapshots with the tenant-scoped query and applies the dust floor', async () => {
    state.snapshots.set(T_A, [payload(token('ETH', 1, 2000), token('DUST', 1, 0.5))]);
    const held = await getHeldNow(T_A, { includeAave: false });
    expect(asObject(held)).toEqual({ ETH: { qty: 1, valueUsd: 2000 } });

    expect(state.calls).toHaveLength(1);
    const [{ sql, args }] = state.calls;
    expect(args).toEqual([T_A, T_A, T_A]);
    expect(sql).toMatch(/FROM wallet_snapshots WHERE tenant_id = \?/);
    expect(sql).toMatch(/JOIN wallets w ON w\.id = ws\.wallet_id/);
    expect(sql).toMatch(/WHERE ws\.tenant_id = \? AND w\.tenant_id = \?/);
  });

  it('includeAave: false makes no Aave call and no wallet lookup', async () => {
    state.wallets.set(T_A, [ADDR_A]);
    await getHeldNow(T_A, { includeAave: false });
    await settle();
    expect(aave.getAavePositionsForWallet).not.toHaveBeenCalled();
    expect(state.calls.some((c) => /SELECT DISTINCT address FROM wallets/.test(c.sql))).toBe(false);
  });

  it('a failed snapshot query rejects (the page catches it)', async () => {
    state.failSnapshots = true;
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockResolvedValue(answer(market('ethereum', supply('ETH', 1))));
    await expect(getHeldNow(T_A, { aaveWaitMs: 5 })).rejects.toThrow('snapshot query failed');
  });
});

describe('getHeldNow: Aave supply', () => {
  it('returns the snapshots right away when Aave is slower than the wait, and includes Aave on the next call once the refresh lands', async () => {
    state.snapshots.set(T_A, [payload(token('ETH', 1, 2000))]);
    state.wallets.set(T_A, [ADDR_A]);
    const slow = deferred<unknown>();
    aave.getAavePositionsForWallet.mockReturnValueOnce(slow.promise);

    const first = await getHeldNow(T_A, { aaveWaitMs: 5 });
    expect(asObject(first)).toEqual({ ETH: { qty: 1, valueUsd: 2000 } });

    slow.resolve(answer(market('ethereum', supply('ETH', 0.5), supply('DOT', 12))));
    await settle();

    const second = await getHeldNow(T_A, { aaveWaitMs: 0 });
    expect(asObject(second)).toEqual({
      ETH: { qty: 1.5, valueUsd: 2000 },
      DOT: { qty: 12, valueUsd: null },
    });
    expect(aave.getAavePositionsForWallet).toHaveBeenCalledTimes(1);
    expect(aave.getAavePositionsForWallet).toHaveBeenCalledWith(ADDR_A);
  });

  it('waits for a refresh that finishes inside the wait', async () => {
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockResolvedValue(answer(market('ethereum', supply('DOT', 3))));
    const held = await getHeldNow(T_A, { aaveWaitMs: 1000 });
    expect(asObject(held)).toEqual({ DOT: { qty: 3, valueUsd: null } });
  });

  it('every db query carries the tenant id and nothing else', async () => {
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockResolvedValue(answer(market('ethereum', supply('DOT', 3))));
    await getHeldNow(T_A, { aaveWaitMs: 1000 });
    expect(state.calls.length).toBe(2); // snapshots + the wallet list for Aave
    for (const c of state.calls) {
      expect(c.args.length, c.sql).toBeGreaterThan(0);
      expect(c.args.every((a) => a === T_A), c.sql).toBe(true);
      expect(c.sql).toMatch(/tenant_id = \?/);
    }
    const walletQuery = state.calls.find((c) => /SELECT DISTINCT address FROM wallets/.test(c.sql))!;
    expect(walletQuery.args).toEqual([T_A]);
    expect(walletQuery.sql).toMatch(/wallet_type = 'onchain' OR wallet_type IS NULL/);
  });

  it('ignores borrows and zero or non-finite amounts, and sums supply across chains', async () => {
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockResolvedValue(answer(
      market('ethereum', supply('DOT', 2), borrow('USDC', 500), borrow('DOT', 1), supply('ZERO', 0), supply('NEG', -3), supply('NAN', Number.NaN), supply('INF', Infinity)),
      market('polygon', supply(' dot ', 1)),
    ));
    const held = await getHeldNow(T_A, { aaveWaitMs: 1000 });
    expect(asObject(held)).toEqual({ DOT: { qty: 3, valueUsd: null } });
  });

  it('maps WPOL and WMATIC to POL and WAVAX to AVAX, but leaves WETH and WBTC as they are', async () => {
    expect(AAVE_SYMBOL_NORMALIZE).toEqual({ WPOL: 'POL', WMATIC: 'POL', WAVAX: 'AVAX' });
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockResolvedValue(answer(
      market('polygon', supply('WPOL', 10), supply('wmatic', 5)),
      market('avalanche', supply('WAVAX', 4)),
      market('ethereum', supply('WETH', 0.3), supply('WBTC', 0.02)),
    ));
    const held = await getHeldNow(T_A, { aaveWaitMs: 1000 });
    expect(asObject(held)).toEqual({
      POL: { qty: 15, valueUsd: null },
      AVAX: { qty: 4, valueUsd: null },
      WETH: { qty: 0.3, valueUsd: null },
      WBTC: { qty: 0.02, valueUsd: null },
    });
  });

  it('asks Aave once per wallet, even when the same EVM address is stored in two spellings', async () => {
    state.wallets.set(T_A, [ADDR_A, ADDR_A.toUpperCase().replace('0X', '0x'), ADDR_B]);
    aave.getAavePositionsForWallet.mockResolvedValue(answer(market('ethereum', supply('DOT', 1))));
    const held = await getHeldNow(T_A, { aaveWaitMs: 1000 });
    expect(aave.getAavePositionsForWallet).toHaveBeenCalledTimes(2);
    expect(held.get('DOT')).toEqual({ qty: 2, valueUsd: null });
  });

  it('two calls at once share one refresh', async () => {
    state.wallets.set(T_A, [ADDR_A]);
    const slow = deferred<unknown>();
    aave.getAavePositionsForWallet.mockReturnValueOnce(slow.promise);
    const a = getHeldNow(T_A, { aaveWaitMs: 1000 });
    const b = getHeldNow(T_A, { aaveWaitMs: 1000 });
    slow.resolve(answer(market('ethereum', supply('DOT', 1))));
    const [ha, hb] = await Promise.all([a, b]);
    expect(asObject(ha)).toEqual({ DOT: { qty: 1, valueUsd: null } });
    expect(asObject(hb)).toEqual({ DOT: { qty: 1, valueUsd: null } });
    expect(aave.getAavePositionsForWallet).toHaveBeenCalledTimes(1);
  });

  it('serves a fresh entry from the cache, and refreshes once it is older than 10 minutes', async () => {
    state.wallets.set(T_A, [ADDR_A]);
    let clock = 1_000_000;
    const now = () => clock;
    aave.getAavePositionsForWallet.mockResolvedValueOnce(answer(market('ethereum', supply('DOT', 1))));
    await getHeldNow(T_A, { aaveWaitMs: 1000, now });

    clock += 9 * MIN;
    expect(asObject(await getHeldNow(T_A, { aaveWaitMs: 1000, now }))).toEqual({ DOT: { qty: 1, valueUsd: null } });
    expect(aave.getAavePositionsForWallet).toHaveBeenCalledTimes(1);

    clock += 2 * MIN;
    aave.getAavePositionsForWallet.mockResolvedValueOnce(answer(market('ethereum', supply('DOT', 4))));
    expect(asObject(await getHeldNow(T_A, { aaveWaitMs: 1000, now }))).toEqual({ DOT: { qty: 4, valueUsd: null } });
    expect(aave.getAavePositionsForWallet).toHaveBeenCalledTimes(2);
  });
});

describe('getHeldNow: Aave failures are never fatal', () => {
  async function primeGoodEntry(now: () => number) {
    state.snapshots.set(T_A, [payload(token('ETH', 1, 2000))]);
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockResolvedValueOnce(answer(market('ethereum', supply('DOT', 5))));
    const held = await getHeldNow(T_A, { aaveWaitMs: 1000, now });
    expect(held.get('DOT')).toEqual({ qty: 5, valueUsd: null });
  }
  const withGoodEntry = { ETH: { qty: 1, valueUsd: 2000 }, DOT: { qty: 5, valueUsd: null } };

  const failures: Array<[string, () => void]> = [
    ['the client throws', () => { aave.getAavePositionsForWallet.mockRejectedValueOnce(new Error('network down')); }],
    ['the client reports ok: false', () => { aave.getAavePositionsForWallet.mockResolvedValueOnce({ ok: false, address: ADDR_A, chains: [], error: 'boom' }); }],
    ['every market fails while the top level stays ok', () => { aave.getAavePositionsForWallet.mockResolvedValueOnce(outage()); }],
  ];
  for (const [label, failNext] of failures) {
    it(`when ${label}, getHeldNow resolves and keeps the previous good entry`, async () => {
      let clock = 5_000_000;
      const now = () => clock;
      await primeGoodEntry(now);

      clock += 11 * MIN; // stale, so the next call refreshes
      failNext();
      expect(asObject(await getHeldNow(T_A, { aaveWaitMs: 1000, now }))).toEqual(withGoodEntry);
      // ...and the good entry is still there for the call after that.
      aave.getAavePositionsForWallet.mockResolvedValueOnce(outage());
      expect(asObject(await getHeldNow(T_A, { aaveWaitMs: 1000, now }))).toEqual(withGoodEntry);
    });
  }

  it('stops using an entry older than 24 hours when Aave cannot be reached', async () => {
    let clock = 9_000_000;
    const now = () => clock;
    await primeGoodEntry(now);
    clock += 24 * HOUR + MIN;
    aave.getAavePositionsForWallet.mockResolvedValueOnce(outage());
    expect(asObject(await getHeldNow(T_A, { aaveWaitMs: 1000, now }))).toEqual({ ETH: { qty: 1, valueUsd: 2000 } });
  });

  // Vitest fails the run on any unhandled rejection, so these pass only if the refresh never rejects.
  it('a refresh that fails with an unprintable error never rejects, even when nobody is waiting on it', async () => {
    const unprintable = { toString() { throw new Error('cannot print'); } };
    // Nobody waits here: the snapshot query fails, so getHeldNow throws before it would wait on the refresh.
    state.failSnapshots = true;
    state.failWallets = unprintable;
    await expect(getHeldNow(T_A, { aaveWaitMs: 1000 })).rejects.toThrow('snapshot query failed');
    await settle();

    // One wallet's lookup failing the same way is skipped like any other failure.
    state.failSnapshots = false;
    state.failWallets = null;
    state.snapshots.set(T_A, [payload(token('ETH', 1, 2000))]);
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockRejectedValueOnce(unprintable);
    expect(asObject(await getHeldNow(T_A, { aaveWaitMs: 1000 }))).toEqual({ ETH: { qty: 1, valueUsd: 2000 } });
    expect(aave.getAavePositionsForWallet).toHaveBeenCalledTimes(1);
  });

  it('a market that fails beside one that answers still refreshes the entry', async () => {
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockResolvedValueOnce(answer(market('ethereum', supply('DOT', 2)), failedMarket('polygon'), unconfiguredMarket('ethereum_v4')));
    expect(asObject(await getHeldNow(T_A, { aaveWaitMs: 1000 }))).toEqual({ DOT: { qty: 2, valueUsd: null } });
  });

  it('gives up on a refresh that hangs past 25 seconds, so the next call starts a new one', async () => {
    vi.useFakeTimers();
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockReturnValueOnce(new Promise(() => {})); // never settles

    const first = getHeldNow(T_A, { aaveWaitMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(asObject(await first)).toEqual({});

    await vi.advanceTimersByTimeAsync(25_000);
    aave.getAavePositionsForWallet.mockResolvedValueOnce(answer(market('ethereum', supply('DOT', 1))));
    const second = getHeldNow(T_A, { aaveWaitMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(asObject(await second)).toEqual({ DOT: { qty: 1, valueUsd: null } });
    expect(aave.getAavePositionsForWallet).toHaveBeenCalledTimes(2);
  });
});

describe('getHeldNow: tenants never share Aave data', () => {
  it("one tenant's cached supply never shows up for another", async () => {
    state.wallets.set(T_A, [ADDR_A]);
    state.wallets.set(T_B, [ADDR_B]);
    aave.getAavePositionsForWallet.mockImplementation(async (address: string) =>
      address === ADDR_A ? answer(market('ethereum', supply('DOT', 7))) : answer(market('ethereum')),
    );

    expect(asObject(await getHeldNow(T_A, { aaveWaitMs: 1000 }))).toEqual({ DOT: { qty: 7, valueUsd: null } });
    expect(asObject(await getHeldNow(T_B, { aaveWaitMs: 1000 }))).toEqual({});
    // A is still served from its own cache entry; B made its own lookup with its own wallet.
    expect(asObject(await getHeldNow(T_A, { aaveWaitMs: 1000 }))).toEqual({ DOT: { qty: 7, valueUsd: null } });

    expect(aave.getAavePositionsForWallet.mock.calls.map((c) => c[0])).toEqual([ADDR_A, ADDR_B]);
    for (const c of state.calls) {
      const tenant = c.args[0];
      expect(c.args.every((a) => a === tenant), c.sql).toBe(true);
    }
  });

  it('a tenant with no on-chain wallets gets no Aave supply and makes no Aave call', async () => {
    state.wallets.set(T_A, [ADDR_A]);
    aave.getAavePositionsForWallet.mockResolvedValue(answer(market('ethereum', supply('DOT', 7))));
    await getHeldNow(T_A, { aaveWaitMs: 1000 });
    aave.getAavePositionsForWallet.mockClear();

    expect(asObject(await getHeldNow(T_B, { aaveWaitMs: 1000 }))).toEqual({});
    expect(aave.getAavePositionsForWallet).not.toHaveBeenCalled();
  });
});
