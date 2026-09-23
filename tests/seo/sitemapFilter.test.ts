import { describe, it, expect } from 'vitest';
import { sitemapFilter } from '../../src/lib/seo/sitemapFilter.mjs';

/**
 * The sitemap is a public list. Under /verify/ and /receivables/ only the public landings
 * may appear; desks and single-use-link pages never do. Everything else keeps the old
 * denylist. @astrojs/sitemap hands the filter absolute URLs ending in a slash.
 */
const url = (path: string) => `https://almstins.com${path}`;

describe('sitemap filter', () => {
  it('keeps the public Verify and Receivables landings', () => {
    for (const p of ['/verify/', '/verify/es/', '/verify/fr/', '/verify/agents/', '/receivables/']) {
      expect(sitemapFilter(url(p))).toBe(true);
    }
    expect(sitemapFilter(url('/verify'))).toBe(true);
    expect(sitemapFilter(url('/receivables'))).toBe(true);
  });

  it('drops every desk and single-use-link page under the product prefixes', () => {
    for (const p of [
      '/verify/desk/', '/verify/client/', '/verify/registry/', '/verify/login/', '/verify/scan/',
      '/verify/attest/', '/verify/authenticate/', '/verify/countersign/', '/verify/offer/',
      '/verify/invite/', '/verify/confirm/', '/verify/cairn/', '/verify/cairn-attest/',
      '/verify/agent-keys/', '/verify/runsheet/', '/verify/guide/', '/verify/changelog/',
      '/verify/thanks/', '/receivables/desk/', '/receivables/anything-new/',
    ]) {
      expect(sitemapFilter(url(p)), p).toBe(false);
    }
  });

  it('leaves other pages to the existing denylist', () => {
    expect(sitemapFilter(url('/'))).toBe(true);
    expect(sitemapFilter(url('/verify-record/'))).toBe(true);
    expect(sitemapFilter(url('/wallet-checker/'))).toBe(true);
    expect(sitemapFilter(url('/dashboard/vault/'))).toBe(false);
    expect(sitemapFilter(url('/login/'))).toBe(false);
    expect(sitemapFilter(url('/admin/'))).toBe(false);
  });
});
