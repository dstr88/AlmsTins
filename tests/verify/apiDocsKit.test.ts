import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The docs kit: ApiDocsLayout, AnswerCards and DocsFaq, and /verify/agents built on them.
 *
 * The page used to render its own document with a 135-line <style is:global> block. The shell,
 * the look and the Analytics tag now live in the kit, and the page keeps only its copy, written
 * literally so tests/verify/agentDocs.test.ts can still read it. These source checks keep the
 * split: no <style> anywhere, each piece imports its sibling .css, the tag renders once, and the
 * CSS is scoped so the components win over the layout whatever order the stylesheets load in.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const PAGE = 'src/pages/verify/agents.astro';
const LAYOUT = 'src/layouts/ApiDocsLayout.astro';
const KIT = {
  [LAYOUT]: 'src/layouts/ApiDocsLayout.css',
  'src/components/docs/AnswerCards.astro': 'src/components/docs/AnswerCards.css',
  'src/components/docs/DocsFaq.astro': 'src/components/docs/DocsFaq.css',
} as const;
const KIT_ASTRO = Object.keys(KIT);
const KIT_CSS = Object.values(KIT);

const page = read(PAGE);
const layout = read(LAYOUT);
const frontmatter = (src: string) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)?.[1] ?? '';
const stripCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector in a stylesheet, comma lists split, @-rule preludes skipped. */
function selectors(css: string): string[] {
  return [...stripCss(css).matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((p) => !p.startsWith('@'))
    .flatMap((p) => p.split(',').map((s) => s.trim()));
}

/** The class/attribute/pseudo-class count of a selector, the middle number of its specificity. */
const classWeight = (sel: string) => (sel.match(/\.[\w-]+|\[[^\]]+\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;

describe('/verify/agents on the docs kit', () => {
  it('renders no document or styles of its own', () => {
    expect(page).not.toMatch(/<style\b/);
    expect(page).not.toMatch(/<html\b/);
    expect(page).not.toMatch(/<!doctype/i);
    expect(page).not.toMatch(/\bstyle=/);
  });

  it('uses ApiDocsLayout, AnswerCards and DocsFaq', () => {
    const fm = frontmatter(page);
    expect(fm).toMatch(/^import ApiDocsLayout from '@\/layouts\/ApiDocsLayout\.astro';$/m);
    expect(fm).toMatch(/^import AnswerCards from '@\/components\/docs\/AnswerCards\.astro';$/m);
    expect(fm).toMatch(/^import DocsFaq from '@\/components\/docs\/DocsFaq\.astro';$/m);
    expect(page).toMatch(/<ApiDocsLayout title="[^"]+">/);
    expect(page.trimEnd().endsWith('</ApiDocsLayout>')).toBe(true);
    expect(page).toContain('<AnswerCards items={ANSWERS} />');
    expect(page).toMatch(/<DocsFaq>[\s\S]*<details class="faq-item">[\s\S]*<\/DocsFaq>/);
  });

  it('leaves the Analytics tag to the layout', () => {
    expect(page).not.toMatch(/<Analytics\b/);
    expect(page).not.toMatch(/import Analytics\b/);
  });

  it('carries its one description meta in the head slot', () => {
    expect(page.match(/<meta name="description"/g)).toHaveLength(1);
    expect(page).toMatch(/<Fragment slot="head">\s*<meta name="description" content="[^"]+" \/>\s*<\/Fragment>/);
  });
});

describe('the kit files', () => {
  it('have no <style> block and no style attribute', () => {
    for (const f of KIT_ASTRO) {
      expect(read(f), f).not.toMatch(/<style\b/);
      expect(read(f), f).not.toMatch(/\bstyle=/);
    }
  });

  it('each import their sibling .css in the frontmatter', () => {
    for (const [astro, css] of Object.entries(KIT)) {
      const name = path.basename(css).replace('.', '\\.');
      expect(frontmatter(read(astro)), astro).toMatch(new RegExp(`^import '\\./${name}';$`, 'm'));
    }
  });

  it('open each .css with the presentation-only header', () => {
    for (const f of KIT_CSS) expect(read(f), f).toMatch(new RegExp(`^/\\* ${path.basename(f).replace('.', '\\.')} — presentation only\\.`));
  });

  it('read colors only from tokens.css', () => {
    const tokens = new Set([...read('src/styles/tokens.css').matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    for (const f of KIT_CSS) {
      const css = stripCss(read(f));
      const used = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);
      expect(used.filter((v) => !tokens.has(v)), f).toEqual([]);
      expect(css, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|color-mix)\(/);
    }
  });

  it('never mention the private product, comments included', () => {
    for (const f of [PAGE, ...KIT_ASTRO, ...KIT_CSS]) expect(read(f), f).not.toMatch(/cairn|milestone/i);
  });
});

describe('ApiDocsLayout', () => {
  it('renders the Analytics tag exactly once, in the head', () => {
    expect(frontmatter(layout)).toMatch(/^import Analytics from '@\/components\/Analytics\.astro';$/m);
    expect(layout.match(/<Analytics\b/g)).toHaveLength(1);
    expect(layout.indexOf('<Analytics')).toBeLessThan(layout.indexOf('</head>'));
  });

  it('has a named head slot and never a description of its own', () => {
    expect(layout).toContain('<slot name="head" />');
    expect(layout).not.toMatch(/name="description"/);
  });

  it('puts the page content straight into the flex column', () => {
    expect(layout).toMatch(/<body class="apidocs">\s*<div class="apidocs__wrap">\s*<slot \/>\s*<\/div>\s*<\/body>/);
  });

  it('scopes everything but the documented reset under .apidocs', () => {
    const sels = selectors(read(KIT[LAYOUT]));
    expect(sels.filter((s) => !s.startsWith('.apidocs '))).toEqual(['*', 'html', 'body']);
  });
});

describe('component CSS beats the layout CSS in any load order', () => {
  // .apidocs pre is (0,1,1); a component rule needs (0,2,0) or more to win without source order.
  it('AnswerCards: every selector is .answer-cards plus at least one more class', () => {
    for (const s of selectors(read('src/components/docs/AnswerCards.css'))) {
      expect(s).toMatch(/^\.answer-cards \S/);
      expect(classWeight(s), s).toBeGreaterThanOrEqual(2);
    }
  });

  it('DocsFaq: every selector targets the items, never the container alone', () => {
    for (const s of selectors(read('src/components/docs/DocsFaq.css'))) {
      expect(s).toMatch(/^\.docs-faq(\.docs-faq--compact)? \.faq-item\b/);
      expect(classWeight(s), s).toBeGreaterThanOrEqual(2);
    }
  });

  it('the weight helper counts classes, attributes and pseudo-classes, not pseudo-elements', () => {
    expect(classWeight('.apidocs pre')).toBe(1);
    expect(classWeight('.docs-faq .faq-item[open] summary::after')).toBe(3);
    expect(classWeight('.docs-faq .faq-item:last-of-type')).toBe(3);
  });
});
