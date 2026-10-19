import { describe, it, expect } from 'vitest';
import { CHECKS_PER_WINDOW, CHECK_WINDOW_MS, createCheckBudget, defaultCheckBudget } from '../../src/lib/agentVault/checkBudget';

/**
 * The budget of address checks an account may start in a minute (src/lib/agentVault/checkBudget.ts):
 * counted in addresses, per account, per process. Pure, so every rule is a plain assertion; the clock
 * is passed in. Every account id is invented.
 */

const T0 = 1_760_000_000_000;

describe('the budget of checks', () => {
  it('is 30 addresses a minute, so fifteen addresses checked twice over still fit', () => {
    expect(CHECKS_PER_WINDOW).toBe(30);
    expect(CHECK_WINDOW_MS).toBe(60_000);
    const budget = createCheckBudget();
    expect(budget.spend('a', 15, T0)).toBe(true);
    expect(budget.spend('a', 15, T0 + 1)).toBe(true);
    expect(budget.spend('a', 1, T0 + 2)).toBe(false);
  });

  it('spends in addresses, not requests: ten at once costs ten, one costs one', () => {
    const budget = createCheckBudget({ max: 12 });
    expect(budget.spend('a', 10, T0)).toBe(true);
    expect(budget.spend('a', 1, T0)).toBe(true);
    expect(budget.spend('a', 1, T0)).toBe(true);
    expect(budget.spend('a', 1, T0)).toBe(false);
  });

  it('takes nothing when it refuses: a request that does not fit leaves the room that was left', () => {
    const budget = createCheckBudget({ max: 12 });
    expect(budget.spend('a', 10, T0)).toBe(true);
    expect(budget.spend('a', 5, T0)).toBe(false); // would be 15
    expect(budget.spend('a', 2, T0)).toBe(true); // the two that were left are still there
    expect(budget.spend('a', 1, T0)).toBe(false);
  });

  it('refuses a request bigger than the whole budget, and never takes part of it', () => {
    const budget = createCheckBudget({ max: 12 });
    expect(budget.spend('a', 13, T0)).toBe(false);
    expect(budget.spend('a', 12, T0)).toBe(true);
  });

  it('is for each account: one account spending it all leaves the others theirs', () => {
    const budget = createCheckBudget({ max: 5 });
    expect(budget.spend('a', 5, T0)).toBe(true);
    expect(budget.spend('a', 1, T0)).toBe(false);
    expect(budget.spend('b', 5, T0)).toBe(true);
  });

  it('is open again once its window has passed, and not a moment before', () => {
    const budget = createCheckBudget({ max: 5, windowMs: 60_000 });
    expect(budget.spend('a', 5, T0)).toBe(true);
    expect(budget.spend('a', 1, T0 + 59_999)).toBe(false);
    expect(budget.spend('a', 1, T0 + 60_000)).toBe(true);
    expect(budget.spend('a', 5, T0 + 60_001)).toBe(false); // the new window has one spent
    expect(budget.spend('a', 4, T0 + 60_001)).toBe(true);
  });

  it('asking for nothing costs nothing and is always allowed', () => {
    const budget = createCheckBudget({ max: 1 });
    expect(budget.spend('a', 1, T0)).toBe(true);
    for (const n of [0, -3, Number.NaN]) expect(budget.spend('a', n, T0), String(n)).toBe(true);
    expect(budget.spend('a', 1, T0)).toBe(false);
  });

  it('keeps no more accounts than its bound, so rotating account ids cannot grow it without limit', () => {
    const budget = createCheckBudget({ max: 5, maxKeys: 50 });
    for (let i = 0; i < 500; i += 1) expect(budget.spend(`tenant-${i}`, 1, T0 + i), String(i)).toBe(true);
    // The newest are still counted; the oldest were dropped to make room (they start afresh).
    expect(budget.spend('tenant-499', 5, T0 + 500)).toBe(false);
    expect(budget.spend('tenant-0', 5, T0 + 500)).toBe(true);
  });

  it('gives back checks that were paid for and not made, inside the window they came from', () => {
    const budget = createCheckBudget({ max: 10 });
    expect(budget.spend('a', 10, T0)).toBe(true);
    expect(budget.spend('a', 1, T0)).toBe(false);
    budget.refund('a', 4, T0 + 1);
    expect(budget.spend('a', 4, T0 + 2)).toBe(true);
    expect(budget.spend('a', 1, T0 + 3)).toBe(false);
  });

  it('never refunds below none used, and cannot buy room: a refund of more than was spent leaves the whole budget, no more', () => {
    const budget = createCheckBudget({ max: 5 });
    expect(budget.spend('a', 2, T0)).toBe(true);
    budget.refund('a', 99, T0);
    expect(budget.spend('a', 5, T0)).toBe(true);
    expect(budget.spend('a', 1, T0)).toBe(false);
  });

  it('ignores a refund for an account with nothing spent, for a window that has passed, and for nothing', () => {
    const budget = createCheckBudget({ max: 5, windowMs: 1_000 });
    budget.refund('nobody', 3, T0);
    expect(budget.spend('nobody', 5, T0)).toBe(true);
    expect(budget.spend('a', 5, T0)).toBe(true);
    budget.refund('a', 5, T0 + 1_000); // the window it was taken from is over; a new one starts empty
    expect(budget.spend('a', 5, T0 + 1_000)).toBe(true);
    expect(budget.spend('a', 1, T0 + 1_000)).toBe(false);
    for (const n of [0, -2, Number.NaN]) budget.refund('a', n, T0 + 1_001);
    expect(budget.spend('a', 1, T0 + 1_002)).toBe(false);
  });

  it('shares one budget across the running server, and starts full', () => {
    expect(defaultCheckBudget.spend('a-tenant-only-this-test-uses', CHECKS_PER_WINDOW)).toBe(true);
    expect(defaultCheckBudget.spend('a-tenant-only-this-test-uses', 1)).toBe(false);
  });
});
