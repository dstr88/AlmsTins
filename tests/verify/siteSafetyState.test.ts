import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { siteSafetyState } from '../../src/lib/verifyPublicCard';

/**
 * /api/dapp-check normally answers { verdict: 'red' | 'yellow' | 'green', ... }, but it can also
 * answer { error: true, message } (a 400 with no url) or any body with no verdict. Only an explicit
 * 'green' may read as clean ("No known scam signals"); a check that failed must show as an error,
 * never as a false green. The Verify dashboard and the public scan page share this mapping.
 */
describe('site safety state from a dapp-check response', () => {
  it.each([
    ['red', 'danger'],
    ['yellow', 'unclear'],
    ['green', 'clean'],
  ])('verdict %s -> %s', (verdict, state) => {
    expect(siteSafetyState({ verdict })).toBe(state);
  });

  it('a response with no verdict is an error, not clean', () => {
    expect(siteSafetyState({ error: true, message: 'x' })).toBe('error');
    expect(siteSafetyState({})).toBe('error');
  });

  it('an unknown or empty verdict, or no body at all, is an error', () => {
    expect(siteSafetyState({ verdict: 'amber' })).toBe('error');
    expect(siteSafetyState({ verdict: null })).toBe('error');
    expect(siteSafetyState(null)).toBe('error');
    expect(siteSafetyState(undefined)).toBe('error');
  });
});

describe('both Verify surfaces use the shared site mapping', () => {
  const ROOT = path.resolve(__dirname, '../..');
  it.each([
    'src/components/verify/VerifyDashboard.tsx',
    'src/components/verify/VerifyScan.tsx',
  ])('%s maps the dapp-check verdict through siteSafetyState', (rel) => {
    expect(readFileSync(path.join(ROOT, rel), 'utf8')).toContain('siteSafetyState(');
  });
});
