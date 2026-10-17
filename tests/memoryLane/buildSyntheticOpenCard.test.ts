import { describe, it, expect } from 'vitest';
import { buildSyntheticOpenCard, type RosterEntry } from '../../src/lib/memoryLane';

/**
 * The Open card for a held coin with no lot still open at the selected year-end. Every symbol and
 * number below is invented.
 */

const roster = (netQty: number, weightedAvgCost: number): RosterEntry => ({
  netQty,
  weightedAvgCost,
  latestAcquiredAt: '2024-01-01T00:00:00Z',
  lastEventAt: '2025-01-01T00:00:00Z',
});

describe('buildSyntheticOpenCard', () => {
  it('takes its quantity from the wallets, not the roster', () => {
    const card = buildSyntheticOpenCard({ symbol: 'DOT', roster: roster(2, 5), held: { qty: 10, valueUsd: 80 }, price: 7 });
    expect(card.totalQty).toBe(10);
    expect(card.totalCost).toBe(50); // the roster's average cost times the wallet quantity
  });

  it('falls back to the roster quantity when the wallets have none', () => {
    expect(buildSyntheticOpenCard({ symbol: 'DOT', roster: roster(3, 5), price: 7 }).totalQty).toBe(3);
    expect(buildSyntheticOpenCard({ symbol: 'DOT', roster: roster(3, 5), held: { qty: 0, valueUsd: null }, price: 7 }).totalQty).toBe(3);
    expect(buildSyntheticOpenCard({ symbol: 'DOT', roster: roster(-2, 5), price: 7 }).totalQty).toBe(0);
  });

  it('with no known cost basis, leaves the unrealized figure blank instead of calling the whole value a gain', () => {
    const card = buildSyntheticOpenCard({ symbol: 'ADA', roster: roster(0, 0), held: { qty: 100, valueUsd: 40 } });
    expect(card.currentValue).toBe(40);
    expect(card.totalCost).toBe(0);
    expect(card.unrealizedGainLoss).toBeNull();
  });

  it('with a known cost basis, the unrealized figure is value minus cost', () => {
    const card = buildSyntheticOpenCard({ symbol: 'ADA', roster: roster(0, 0.3), held: { qty: 100, valueUsd: 45 } });
    expect(card.totalCost).toBeCloseTo(30, 10);
    expect(card.unrealizedGainLoss).toBeCloseTo(15, 10);
    expect(card.currentPrice).toBeCloseTo(0.45, 10);
  });

  it('prices the quantity at the market price when the wallets carry no value (an Aave supply position)', () => {
    const card = buildSyntheticOpenCard({ symbol: 'DOT', roster: roster(0, 4), held: { qty: 5, valueUsd: null }, price: 6 });
    expect(card.currentValue).toBe(30);
    expect(card.currentPrice).toBe(6);
    expect(card.totalCost).toBe(20);
    expect(card.unrealizedGainLoss).toBe(10);
  });

  it('a zero wallet value also falls back to the market price', () => {
    const card = buildSyntheticOpenCard({ symbol: 'DOT', held: { qty: 2, valueUsd: 0 }, price: 6 });
    expect(card.currentValue).toBe(12);
  });

  it('a coin only the wallets know, with no roster and no price, has no value and no unrealized figure', () => {
    const card = buildSyntheticOpenCard({ symbol: 'ZED', held: { qty: 4, valueUsd: null }, price: null });
    expect(card).toEqual({
      asset: 'ZED',
      totalQty: 4,
      totalCost: 0,
      currentPrice: null,
      currentValue: null,
      unrealizedGainLoss: null,
      shortTermQty: 0,
      longTermQty: 0,
      soonestLotDaysToLT: null,
      noYearActivity: true,
    });
  });

  it('marks the card as having no activity in the selected year and no lot terms', () => {
    const card = buildSyntheticOpenCard({ symbol: 'DOT', roster: roster(3, 5), price: 7 });
    expect(card).toMatchObject({ asset: 'DOT', shortTermQty: 0, longTermQty: 0, soonestLotDaysToLT: null, noYearActivity: true });
    expect(card.currentValue).toBe(21);
    expect(card.unrealizedGainLoss).toBe(6);
  });
});
