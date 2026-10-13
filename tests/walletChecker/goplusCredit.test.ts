import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { en as wcEn, es as wcEs, fr as wcFr } from '../../src/i18n/walletChecker';
import { en as dashEn, es as dashEs, fr as dashFr } from '../../src/i18n/dashboard/verify';
import { verifyScanCopy } from '../../src/i18n/verifyScan';
import { GOPLUS_URL, goplusRanForAddress, goplusRanForSite } from '../../src/lib/goplusCredit';

/**
 * GoPlus API License Agreement s.3 and s.5: an app that shows GoPlus results credits GoPlus with
 * a "Powered by" mention, a backlink and the GoPlus logo (src/lib/goplusCredit.ts). These tests
 * pin the exact wording in every locale, the one shared element (text, logo and link), the logo
 * file, and the rule for when a result is credited.
 *
 * The unit config compiles JSX with the classic runtime (React.createElement), so React is
 * provided as a global before the component is imported, as in tests/verify/publicCardRender.test.ts.
 */
const CREDIT = 'Powered by GoPlus Security';
const LOGO_FILE = 'src/assets/goplus-horizontal-logo-all-white.svg';
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('GoPlus credit wording', () => {
  // A brand credit that mirrors the license, so it is the same English phrase in every language.
  it.each([
    ['wallet-checker en', wcEn.checker.poweredByGoPlus],
    ['wallet-checker es', wcEs.checker.poweredByGoPlus],
    ['wallet-checker fr', wcFr.checker.poweredByGoPlus],
    ['verify scan en', verifyScanCopy.en.poweredByGoPlus],
    ['verify scan es', verifyScanCopy.es.poweredByGoPlus],
    ['verify scan fr', verifyScanCopy.fr.poweredByGoPlus],
    ['verify dashboard en', dashEn.poweredByGoPlus],
    ['verify dashboard es', dashEs.poweredByGoPlus],
    ['verify dashboard fr', dashFr.poweredByGoPlus],
  ])('%s: exactly "Powered by GoPlus Security"', (_name, value) => {
    expect(value).toBe(CREDIT);
  });
});

describe('<PoweredByGoPlus>', () => {
  let PoweredByGoPlus: (p: { label: string }) => React.ReactElement;
  beforeAll(async () => {
    (globalThis as any).React = React;
    PoweredByGoPlus = (await import('../../src/components/PoweredByGoPlus')).default as any;
  });

  it('is one backlink to GoPlus that opens in a new tab and carries the credit text', () => {
    const html = renderToStaticMarkup(React.createElement(PoweredByGoPlus, { label: CREDIT }));
    expect(GOPLUS_URL).toBe('https://gopluslabs.io');
    // One link and nothing else clickable: the logo sits inside it.
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://gopluslabs.io"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('lang="en"');
    expect(html).toContain(`${CREDIT}</a>`);
  });

  it('shows the GoPlus logo inside that link, as a decorative image', () => {
    const html = renderToStaticMarkup(React.createElement(PoweredByGoPlus, { label: CREDIT }));
    // Exactly one image: the committed kit logo, then the text, all inside the one <a>. (In tests
    // Vite serves the asset from /src/assets; in a build it is /_astro/<name>.<hash>.svg.)
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toMatch(
      /<a [^>]*><img [^>]*src="[^"]*goplus-horizontal-logo-all-white[^"]*\.svg"[^>]*\/?>Powered by GoPlus Security<\/a>/,
    );
    // Decorative: the visible text already names GoPlus, so the link's accessible name is that text.
    expect(html).toContain('alt=""');
    // No other embedded graphics.
    expect(html).not.toMatch(/<svg|<picture|<script/i);
  });

  it('gives the logo an explicit size with the same shape as the logo file (no stretching)', () => {
    const html = renderToStaticMarkup(React.createElement(PoweredByGoPlus, { label: CREDIT }));
    const [, w, h] = html.match(/width="(\d+)" height="(\d+)"/) ?? [];
    const [, vw, vh] = read(LOGO_FILE).match(/viewBox="0 0 (\d+) (\d+)"/) ?? [];
    expect(w && h && vw && vh).toBeTruthy();
    const imgRatio = Number(w) / Number(h);
    const fileRatio = Number(vw) / Number(vh);
    expect(Math.abs(imgRatio - fileRatio) / fileRatio).toBeLessThan(0.01);
  });

  it('is styled with design tokens only: no hard-coded colors', () => {
    const css = read('src/components/PoweredByGoPlus.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toContain('var(--text-secondary)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/i);
  });
});

