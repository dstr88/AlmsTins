import { describe, it, expect } from 'vitest';
import { txtRecordsContainChallenge } from '../../src/lib/verifyProof';

/**
 * DNS TXT proof: the merchant adds a TXT record carrying the account-bound challenge
 * token (e.g. "almstins-verify-ab12…"). We accept the proof when ANY published record
 * carries the token — tolerant of other records (SPF, DKIM) and common wrapper text.
 */
describe('verify DNS TXT — challenge matching', () => {
  const challenge = 'almstins-verify-ab12cd34ef56';

  it('matches when a record carries the exact token', () => {
    expect(txtRecordsContainChallenge([challenge], challenge)).toBe(true);
  });

  it('matches alongside unrelated records (SPF/DKIM) and with wrapper text', () => {
    const records = [
      'v=spf1 include:_spf.google.com ~all',
      `almstins-verify=${challenge}`,
      'google-site-verification=xyz',
    ];
    expect(txtRecordsContainChallenge(records, challenge)).toBe(true);
  });

  it('does not match a wrong/absent token', () => {
    expect(txtRecordsContainChallenge(['v=spf1 ~all', 'almstins-verify-deadbeef'], challenge)).toBe(false);
    expect(txtRecordsContainChallenge([], challenge)).toBe(false);
  });

  it('an empty challenge never matches (fail closed)', () => {
    expect(txtRecordsContainChallenge([challenge], '')).toBe(false);
  });
});
