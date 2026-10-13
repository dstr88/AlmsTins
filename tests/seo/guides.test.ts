import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Pin PetroTins to owner-only, so the sitemap case holds whatever the committed switch says.
vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));

import { en as guide } from '../../src/i18n/guides/holdingPeriodAfterTransfer';
import type { GuideBlock, GuideCopy } from '../../src/i18n/guides/types';
import { parseInline, plainText, linksIn } from '../../src/lib/guides/inline';
import { officialSourceHost, OFFICIAL_SOURCE_HOSTS } from '../../src/lib/guides/officialSources';
import { faqPageJsonLd, articleJsonLd, ldJson } from '../../src/lib/guides/jsonLd';
import { sitemapFilter } from '../../src/lib/seo/sitemapFilter.mjs';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * The first public guide: /guides/crypto-holding-period-after-transfer (English first).
 *
 * Pins what makes it a public, indexable, honest page: the canonical URL and noindex={false},
 * the FAQPage JSON-LD built from the same items the visible FAQ shows, every outside link on
 * an official US government site, no em dashes, no links or lines beyond the reviewed draft
 * (the not-tax-advice line shows once, where the draft has it), and no forbidden words. Public access is pinned in
 * tests/middleware/publicPaths.test.ts; the sitemap rule in tests/seo/sitemapFilter.test.ts.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const SLUG = '/guides/crypto-holding-period-after-transfer';
const PAGE = `src/pages${SLUG}.astro`;
const SOURCE_FILES = [
	PAGE,
	'src/components/guides/GuidePage.astro',
	'src/components/guides/GuideBlocks.astro',
	'src/components/guides/GuideInline.astro',
	'src/i18n/guides/holdingPeriodAfterTransfer.ts',
	'src/i18n/guides/types.ts',
	'src/lib/guides/inline.ts',
	'src/lib/guides/jsonLd.ts',
	'src/lib/guides/officialSources.ts',
];

/** Every string in a guide that is inline markup (paragraphs, list items, answers, sources). */
function markupStrings(t: GuideCopy): string[] {
	const fromBlocks = (blocks: GuideBlock[]) =>
		blocks.flatMap((b) => (b.kind === 'p' ? [b.md] : b.kind === 'ul' || b.kind === 'ol' ? b.items : []));
	return [
		...fromBlocks(t.intro),
		...t.sections.flatMap((s) => fromBlocks(s.blocks)),
		...t.faq.items.map((f) => f.a),
		...t.sources.groups.flatMap((g) => g.items),
	];
}

/** What a reader can see: headings, labels and the plain text of every markup string. */
function visibleText(t: GuideCopy): string {
	const ctas = t.sections.flatMap((s) => s.blocks.flatMap((b) => (b.kind === 'cta' ? b.links.map((l) => l.label) : [])));
	return [
		t.meta.title,
		t.meta.description,
		t.eyebrow,
		t.h1,
		t.reviewed.label,
		...t.nav.links.map((l) => l.label),
		...t.sections.map((s) => s.h2),
		t.faq.heading,
		...t.faq.items.map((f) => f.q),
		t.sources.heading,
		t.sources.intro,
		...t.sources.groups.map((g) => g.heading),
		...ctas,
		...markupStrings(t).map(plainText),
	].join('\n');
}

