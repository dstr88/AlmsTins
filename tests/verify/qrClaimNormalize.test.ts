import { describe, it, expect } from 'vitest';
import { normalizeDestinationValue } from '../../src/lib/verifyRegistry';

/**
 * The QR/payment-link claim model only works if the value a merchant REGISTERS and
 * the value a customer SCANS canonicalize to the same string. createDestination()
 * stores the normalized form; lookupVerifiedUrl() normalizes the scanned value and
 * compares. These assert the two sides meet for the variations a real Stripe QR and
 * a hand-typed link produce.
 */
describe('verify QR claim — URL normalization (registration ↔ scan match)', () => {
  const canonical = 'https://buy.stripe.com/abc123';

  it('matches across trailing slash, case, and tracking query params', () => {
    const variants = [
      'https://buy.stripe.com/abc123',
      'https://buy.stripe.com/abc123/',          // trailing slash (some QR encoders add it)
      'https://BUY.stripe.com/abc123',           // host case
      'HTTPS://buy.stripe.com/abc123',           // scheme case
      'https://buy.stripe.com/abc123?utm=qr',     // tracking param appended at point-of-sale
      'https://buy.stripe.com/abc123#section',    // fragment
      '  https://buy.stripe.com/abc123  ',        // surrounding whitespace
    ];
    for (const v of variants) {
      expect(normalizeDestinationValue(v)).toBe(canonical);
    }
  });

  it('keeps path case (Stripe slugs are case-sensitive) so different links stay distinct', () => {
    expect(normalizeDestinationValue('https://buy.stripe.com/abcXYZ'))
      .not.toBe(normalizeDestinationValue('https://buy.stripe.com/abcxyz'));
  });

  it('distinguishes a swapped link (different host) — the QR-swap attack', () => {
    const real = normalizeDestinationValue('https://buy.stripe.com/abc123');
    const swapped = normalizeDestinationValue('https://buy.str1pe.com/abc123');
    expect(real).not.toBe(swapped);
  });

  it('returns empty for blank input', () => {
    expect(normalizeDestinationValue('')).toBe('');
    expect(normalizeDestinationValue('   ')).toBe('');
  });
});
