import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalUrl } from '../../src/lib/seo/canonical.mjs';

/**
 * The one address a public page is known by (src/lib/seo/canonical.mjs): its canonical tag, its og:url
 * and its sitemap entry. Behind Render the request's host is localhost, and the auth middleware matches
 * public pages without a trailing slash, so both have to be normalized away.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('the canonical address', () => {
  it('is always almstins.com, whatever host the server saw', () => {
    expect(canonicalUrl('https://localhost/about')).toBe('https://almstins.com/about');
    expect(canonicalUrl('http://localhost:10000/privacy')).toBe('https://almstins.com/privacy');
  });

  it('drops the trailing slash, but keeps the root', () => {
    expect(canonicalUrl('https://almstins.com/agentics/')).toBe('https://almstins.com/agentics');
    expect(canonicalUrl('/about/es/')).toBe('https://almstins.com/about/es');
    expect(canonicalUrl('https://almstins.com/')).toBe('https://almstins.com/');
    expect(canonicalUrl('/')).toBe('https://almstins.com/');
    expect(canonicalUrl('')).toBe('https://almstins.com/');
  });

  it('drops the query and the fragment', () => {
    expect(canonicalUrl('https://localhost/about?utm_source=x#top')).toBe('https://almstins.com/about');
    expect(canonicalUrl('/prices?lang=es')).toBe('https://almstins.com/prices');
  });
});

describe('where it is used', () => {
  it('is the default canonical of both page layouts, never the request URL', () => {
    const layout = read('src/layouts/Layout.astro');
    expect(layout).toContain('canonical = canonicalUrl(Astro.url.pathname),');
    expect(layout).not.toContain('canonical = Astro.url.href');
    expect(read('src/layouts/LoginLayout.astro')).toContain('const canonicalHref = canonical ?? canonicalUrl(Astro.url.pathname);');
  });

  it('shapes every sitemap entry', () => {
    expect(read('astro.config.mjs')).toContain('serialize: (item) => ({ ...item, url: canonicalUrl(item.url) })');
  });

  it('names the Agentics docs page', () => {
    expect(read('src/pages/agentics/docs.astro')).toContain('<link rel="canonical" href="https://almstins.com/agentics/docs" />');
  });
});
