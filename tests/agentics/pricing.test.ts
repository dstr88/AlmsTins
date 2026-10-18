import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COIN_IDS, PRICE_RETRY_WINDOW_MS, defaultPricing, memoizePricing, priceTransfer, type PricingDeps } from '../../src/lib/agentVault/pricing';
import type { Transfer } from '../../src/lib/agentVault/transfers';
import { addr } from '../helpers/agentVault';
import { COPYCAT_USDC, USDC_ETHEREUM, blockTime } from '../helpers/fakeExplorer';

/**
 * What a transfer was worth when it happened. The ledger is append-only, so these rules lean toward
 * "no value on record" over a made-up one. The price lookups are replaced; nothing here uses the network.
 */

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  chain: 'ethereum', hash: `0x${'1'.repeat(64)}`, leg: 'native:0', atSec: Math.floor((NOW - DAY_MS) / 1000), blockNumber: 1,
  direction: 'out', wallet: addr(1), counterparty: addr(2), amount: '2', asset: 'ETH', assetContract: null, source: 'txlist', ...over,
});
const token = (symbol: string, contract: string, amount = '100', over: Partial<Transfer> = {}) =>
  transfer({ asset: symbol, assetContract: contract, amount, source: 'tokentx', ...over });

function fakePrices(table: Record<string, number | null> = {}) {
  const asked: Array<[string, string]> = [];
  const deps: PricingDeps = {
    async unitPriceUsd(coinId, day) {
      asked.push([coinId, day]);
      return table[`${coinId}|${day}`] ?? table[coinId] ?? null;
    },
  };
  return { deps, asked };
}

describe('stablecoins on their known contract', () => {
  it('count at one dollar with no lookup', async () => {
    const { deps, asked } = fakePrices();
    const r = await priceTransfer(token('USDC', USDC_ETHEREUM, '250.5'), NOW, deps);
    expect(r).toEqual({ kind: 'priced', usd: 250.5, unitUsd: 1, basis: 'stablecoin_peg', day: new Date(NOW - DAY_MS).toISOString().slice(0, 10) });
    expect(asked).toEqual([]);
  });

  it('a bridged symbol (USDC.e on Avalanche) counts too, on its known contract', async () => {
    const { deps } = fakePrices();
    const r = await priceTransfer(token('USDC.e', '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664', '10', { chain: 'avalanche' }), NOW, deps);
    expect(r).toMatchObject({ kind: 'priced', usd: 10, basis: 'stablecoin_peg' });
  });

  it('a token that copies the symbol from another contract has no value', async () => {
    const { deps, asked } = fakePrices();
    expect(await priceTransfer(token('USDC', COPYCAT_USDC), NOW, deps)).toEqual({ kind: 'unpriced', reason: 'unknown_token' });
    expect(asked).toEqual([]);
  });

  it('the right contract on the wrong chain is not known either', async () => {
    const { deps } = fakePrices();
    expect(await priceTransfer(token('USDC', USDC_ETHEREUM, '1', { chain: 'polygon' }), NOW, deps)).toEqual({ kind: 'unpriced', reason: 'unknown_token' });
  });
});

describe('the chain\'s own coin and the short list of known tokens', () => {
  it('prices a coin at the day\'s price, with the id from the list', async () => {
    const day = new Date(NOW - DAY_MS).toISOString().slice(0, 10);
    const { deps, asked } = fakePrices({ [`ethereum|${day}`]: 2500 });
    const r = await priceTransfer(transfer({ amount: '2' }), NOW, deps);
    expect(r).toEqual({ kind: 'priced', usd: 5000, unitUsd: 2500, basis: 'daily_price', day });
    expect(asked).toEqual([['ethereum', day]]);
  });

  it('knows each chain\'s coin', async () => {
    const { deps, asked } = fakePrices({ ethereum: 1, 'polygon-ecosystem-token': 1, 'avalanche-2': 1 });
    await priceTransfer(transfer({ chain: 'ethereum', asset: 'ETH' }), NOW, deps);
    await priceTransfer(transfer({ chain: 'polygon', asset: 'POL' }), NOW, deps);
    await priceTransfer(transfer({ chain: 'avalanche', asset: 'AVAX' }), NOW, deps);
    expect(asked.map((a) => a[0])).toEqual(['ethereum', 'polygon-ecosystem-token', 'avalanche-2']);
  });

  it('prices a known token on its known contract by the listed id', async () => {
    const { deps, asked } = fakePrices({ weth: 2000 });
    const r = await priceTransfer(token('WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', '3'), NOW, deps);
    expect(r).toMatchObject({ kind: 'priced', usd: 6000, basis: 'daily_price' });
    expect(asked[0][0]).toBe('weth');
  });

  it('a known token that is not on the short list has no value rather than a guessed one', async () => {
    const { deps, asked } = fakePrices();
    expect(await priceTransfer(token('AAVE', '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'), NOW, deps)).toEqual({ kind: 'unpriced', reason: 'no_price_id' });
    expect(asked).toEqual([]);
  });

  it('an unknown token has no value', async () => {
    const { deps } = fakePrices();
    expect(await priceTransfer(token('MOON', COPYCAT_USDC), NOW, deps)).toEqual({ kind: 'unpriced', reason: 'unknown_token' });
  });

  it('a token named ETH on some contract is not the coin', async () => {
    const { deps, asked } = fakePrices({ ethereum: 2500 });
    expect(await priceTransfer(token('ETH', COPYCAT_USDC), NOW, deps)).toEqual({ kind: 'unpriced', reason: 'unknown_token' });
    expect(asked).toEqual([]);
  });

  it('the list holds six assets, all explicit', () => {
    expect([...COIN_IDS.keys()].sort()).toEqual(['AVAX', 'ETH', 'LINK', 'POL', 'WBTC', 'WETH']);
    expect(COIN_IDS.get('constructor')).toBeUndefined();
  });
});