describe('inline markup', () => {
	it('parses links, links with parentheses in the URL, autolinks, strong and emphasis', () => {
		expect(parseInline('See [FAQ 81](https://www.irs.gov/x#faq81).')).toEqual([
			{ type: 'text', text: 'See ' },
			{ type: 'link', text: 'FAQ 81', href: 'https://www.irs.gov/x#faq81' },
			{ type: 'text', text: '.' },
		]);
		expect(parseInline('[(j)(1)](<https://www.ecfr.gov/s#p-1(j)(1)>), next')).toEqual([
			{ type: 'link', text: '(j)(1)', href: 'https://www.ecfr.gov/s#p-1(j)(1)' },
			{ type: 'text', text: ', next' },
		]);
		expect(parseInline('*Title.* <https://www.irs.gov/a>. Accessed')).toEqual([
			{ type: 'em', text: 'Title.' },
			{ type: 'text', text: ' ' },
			{ type: 'link', text: 'https://www.irs.gov/a', href: 'https://www.irs.gov/a' },
			{ type: 'text', text: '. Accessed' },
		]);
		expect(parseInline('**Lead.** Body')).toEqual([
			{ type: 'strong', text: 'Lead.' },
			{ type: 'text', text: ' Body' },
		]);
		expect(plainText('**A.** see [FAQ 1](https://www.irs.gov/x) and <https://www.irs.gov/y>')).toBe(
			'A. see FAQ 1 and https://www.irs.gov/y',
		);
	});

	it('throws on malformed markup instead of rendering it', () => {
		for (const bad of [
			'**unclosed',
			'*unclosed',
			'[text without url]',
			'[text](https://www.irs.gov/x',
			'[text](<https://www.irs.gov/x)',
			'[text](javascript:alert(1))',
			'[text](http://www.irs.gov/x)',
			'<not-a-url>',
			'stray ] bracket',
			'stray > angle',
			'**[link](https://www.irs.gov/x)**',
		]) {
			expect(() => parseInline(bad), bad).toThrow(/guide inline markup/);
		}
	});

	it('every markup string in the guide parses', () => {
		for (const s of markupStrings(guide)) expect(() => parseInline(s), s.slice(0, 60)).not.toThrow();
	});
});

describe('public and indexable', () => {
	it('has the canonical URL, slug and proposed title and description', () => {
		expect(guide.slug).toBe(SLUG);
		expect(guide.canonical).toBe(`https://almstins.com${SLUG}`);
		expect(guide.lang).toBe('en');
		expect(guide.meta.title).toBe('Crypto Holding Period After a Transfer: How to Prove It');
		expect(guide.meta.description).toBe(
			'A move between your own wallets is not a taxable event, but your 1099-DA may skip basis. Keep these records to prove when you bought your crypto.',
		);
		expect(guide.h1).toBe('How to prove when you bought crypto after you transferred it');
	});

	it('the page renders GuidePage with this copy and is not prerendered (the geoblock still runs)', () => {
		expect(existsSync(path.join(ROOT, PAGE))).toBe(true);
		const page = read(PAGE);
		expect(page).toMatch(/import \{ en \} from '@\/i18n\/guides\/holdingPeriodAfterTransfer'/);
		expect(page).toMatch(/<GuidePage t=\{en\} \/>/);
		expect(page).not.toMatch(/prerender\s*=\s*true/);
		expect(page).toMatch(/export const prerender = false;/);
	});

	it('GuidePage uses LoginLayout with noindex={false} and the canonical, and no second Analytics tag', () => {
		const src = read('src/components/guides/GuidePage.astro');
		const layoutTag = src.match(/<LoginLayout\b[^>]*>/)?.[0] ?? '';
		expect(layoutTag).toContain('noindex={false}');
		expect(layoutTag).toContain('canonical={t.canonical}');
		expect(layoutTag).toContain('title={t.meta.title}');
		expect(layoutTag).toContain('description={t.meta.description}');
		expect(src).not.toMatch(/<Analytics\b/);
		expect(src).not.toMatch(/<html\b/);
	});
});

