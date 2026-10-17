import { describe, it, expect, vi } from 'vitest';

/**
 * Pricing and dust-flooring of coins only Aave supplies. All of it is pure; the two mocks below only
 * keep the module's imports from reaching a database or the network. Every symbol, amount and price
 * here is invented.
 */
vi.mock('@/lib/db', () => ({
  db: {
    execute: async () => {
      throw new Error('the pure helpers must not touch the database');
    },
  },
}));
vi.mock('@/lib/aave/client', () => ({ getAavePositionsForWallet: vi.fn() }));

import {
  aaveSymbolPrice,
  settleAaveOnlyHoldings,
  mergeAaveSupply,
  AAVE_PRICE_ALIAS,
  type HeldNow,
} from '../../src/lib/currentHoldings';

// Invented prices. ZED is an invented coin: it is priced, but nothing derived from its name is.
const prices = new Map<string, number>([
  ['ETH', 2000],
  ['AVAX', 20],
  ['POL', 0.5],
  ['BTC', 60000],
  ['WBTC', 59900],
  ['ZED', 10],
]);
const held = (entries: Array<[string, number, number | null]>): HeldNow =>
  new Map(entries.map(([sym, qty, valueUsd]) => [sym, { qty, valueUsd }]));

describe('aaveSymbolPrice', () => {
  it('prices a 1:1 wrapper as its base coin', () => {
    expect(aaveSymbolPrice('WETH', prices)).toBe(2000);
    expect(aaveSymbolPrice('WPOL', prices)).toBe(0.5);
    expect(aaveSymbolPrice('WMATIC', prices)).toBe(0.5);
    expect(aaveSymbolPrice('WAVAX', prices)).toBe(20);
  });

  it('prices stablecoins at $1 without any ticker', () => {
    for (const s of ['USDC', 'USDT', 'USDT0', 'USDC.E', 'USDT.E']) {
      expect(aaveSymbolPrice(s, new Map()), s).toBe(1);
    }
  });

  it('uses the coin\'s own ticker when it trades apart from its base (WBTC is not BTC)', () => {
    expect(aaveSymbolPrice('WBTC', prices)).toBe(59900);
  });

  it('does not price a wrapped, staked or bridged lookalike as its base coin, even when the base has a price', () => {
    expect(aaveSymbolPrice('ZED', prices)).toBe(10);
    for (const s of ['WZED', 'STZED', 'ZED.B', 'ZED.E']) {
      expect(aaveSymbolPrice(s, prices), s).toBeNull();
    }
  });

  it('keeps the alias list to the four true 1:1 wrappers', () => {
    expect(Object.keys(AAVE_PRICE_ALIAS).sort()).toEqual(['WAVAX', 'WETH', 'WMATIC', 'WPOL']);
  });

  it('is tolerant of case and spaces, and returns null for no price, a zero price or a bad price', () => {
    expect(aaveSymbolPrice(' weth ', prices)).toBe(2000);
    expect(aaveSymbolPrice('NOSUCH', prices)).toBeNull();
    expect(aaveSymbolPrice('', prices)).toBeNull();
    expect(aaveSymbolPrice('ETH', new Map([['ETH', 0]]))).toBeNull();
    expect(aaveSymbolPrice('ETH', new Map([['ETH', Number.NaN]]))).toBeNull();
  });
});

describe('settleAaveOnlyHoldings', () => {
  const priceOf = (s: string) => aaveSymbolPrice(s, prices);

  it('keeps an Aave-only coin priced at or above the floor and gives it that value', () => {
    const out = settleAaveOnlyHoldings(held([['WETH', 0.01, null]]), priceOf);
    expect(out.get('WETH')).toEqual({ qty: 0.01, valueUsd: 20 });
  });

  it('drops an Aave-only coin worth less than the floor (dust)', () => {
    const out = settleAaveOnlyHoldings(held([['WETH', 0.0001, null]]), priceOf);
    expect(out.has('WETH')).toBe(false);
  });

  it('keeps a coin exactly at the floor and drops one just under it', () => {
    const out = settleAaveOnlyHoldings(held([['USDC', 1, null], ['USDT', 0.999, null]]), priceOf);
    expect(out.has('USDC')).toBe(true);
    expect(out.has('USDT')).toBe(false);
  });

  it('drops an Aave-only coin that cannot be priced', () => {
    const out = settleAaveOnlyHoldings(held([['STZED', 5, null], ['ZED.B', 1, null]]), priceOf);
    expect(out.size).toBe(0);
  });

  it('leaves entries that already carry a snapshot value untouched, even when no ticker prices them', () => {
    const out = settleAaveOnlyHoldings(held([['OBSCURE', 3, 12.5]]), () => null);
    expect(out.get('OBSCURE')).toEqual({ qty: 3, valueUsd: 12.5 });
  });

  it('does not change its input', () => {
    const input = held([['WETH', 0.01, null], ['STZED', 5, null]]);
    settleAaveOnlyHoldings(input, priceOf);
    expect([...input.keys()]).toEqual(['WETH', 'STZED']);
    expect(input.get('WETH')).toEqual({ qty: 0.01, valueUsd: null });
  });

  it('with no ticker prices at all, only stablecoins survive among Aave-only coins', () => {
    const noPrices = (s: string) => aaveSymbolPrice(s, new Map());
    const out = settleAaveOnlyHoldings(held([['WETH', 5, null], ['USDC', 50, null]]), noPrices);
    expect([...out.keys()]).toEqual(['USDC']);
  });

  it('after an Aave merge: a wallet-held coin keeps its value, a priced Aave-only coin stays, an unpriced one goes', () => {
    const merged = mergeAaveSupply(held([['ETH', 1, 2000]]), new Map([['ETH', 0.5], ['WETH', 0.01], ['STZED', 4]]));
    const out = settleAaveOnlyHoldings(merged, priceOf);
    expect(out.get('ETH')).toEqual({ qty: 1.5, valueUsd: 2000 });
    expect(out.get('WETH')).toEqual({ qty: 0.01, valueUsd: 20 });
    expect(out.has('STZED')).toBe(false);
  });
});
