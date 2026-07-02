import { describe, it, expect } from 'vitest';
import { effectiveClass, lookupOverride, type OverrideMaps } from '@/lib/tokenOverrides';

describe('effectiveClass — override wins over heuristic', () => {
  it('no override → heuristic (scam collapses to spam)', () => {
    expect(effectiveClass('clean', null)).toBe('clean');
    expect(effectiveClass('spam', null)).toBe('spam');
    expect(effectiveClass('scam', null)).toBe('spam');
  });
  it('include → clean (false-positive recovery)', () => {
    expect(effectiveClass('spam', 'include')).toBe('clean');
    expect(effectiveClass('scam', 'include')).toBe('clean');
  });
  it('junk → spam (confirm)', () => {
    expect(effectiveClass('clean', 'junk')).toBe('spam');
  });
  it('income → income', () => {
    expect(effectiveClass('clean', 'income')).toBe('income');
    expect(effectiveClass('spam', 'income')).toBe('income');
  });
});

describe('lookupOverride — contract match beats symbol match', () => {
  const maps: OverrideMaps = {
    byContract: new Map([['polygon|0xabc', 'include']]),
    bySymbol: new Map([['USDC', 'junk']]),
  };
  it('contract match returns contract decision', () => {
    expect(lookupOverride(maps, { chain: 'polygon', contract: '0xABC', symbol: 'USDC' })).toBe('include');
  });
  it('symbol-only match when no contract', () => {
    expect(lookupOverride(maps, { symbol: 'USDC' })).toBe('junk');
  });
  it('no match → null', () => {
    expect(lookupOverride(maps, { symbol: 'ETH' })).toBeNull();
  });
});
