import { describe, it, expect } from 'vitest';
import {
  toFixedTrimmed, serializeLeaf, orderLeaves, normalizeTimestamp, type CanonicalLeaf,
} from '@/lib/recordProof/leaf';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const mk = (over: Partial<CanonicalLeaf> = {}): CanonicalLeaf => ({
  v: 1, kind: 'disposal', asset: 'ETH', amount: '1.5',
  acquired_at: '2023-06-01T00:00:00.000Z', disposed_at: '2024-03-01T00:00:00.000Z', date: null,
  cost_usd: '1800', proceeds_usd: '3000', gain_usd: '1200', days_held: 274, term: 'short',
  income_kind: null, tx_hash: '0xabc', basis_source: 'recorded', source: 'lifecycle',
  source_trust: 'onchain', election: 'fifo', ...over,
});

describe('toFixedTrimmed', () => {
  it('strips trailing zeros and dot', () => {
    expect(toFixedTrimmed(1.5, 18)).toBe('1.5');
    expect(toFixedTrimmed(2, 2)).toBe('2');
    expect(toFixedTrimmed('3000.00', 2)).toBe('3000');
  });
  it('normalizes -0 to 0', () => {
    expect(toFixedTrimmed(-0, 2)).toBe('0');
    expect(toFixedTrimmed(-0.0001, 2)).toBe('0');
  });
  it('null / undefined / non-finite → null', () => {
    expect(toFixedTrimmed(null, 2)).toBeNull();
    expect(toFixedTrimmed(undefined, 2)).toBeNull();
    expect(toFixedTrimmed(Infinity, 2)).toBeNull();
    expect(toFixedTrimmed(NaN, 2)).toBeNull();
  });
  it('is deterministic for a given value', () => {
    const v = 0.123456789012345;
    expect(toFixedTrimmed(v, 18)).toBe(toFixedTrimmed(v, 18));
  });
});

describe('normalizeTimestamp', () => {
  it('space-separated → ISO Z', () => {
    expect(normalizeTimestamp('2024-03-01 12:00:00')).toBe('2024-03-01T12:00:00.000Z');
  });
  it('null/garbage → null', () => {
    expect(normalizeTimestamp(null)).toBeNull();
    expect(normalizeTimestamp('not a date')).toBeNull();
  });
});

describe('serializeLeaf', () => {
  it('is byte-stable regardless of key insertion order', () => {
    const a = mk();
    const b: CanonicalLeaf = {
      election: 'fifo', source_trust: 'onchain', source: 'lifecycle', basis_source: 'recorded',
      tx_hash: '0xabc', income_kind: null, term: 'short', days_held: 274, gain_usd: '1200',
      proceeds_usd: '3000', cost_usd: '1800', date: null, disposed_at: '2024-03-01T00:00:00.000Z',
      acquired_at: '2023-06-01T00:00:00.000Z', amount: '1.5', asset: 'ETH', kind: 'disposal', v: 1,
    };
    expect(hex(serializeLeaf(a))).toBe(hex(serializeLeaf(b)));
  });
  it('any single value change changes the bytes', () => {
    expect(hex(serializeLeaf(mk()))).not.toBe(hex(serializeLeaf(mk({ gain_usd: '1201' }))));
  });
});

describe('orderLeaves', () => {
  it('shuffled input → identical ordered output (the determinism gate)', () => {
    const leaves = [
      mk({ kind: 'disposal', disposed_at: '2024-03-01T00:00:00.000Z', asset: 'BTC' }),
      mk({ kind: 'income', disposed_at: null, date: '2024-02-01T00:00:00.000Z', asset: 'ETH', income_kind: 'Staking Income' }),
      mk({ kind: 'held', disposed_at: null, acquired_at: '2024-01-01T00:00:00.000Z', asset: 'SOL' }),
      mk({ kind: 'unsettled', disposed_at: null, date: '2024-04-01T00:00:00.000Z', asset: 'XRP', tx_hash: '0xfeed' }),
    ];
    const canonical = (xs: CanonicalLeaf[]) => orderLeaves(xs).map((l) => hex(serializeLeaf(l)));
    const a = canonical(leaves);
    expect(a).toEqual(canonical([leaves[3], leaves[0], leaves[2], leaves[1]]));
    expect(a).toEqual(canonical([leaves[2], leaves[3], leaves[1], leaves[0]]));
  });
});
