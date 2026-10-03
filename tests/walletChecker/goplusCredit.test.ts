import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { en as wcEn, es as wcEs, fr as wcFr } from '../../src/i18n/walletChecker';
import { en as dashEn, es as dashEs, fr as dashFr } from '../../src/i18n/dashboard/verify';
import { verifyScanCopy } from '../../src/i18n/verifyScan';
import { GOPLUS_URL, goplusRanForAddress, goplusRanForSite } from '../../src/lib/goplusCredit';

/**
 * GoPlus API License Agreement s.3: an app that shows GoPlus results credits GoPlus with a
 * "Powered by" mention and a backlink (src/lib/goplusCredit.ts). These tests pin the exact
 * wording in every locale, the one shared element, and the rule for when a result is credited.
 *
 * The unit config compiles JSX with the classic runtime (React.createElement), so React is
 * provided as a global before the component is imported, as in tests/verify/publicCardRender.test.ts.
 */
const CREDIT = 'Powered by GoPlus Security';
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
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://gopluslabs.io"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(`>${CREDIT}</a>`);
    // No logo or image until GoPlus supplies its brand kit.
    expect(html).not.toMatch(/<img|<svg|<picture/i);
  });

  it('is styled with design tokens only: no hard-coded colors', () => {
    const css = read('src/components/PoweredByGoPlus.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toContain('var(--text-muted)');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/i);
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