describe('FAQPage JSON-LD matches the visible FAQ', () => {
	it('GuidePage renders both JSON-LD blocks in the head and the FAQ from the same items', () => {
		const src = read('src/components/guides/GuidePage.astro');
		const head = src.slice(src.indexOf('<Fragment slot="head">'), src.indexOf('</Fragment>'));
		expect(head).toContain('<script type="application/ld+json" set:html={ldJson(faqPageJsonLd(t))} />');
		expect(head).toContain('<script type="application/ld+json" set:html={ldJson(articleJsonLd(t))} />');
		// The visible FAQ: native <details>, one per t.faq.items entry, question in <summary>.
		expect(src).toMatch(/\{t\.faq\.items\.map\(\(f\) => \(\s*<details class="faq__item">\s*<summary>\{f\.q\}<\/summary>\s*<p class="faq__a"><GuideInline md=\{f\.a\} \/><\/p>/);
	});

	it('every question and answer the page shows is in the JSON-LD, in order, as plain text', () => {
		const ld = faqPageJsonLd(guide);
		expect(ld['@type']).toBe('FAQPage');
		expect(guide.faq.items.length).toBeGreaterThanOrEqual(3);
		expect(ld.mainEntity.map((e) => e.name)).toEqual(guide.faq.items.map((f) => f.q));
		expect(ld.mainEntity.map((e) => e.acceptedAnswer.text)).toEqual(guide.faq.items.map((f) => plainText(f.a)));
		expect(guide.faq.items.map((f) => f.q)).toEqual([
			'Does moving crypto to another wallet reset my holding period?',
			'Why does my 1099-DA show no cost basis for crypto I transferred in?',
			'Is a blockchain record enough to prove my cost basis?',
		]);
		for (const e of ld.mainEntity) {
			expect(e['@type']).toBe('Question');
			expect(e.acceptedAnswer.text.length).toBeGreaterThan(80);
			expect(e.acceptedAnswer.text).not.toMatch(/https?:\/\/|\]\(|\*\*/);
		}
	});

	it('the Article block names the canonical URL and the review date', () => {
		const a = articleJsonLd(guide);
		expect(a.url).toBe(guide.canonical);
		expect(a.mainEntityOfPage).toBe(guide.canonical);
		expect(a.headline).toBe(guide.h1);
		expect(a.dateModified).toBe('2026-10-11');
	});

	it('ldJson output cannot close its <script> tag', () => {
		const out = ldJson({ text: '</script><script>alert(1)</script>' });
		expect(out).not.toContain('<');
		expect(JSON.parse(out).text).toBe('</script><script>alert(1)</script>');
	});
});

describe('sources and links', () => {
	const links = markupStrings(guide).flatMap(linksIn);

	it('keeps every citation from the reviewed draft (85 links)', () => {
		expect(links).toHaveLength(85);
	});

	it('every outside link is https on irs.gov, ecfr.gov, federalregister.gov, govinfo.gov or uscode.house.gov', () => {
		expect([...OFFICIAL_SOURCE_HOSTS].sort()).toEqual(
			['ecfr.gov', 'federalregister.gov', 'govinfo.gov', 'irs.gov', 'uscode.house.gov'].sort(),
		);
		for (const l of links) {
			expect(l.href, l.text).toMatch(/^https:\/\//);
			expect(officialSourceHost(l.href), l.href).not.toBeNull();
		}
		const hosts = new Set(links.map((l) => new URL(l.href).hostname));
		expect([...hosts].sort()).toEqual(['www.ecfr.gov', 'www.federalregister.gov', 'www.govinfo.gov', 'www.irs.gov']);
	});

	it('officialSourceHost accepts only the listed sites over https', () => {
		expect(officialSourceHost('https://www.irs.gov/x')).toBe('irs.gov');
		expect(officialSourceHost('https://uscode.house.gov/view.xhtml')).toBe('uscode.house.gov');
		expect(officialSourceHost('http://www.irs.gov/x')).toBeNull();
		expect(officialSourceHost('https://irs.gov.example.com/x')).toBeNull();
		expect(officialSourceHost('https://evil-irs.gov/x')).toBeNull();
		expect(officialSourceHost('https://sub.irs.gov/x')).toBeNull();
		expect(officialSourceHost('/prices')).toBeNull();
	});

	it('adds no links beyond the reviewed draft: no call-to-action row, and the top bar stays on almstins.com', () => {
		const blocks = [...guide.intro, ...guide.sections.flatMap((s) => s.blocks)];
		expect(blocks.filter((b) => b.kind === 'cta')).toEqual([]);
		for (const l of guide.nav.links) expect(l.href).toMatch(/^\/[^/]/);
	});

	it('outside links open in the same tab with rel="noopener" and look like links', () => {
		const src = read('src/components/guides/GuideInline.astro');
		expect(src).toContain(`rel={tk.outside ? 'noopener' : undefined}`);
		expect(src).toContain('title={tk.title}');
		expect(src).toMatch(/Official source: \$\{host\}/);
		expect(src).toMatch(/\.cite \{[^}]*text-decoration: underline;/);
		for (const f of SOURCE_FILES) expect(read(f), f).not.toMatch(/target=|_blank/);
	});

	it('the sources list says every source is an official US government page', () => {
		expect(guide.sources.intro).toBe('Every source below is an official US government page.');
		expect(guide.sources.groups.map((g) => g.heading)).toEqual([
			'Internal Revenue Service (irs.gov)',
			'Treasury regulations (Electronic Code of Federal Regulations, ecfr.gov)',
			'Federal Register (federalregister.gov)',
			'Internal Revenue Code (United States Code, 2024 edition, govinfo.gov)',
		]);
	});
});

describe('honest copy', () => {
	it('shows the not-tax-advice line once, where the reviewed draft has it (closing "How Almstins helps")', () => {
		const line =
			'**This page is general information, not tax advice.** Tax rules change, and your own facts matter. Confirm your situation with a tax professional before you file.';
		const helps = guide.sections.find((s) => s.id === 'how-almstins-helps')!;
		expect(helps.blocks.at(-1)).toEqual({ kind: 'p', md: line });
		expect(markupStrings(guide).filter((m) => m === line)).toHaveLength(1);
		expect(visibleText(guide).match(/not tax advice/g)).toHaveLength(1);
		// The template repeats none of the copy: no extra disclaimer at the top or the end.
		expect(read('src/components/guides/GuidePage.astro')).not.toMatch(/disclaimer/);
	});

	it('shows the last-reviewed date', () => {
		expect(guide.reviewed).toEqual({ label: 'Last reviewed: October 11, 2026', iso: '2026-10-11' });
		const src = read('src/components/guides/GuidePage.astro');
		expect(src).toContain('<time datetime={t.reviewed.iso}>{t.reviewed.label}</time>');
		// Small text: --text-muted is about 3.4:1 on the page background, below WCAG AA (4.5:1).
		expect(src).toMatch(/\.guide__reviewed \{[^}]*color: var\(--text-secondary\);/);
	});

	it('says Almstins organizes records and never files or advises, and that the signed export is on Unlimited', () => {
		const helps = guide.sections.find((s) => s.id === 'how-almstins-helps')!;
		const text = helps.blocks.map((b) => (b.kind === 'p' ? b.md : '')).join(' ');
		expect(text).toContain('Almstins organizes records. It does not file taxes, give tax advice, or promise how any sale will be treated.');
		expect(text).toContain('The signed Year Summary export, on the Unlimited plan, gives you and your tax professional');
		// Until per-wallet FIFO and transfer carry-over ship, the guide must not claim the engine follows
		// each coin through transfers, and must disclose the 2025 rule gap.
		expect(text).not.toMatch(/follows each coin/i);
		expect(text).toContain('do not yet apply the 2025 wallet-by-wallet rule');
	});

	it('no em dashes in the copy or the page source', () => {
		expect(JSON.stringify(guide)).not.toContain('\u2014');
		for (const f of SOURCE_FILES) expect(read(f), f).not.toContain('\u2014');
	});

	it('no forbidden words', () => {
		const forbidden = [
			/\bsafe(ly|ty)?\b/i,
			/petro\s*-?\s*tins/i,
			/\bcairn/i,
			/\bmilestones?\b/i,
			/green\s*papers?/i,
			/\bguarantee/i,
		];
		const texts = [visibleText(guide), JSON.stringify(guide), ...SOURCE_FILES.map(read)];
		for (const re of forbidden) for (const s of texts) expect(s, String(re)).not.toMatch(re);
	});

	it('passes the bright-line wording rules (American English included)', () => {
		// The lending rule reads "blockchain record" (an FAQ question) as "block... record", so the
		// word is swapped out first; every rule still runs over every other word.
		const text = visibleText(guide).replace(/\bblockchain\b/gi, 'ledger');
		expect(brightLineViolations(text)).toEqual([]);
	});
});

describe('sitemap', () => {
	it('submits the guide at the URL @astrojs/sitemap emits', () => {
		expect(sitemapFilter(`https://almstins.com${SLUG}/`)).toBe(true);
	});

	it('the page is a static (non-dynamic) route, so the sitemap integration lists it', () => {
		expect(PAGE).not.toMatch(/\[/);
		expect(existsSync(path.join(ROOT, PAGE))).toBe(true);
	});
});
