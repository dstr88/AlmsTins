import { describe, it, expect, vi } from 'vitest';
import { normalizeDestinationValue } from '../../src/lib/verifyRegistry';

// src/lib/db.ts opens the Postgres pool at import time and throws without
// DATABASE_URL (pg became the default engine in 64b74d1). The URL normalizer
// is pure but reaches it via verifyRegistry.ts -> '@/lib/db', so stub the
// client: this suite needs no database, and any query throws.
vi.mock('@/lib/db', () => {
  const noDb = (): never => { throw new Error('DB-free unit test: db was called'); };
  return { db: { execute: noDb, batch: noDb } };
});

/**
 * The QR/payment-link claim model only works if the value a merchant REGISTERS and
 * the value a customer SCANS canonicalize to the same string. createDestination()
 * stores the normalized form; lookupVerifiedUrl() normalizes the scanned value and
 * compares. These assert the two sides meet for the variations a real Stripe QR and
 * a hand-typed link produce.
 *
 * D6: the query string used to be dropped entirely, which collapsed every PayPal
 * "hosted_button_id=X" link on the same host down to one value — two unrelated
 * merchants' buttons matched as "the same" destination. It's now kept, sorted for
 * stability, and only a small set of known analytics/referral params is dropped.
 */
describe('verify QR claim — URL normalization (registration ↔ scan match)', () => {
  const canonical = 'https://buy.stripe.com/abc123';

  it('matches across trailing slash, host/scheme case, fragment, and surrounding whitespace', () => {
    const variants = [
      'https://buy.stripe.com/abc123',
      'https://buy.stripe.com/abc123/',          // trailing slash (some QR encoders add it)
      'https://BUY.stripe.com/abc123',           // host case
      'HTTPS://buy.stripe.com/abc123',           // scheme case
      'https://buy.stripe.com/abc123#section',    // fragment
      '  https://buy.stripe.com/abc123  ',        // surrounding whitespace
    ];
    for (const v of variants) {
      expect(normalizeDestinationValue(v)).toBe(canonical);
    }
  });

  it('drops known tracking params, so a share link and a QR-appended one still match', () => {
    const variants = [
      'https://buy.stripe.com/abc123?utm_source=qr',
      'https://buy.stripe.com/abc123?utm_source=qr&utm_medium=counter',
      'https://buy.stripe.com/abc123?fbclid=abc',
      'https://buy.stripe.com/abc123?gclid=abc&ref=twitter',
    ];
    for (const v of variants) {
      expect(normalizeDestinationValue(v), v).toBe(canonical);
    }
  });

  it('keeps an identifier query param — D6: two PayPal buttons on the same host must stay distinct', () => {
    const a = normalizeDestinationValue('https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=AAA');
    const b = normalizeDestinationValue('https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=BBB');
    expect(a).not.toBe(b);
  });

  it('is stable across param order (a canonical value never depends on how the QR encoder wrote the query)', () => {
    const x = normalizeDestinationValue('https://buy.stripe.com/abc123?client_reference_id=1&prefilled_email=a%40b.com');
    const y = normalizeDestinationValue('https://buy.stripe.com/abc123?prefilled_email=a%40b.com&client_reference_id=1');
    expect(x).toBe(y);
  });

  it('an identifier param survives alongside a dropped tracking param', () => {
    const withTracking = normalizeDestinationValue('https://buy.stripe.com/abc123?hosted_button_id=AAA&utm_source=qr');
    const withoutTracking = normalizeDestinationValue('https://buy.stripe.com/abc123?hosted_button_id=AAA');
    expect(withTracking).toBe(withoutTracking);
    expect(withTracking).not.toBe(canonical); // the identifier itself is kept, so this is NOT the bare canonical
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
