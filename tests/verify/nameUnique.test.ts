import { describe, it, expect } from 'vitest';
import { normalizeName } from '../../src/lib/verifyRegistry';

/**
 * Business names are unique like an email handle — the cross-tenant claim collides on
 * the NORMALIZED form, so these assert which variants are treated as the same name.
 */
describe('verify business-name normalization (uniqueness key)', () => {
  it('collides across case and whitespace', () => {
    const k = normalizeName("Joe's Coffee");
    expect(normalizeName("joe's coffee")).toBe(k);
    expect(normalizeName("  Joe's   Coffee  ")).toBe(k);
    expect(normalizeName("JOE'S COFFEE")).toBe(k);
  });

  it('keeps genuinely different names distinct', () => {
    expect(normalizeName("Joe's Coffee")).not.toBe(normalizeName("Joes Coffee")); // apostrophe matters
    expect(normalizeName('Acme Bakery')).not.toBe(normalizeName('Acme Bakeries'));
  });

  it('blank / whitespace-only normalizes to empty (claims nothing)', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('   ')).toBe('');
  });
});