// The logo is the GoPlus media kit's "Horizontal logo (All White)", committed as shipped
// (https://gopluslabs.io/en/media-kit; GoPlus tech support said on Oct 3, 2026 the kit may be used).
describe('the committed GoPlus logo file', () => {
  it('exists and is a small SVG', () => {
    expect(existsSync(path.join(ROOT, LOGO_FILE))).toBe(true);
    const svg = read(LOGO_FILE);
    expect(svg.trimStart()).toMatch(/^(<\?xml[^>]*\?>\s*)?<svg[\s>]/);
    expect(Buffer.byteLength(svg)).toBeLessThan(16 * 1024);
  });

  it('carries nothing active: no script, event handlers, foreignObject or external references', () => {
    const svg = read(LOGO_FILE);
    expect(svg).not.toMatch(/<script|<foreignObject|<iframe|<object|<embed|<style|<image|<use\b|<animate|<set\b/i);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i); // onload=, onclick=, onbegin=, ...
    expect(svg).not.toMatch(/javascript:|data:|@import/i);
    expect(svg).not.toMatch(/<!DOCTYPE|<!ENTITY/i);
    expect(svg).not.toMatch(/\b(xlink:)?href\s*=/i); // no links or external resources
    expect(svg).not.toMatch(/url\(\s*['"]?(?!#)/i); // no url() other than a local #id
    // The only URLs allowed are the two standard XML namespace declarations.
    const urls = svg.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
    expect(urls.filter((u) => u !== 'http://www.w3.org/2000/svg' && u !== 'http://www.w3.org/1999/xlink')).toEqual([]);
  });
});

describe('when a result is credited to GoPlus', () => {
  it('address: only when GoPlus ran', () => {
    expect(goplusRanForAddress({ coverage: { goplus: 'ran' } })).toBe(true);
    // 'skipped' = a chain GoPlus does not cover; 'error' = it did not answer.
    expect(goplusRanForAddress({ coverage: { goplus: 'skipped' } })).toBe(false);
    expect(goplusRanForAddress({ coverage: { goplus: 'error' } })).toBe(false);
    expect(goplusRanForAddress({})).toBe(false);
    expect(goplusRanForAddress(null)).toBe(false);
    expect(goplusRanForAddress(undefined)).toBe(false);
  });

  it('site: only when the GoPlus Security source returned a verdict', () => {
    const src = (name: string, verdict: string) => ({ sources: [{ name: 'MetaMask Blocklist', verdict: 'clean' }, { name, verdict }] });
    expect(goplusRanForSite(src('GoPlus Security', 'clean'))).toBe(true);
    expect(goplusRanForSite(src('GoPlus Security', 'flagged'))).toBe(true);
    // It never answered, or it was never asked.
    expect(goplusRanForSite(src('GoPlus Security', 'error'))).toBe(false);
    expect(goplusRanForSite(src('GoPlus Security', 'skipped'))).toBe(false);
    // The community-database short-circuit returns only its own source.
    expect(goplusRanForSite({ sources: [{ name: 'Almstins Community', verdict: 'flagged' }] })).toBe(false);
    expect(goplusRanForSite({ sources: [] })).toBe(false);
    expect(goplusRanForSite({})).toBe(false);
    expect(goplusRanForSite(null)).toBe(false);
  });

  it('site: the source name it looks for is the one /api/dapp-check emits', () => {
    // goplusRanForSite matches on this name; renaming the source there would silently drop the credit.
    expect(read('src/pages/api/dapp-check.ts')).toContain("const src = 'GoPlus Security';");
  });
});
