import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { listedPillFor } from '../../src/components/verify/listedPillRule';
import { conflictCountLine, conflictWord } from '../../src/components/verify/conflictWords';
import { en, es, fr, type VerifyDashboardLocale } from '../../src/i18n/dashboard/verify';

/**
 * Guard PR B, the two dashboard pieces (spec 3e, 3h): the merchant's "Listed by a platform" pill and
 * the platform's conflict list. The rule lives in a pure module, the words in the dashboard locale,
 * the markup in a component with no styles of its own (Donnie's two rules for this build), and
 * nothing rendered can name the other party.
 */

const T = en as VerifyDashboardLocale;
// The unit config compiles JSX with the classic runtime, so React is a global before the
// components are imported (as publicCardRender.test.ts does).
let ListedPill: (p: any) => React.ReactElement | null;
let ConflictList: (p: any) => React.ReactElement | null;
beforeAll(async () => {
  (globalThis as any).React = React;
  ListedPill = (await import('../../src/components/verify/ListedPill')).ListedPill as any;
  ConflictList = (await import('../../src/components/verify/ConflictList')).ConflictList as any;
});
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('listedPillFor, pure', () => {
  it('shows for a proven address a platform lists, and for nothing else', () => {
    expect(listedPillFor({ kind: 'address', proofStatus: 'proven', platformListedAt: '2026-11-09 10:00:00' })).toEqual({ since: '2026-11-09 10:00:00' });
    expect(listedPillFor({ kind: 'address', proofStatus: 'proven', platformListedAt: null })).toBeNull();
    expect(listedPillFor({ kind: 'address', proofStatus: 'proven' })).toBeNull();
    expect(listedPillFor({ kind: 'address', proofStatus: 'unproven', platformListedAt: '2026-11-09 10:00:00' })).toBeNull();
    expect(listedPillFor({ kind: 'address', proofStatus: 'lapsed', platformListedAt: '2026-11-09 10:00:00' })).toBeNull();
    expect(listedPillFor({ kind: 'qr', proofStatus: 'proven', platformListedAt: '2026-11-09 10:00:00' })).toBeNull();
  });
});

describe('conflictList words, pure', () => {
  it('one entry, many entries, none', () => {
    expect(conflictCountLine(0, T)).toBeNull();
    expect(conflictCountLine(-1, T)).toBeNull();
    expect(conflictCountLine(1, T)).toBe(T.entConflictsOne);
    expect(conflictCountLine(3, T)).toBe(T.entConflicts.replace('{n}', '3'));
    expect(conflictCountLine(3, T)).not.toContain('{n}');
  });
  it('a word per side, never a party', () => {
    expect(conflictWord('merchant', T)).toBe(T.conflictWithMerchant);
    expect(conflictWord('platform', T)).toBe(T.conflictWithPlatform);
  });
});

describe('the components render the words, carry no styles, and name nobody', () => {
  const ADDR = '0x' + 'ab'.repeat(20);

  it('ListedPill: the pill with its title, or nothing', () => {
    const html = renderToStaticMarkup(React.createElement(ListedPill, { d: { kind: 'address', proofStatus: 'proven', platformListedAt: '2026-11-09 10:00:00' }, t: T }));
    expect(html).toContain('vd-pill--listed');
    expect(html).toContain(T.listedPill);
    expect(html).toContain(T.listedTitle.replace(/'/g, '&#x27;'));
    expect(html).not.toContain('style=');
    expect(renderToStaticMarkup(React.createElement(ListedPill, { d: { kind: 'qr', proofStatus: 'proven', platformListedAt: '2026-11-09 10:00:00' }, t: T }))).toBe('');
  });

  it('ConflictList: the count line, the entries with a word each, nothing for zero', () => {
    const html = renderToStaticMarkup(React.createElement(ConflictList, {
      count: 2, t: T,
      conflicts: [
        { address: ADDR, chain: 'ethereum', conflictWith: 'merchant', since: '2026-11-09 10:00:00' },
        { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', chain: 'bitcoin', conflictWith: 'platform', since: null },
      ],
    }));
    expect(html).toContain(T.entConflicts.replace('{n}', '2'));
    expect(html).toContain(T.entConflictsShow);
    expect(html).toContain(ADDR);
    expect(html).toContain(T.conflictWithMerchant);
    expect(html).toContain(T.conflictWithPlatform);
    expect(html).not.toContain('style=');
    // The count can come without the entries (an older payload): the line alone, no empty list.
    const lineOnly = renderToStaticMarkup(React.createElement(ConflictList, { count: 1, conflicts: [], t: T }));
    expect(lineOnly).toContain(T.entConflictsOne);
    expect(lineOnly).not.toContain('<details');
    expect(renderToStaticMarkup(React.createElement(ConflictList, { count: 0, conflicts: [], t: T }))).toBe('');
  });

  it('the TSX holds no style attribute and no sentence of its own; the CSS is in the dashboard sheet', () => {
    for (const f of ['src/components/verify/ListedPill.tsx', 'src/components/verify/ConflictList.tsx']) {
      const src = read(f);
      expect(src, f).not.toMatch(/style=\{/);
      expect(src, f).not.toMatch(/>[A-Z][a-z]+ [a-z]+ [a-z]+</); // a typed sentence between tags
    }
    const css = read('src/components/verify/VerifyDashboard.css');
    expect(css).toContain('.vd-pill--listed');
    expect(css).toContain('.ve-conflicts');
    // Tokens only: the two blocks name no literal color.
    const blocks = css.split('\n').filter((l) => l.startsWith('.vd-pill') || l.startsWith('.ve-conflicts'));
    expect(blocks.length).toBeGreaterThan(4);
    for (const l of blocks) expect(l).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

describe('the copy is in all three languages, American English, no em dashes', () => {
  const KEYS = ['listedPill', 'listedTitle', 'entConflicts', 'entConflictsOne', 'entConflictsShow', 'conflictWithMerchant', 'conflictWithPlatform'] as const;
  it.each([['en', en], ['es', es], ['fr', fr]] as const)('%s', (_lang, t) => {
    for (const k of KEYS) {
      expect(t[k], k).toBeTruthy();
      expect(t[k], k).not.toContain('—');
      expect(t[k], k).not.toContain('{email}');
    }
    expect(t.entConflicts).toContain('{n}');
    expect(t.entConflictsOne).not.toContain('{n}');
  });
  it('the English spells it the American way', () => {
    for (const k of KEYS) expect(en[k]).not.toMatch(/\b(colour|favour|centre|licence|authorise|recognise)\b/i);
  });
});