describe('a price that did not come back', () => {
  it('is not written off while it may still arrive: retry', async () => {
    const { deps } = fakePrices();
    expect(await priceTransfer(transfer({ atSec: Math.floor((NOW - DAY_MS) / 1000) }), NOW, deps)).toEqual({ kind: 'retry' });
  });

  it('is accepted as final once the transfer is older than the window', async () => {
    const { deps } = fakePrices();
    const old = Math.floor((NOW - PRICE_RETRY_WINDOW_MS - 1000) / 1000);
    expect(await priceTransfer(transfer({ atSec: old }), NOW, deps)).toEqual({ kind: 'unpriced', reason: 'no_price' });
  });

  it('the window is a week', () => {
    expect(PRICE_RETRY_WINDOW_MS).toBe(7 * DAY_MS);
  });
});

describe('bad amounts are not priced', () => {
  it.each(['0', '-1', 'abc', ''])('%j', async (amount) => {
    const { deps } = fakePrices({ ethereum: 2500 });
    expect(await priceTransfer(transfer({ amount }), NOW, deps)).toEqual({ kind: 'unpriced', reason: 'bad_amount' });
  });

  it('a value too big to be a number is unpriced, not Infinity', async () => {
    const { deps } = fakePrices({ ethereum: 1e308 });
    expect(await priceTransfer(transfer({ amount: '99999999999' }), NOW, deps)).toEqual({ kind: 'unpriced', reason: 'bad_amount' });
  });
});

describe('memoizePricing asks once per coin and day', () => {
  it('shares the answer, including "no price", within one pass', async () => {
    const asked: string[] = [];
    const inner: PricingDeps = { async unitPriceUsd(c, d) { asked.push(`${c}|${d}`); return c === 'ethereum' ? 10 : null; } };
    const memo = memoizePricing(inner);
    expect(await Promise.all([memo.unitPriceUsd('ethereum', '2026-10-01'), memo.unitPriceUsd('ethereum', '2026-10-01')])).toEqual([10, 10]);
    expect(await memo.unitPriceUsd('weth', '2026-10-01')).toBeNull();
    expect(await memo.unitPriceUsd('weth', '2026-10-01')).toBeNull();
    expect(await memo.unitPriceUsd('ethereum', '2026-10-02')).toBe(10);
    expect(asked).toEqual(['ethereum|2026-10-01', 'weth|2026-10-01', 'ethereum|2026-10-02']);
  });
});

describe('the app\'s CoinGecko helper, behind the default', () => {
  const gecko = vi.hoisted(() => ({ price: vi.fn() }));
  vi.mock('@/lib/coingeckoHistorical', () => ({ getUsdUnitPriceAtTimestampCoinGecko: gecko.price }));
  beforeEach(() => gecko.price.mockReset());

  it('asks for noon UTC of the day and answers the unit price', async () => {
    gecko.price.mockResolvedValue({ unitPriceUsd: 2512.5, pricedAtIso: 'x', source: 'coingecko:range', confidence: 'historical' });
    expect(await defaultPricing.unitPriceUsd('ethereum', '2026-10-17')).toBe(2512.5);
    expect(gecko.price).toHaveBeenCalledWith({ coinId: 'ethereum', timestampUtcIso: '2026-10-17T12:00:00Z' });
  });

  it('answers null for no price, a price that is not positive, and any failure (it never throws)', async () => {
    gecko.price.mockResolvedValueOnce(null);
    expect(await defaultPricing.unitPriceUsd('ethereum', '2026-10-17')).toBeNull();
    gecko.price.mockResolvedValueOnce({ unitPriceUsd: 0 });
    expect(await defaultPricing.unitPriceUsd('ethereum', '2026-10-17')).toBeNull();
    gecko.price.mockResolvedValueOnce({ unitPriceUsd: Number.NaN });
    expect(await defaultPricing.unitPriceUsd('ethereum', '2026-10-17')).toBeNull();
    gecko.price.mockRejectedValueOnce(new Error('429'));
    expect(await defaultPricing.unitPriceUsd('ethereum', '2026-10-17')).toBeNull();
  });
});

describe('the time of a transfer', () => {
  it('is read from the block\'s time, in UTC', async () => {
    const { deps, asked } = fakePrices({ ethereum: 1 });
    await priceTransfer(transfer({ atSec: blockTime(1000) }), blockTime(1000) * 1000 + 1000, deps);
    expect(asked[0][1]).toBe(new Date(blockTime(1000) * 1000).toISOString().slice(0, 10));
  });
});
