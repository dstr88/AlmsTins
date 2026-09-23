import { describe, it, expect } from 'vitest';
import { safeNextPath, safeAuthRedirect } from '../../src/lib/safeNext';
import { getPostLoginRedirect } from '../../src/lib/postLoginRedirect';

/**
 * Every `next=` / callback destination must stay on this site. Each hostile value below
 * resolves to another origin in a browser (or normalizes into one), so it must be refused.
 */
const HOSTILE = [
  '//evil.com',
  '/\\evil.com',
  '/%5Cevil.com',
  '/%5cevil.com',
  '/%2F%2Fevil.com',
  '/%2f%2fevil.com',
  '/.//evil.com',
  '/..//evil.com',
  '/%2e//evil.com',
  '/%2E%2E//evil.com',
  '/.%2F%2Fevil.com',
  '/receivables/..//evil.com',
  '/verify/../..//evil.com',
  '/\t/evil.com',
  '/\n/evil.com',
  'https://evil.com',
  'http:evil.com',
  'javascript:alert(1)',
  'evil.com',
  'dashboard',
  '',
  '%2F%2Fevil.com',
  '/%E0%A4%A',
];

describe('safeNextPath', () => {
  it('refuses every value that could leave the site', () => {
    for (const h of HOSTILE) expect(safeNextPath(h), JSON.stringify(h)).toBeNull();
  });

  it('refuses non-strings and oversized values', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(42)).toBeNull();
    expect(safeNextPath('/' + 'a'.repeat(2048))).toBeNull();
  });

  it('keeps real destinations, query and tokens intact, and drops the hash', () => {
    expect(safeNextPath('/dashboard/verify')).toBe('/dashboard/verify');
    expect(safeNextPath('/verify/invite?token=abc_DEF-123')).toBe('/verify/invite?token=abc_DEF-123');
    expect(safeNextPath('/verify/desk?id=INV-4471&tab=claims')).toBe('/verify/desk?id=INV-4471&tab=claims');
    expect(safeNextPath('/api/demo/start?next=%2Fdashboard%2Fverify')).toBe('/api/demo/start?next=%2Fdashboard%2Fverify');
    expect(safeNextPath('/verify/scan#top')).toBe('/verify/scan');
    expect(safeNextPath('/')).toBe('/');
  });

  it('normalizes harmless dot segments instead of passing them through', () => {
    expect(safeNextPath('/verify/../dashboard/verify')).toBe('/dashboard/verify');
  });
});

describe('getPostLoginRedirect', () => {
  it('falls back to /dashboard for anything unsafe or missing', () => {
    expect(getPostLoginRedirect(null)).toBe('/dashboard');
    expect(getPostLoginRedirect('/\\evil.com')).toBe('/dashboard');
    expect(getPostLoginRedirect('/.//evil.com')).toBe('/dashboard');
  });

  it('keeps the API remap and real paths', () => {
    expect(getPostLoginRedirect('/api/anything')).toBe('/onboarding/tenant-setup');
    expect(getPostLoginRedirect('/dashboard/verify')).toBe('/dashboard/verify');
  });
});

describe('safeAuthRedirect (Auth.js redirect callback)', () => {
  const base = 'https://almstins.com';
  const fallback = 'https://almstins.com/dashboard';

  it('sends bare base URLs to the fallback', () => {
    expect(safeAuthRedirect(base, base, '/dashboard')).toBe(fallback);
    expect(safeAuthRedirect(base + '/', base, '/dashboard')).toBe(fallback);
  });

  it('keeps same-origin destinations, relative or absolute', () => {
    expect(safeAuthRedirect('/verify/desk', base, '/dashboard')).toBe(base + '/verify/desk');
    expect(safeAuthRedirect(base + '/dashboard/verify?x=1', base, '/dashboard')).toBe(base + '/dashboard/verify?x=1');
  });

  it('refuses other origins and every hostile path', () => {
    expect(safeAuthRedirect('https://evil.com/x', base, '/dashboard')).toBe(fallback);
    expect(safeAuthRedirect('https://almstins.com.evil.com/x', base, '/dashboard')).toBe(fallback);
    expect(safeAuthRedirect(base + '.evil.com/x', base, '/dashboard')).toBe(fallback);
    for (const h of HOSTILE) {
      expect(new URL(safeAuthRedirect(h, base, '/dashboard')).origin, JSON.stringify(h)).toBe(base);
    }
    expect(new URL(safeAuthRedirect(base + '/.//evil.com', base, '/dashboard')).origin).toBe(base);
  });
});
