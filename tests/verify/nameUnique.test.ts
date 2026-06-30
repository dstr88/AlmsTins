import { describe, it, expect } from 'vitest';
import { normalizeName, registrableLabel, nameMatchesDomain } from '../../src/lib/verifyRegistry';

/**
 * Business names are reserved like an email handle, but ANCHORED to a proven domain:
 * a name is only claimable by whoever controls the domain it derives from. These assert
 * the matching that gates a claim (the anti-squat anchor), plus the normalization key.
 */
describe('verify business-name normalization (uniqueness key)', () => {
  it('collides across case and whitespace', () => {
    const k = normalizeName("Joe's Coffee");
    expect(normalizeName("joe's coffee")).toBe(k);
    expect(normalizeName("  Joe's   Coffee  ")).toBe(k);
    expect(normalizeName('JOE’S COFFEE'.replace('’', "'"))).toBe(k);
  });

  it('blank / whitespace-only normalizes to empty (claims nothing)', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('   ')).toBe('');
  });
});

describe('verify name ← domain anchoring (registrableLabel)', () => {
  it('extracts the brand label across TLD shapes', () => {
    expect(registrableLabel('starbucks.com')).toBe('starbucks');
    expect(registrableLabel('shop.starbucks.com')).toBe('starbucks');
    expect(registrableLabel('pay.shop.starbucks.com')).toBe('starbucks');
    expect(registrableLabel('starbucks.co.uk')).toBe('starbucks');
    expect(registrableLabel('STARBUCKS.COM')).toBe('starbucks');
  });

  it('a lookalike domain has a different registrable label', () => {
    expect(registrableLabel('starbucks-pay.com')).toBe('starbuckspay');
    expect(registrableLabel('starbucks-pay.com')).not.toBe(registrableLabel('starbucks.com'));
  });
});

describe('verify name ← domain anchoring (nameMatchesDomain)', () => {
  it('a name matches only the domain it derives from', () => {
    expect(nameMatchesDomain('Starbucks', 'starbucks.com')).toBe(true);
    expect(nameMatchesDomain('starbucks', 'shop.starbucks.com')).toBe(true);
    expect(nameMatchesDomain("Joe's Coffee", 'joescoffee.com')).toBe(true); // punctuation/space stripped
  });

  it('blocks the squat: cannot claim a brand from a lookalike or unrelated domain', () => {
    expect(nameMatchesDomain('Starbucks', 'starbucks-pay.com')).toBe(false);
    expect(nameMatchesDomain('Starbucks', 'evil.com')).toBe(false);
    expect(nameMatchesDomain('PayPal', 'starbucks.com')).toBe(false);
  });

  it('empty name never matches', () => {
    expect(nameMatchesDomain('', 'starbucks.com')).toBe(false);
    expect(nameMatchesDomain('   ', 'starbucks.com')).toBe(false);
  });
});
