import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Pin PetroTins to owner-only, so the sitemap case holds whatever the committed switch says.
vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));

import { en, es, fr, LEARN_LANGS } from '../../src/i18n/learn';
import { isPublicPath } from '../../src/middleware/auth';
import { sitemapFilter } from '../../src/lib/seo/sitemapFilter.mjs';
import { en as footerEn, es as footerEs, fr as footerFr } from '../../src/i18n/footer';
import { brightLineViolations } from '../helpers/brightLineWording';

const COPIES = [en, es, fr] as const;

/**
 * /learn, /learn/es and /learn/fr: the public page that lays out everything Almstins offers with a
 * link on every item, in three languages from one template.
 *
 * Pins what makes it honest and reachable: public without a session, submitted to the sitemap,
 * a canonical URL and noindex off, every link a page that exists in this repository (or one of
 * the few routes that are redirects or API doors by design), one tile per tool and per resource,
 * no em dashes, and the product's wording rules: Almstins never says it stops or blocks anything,
 * never calls a result safe, keeps no scores. The brochure it mirrors lives outside the repo, so
 * the prices here are pinned to the prices copy instead.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Every string a visitor can read on the page, flattened. */
function strings(value: unknown, out: string[] = []): string[] {
	if (typeof value === 'string') out.push(value);
	else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
	else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
	return out;
}

/** Every href the page links to. */
function hrefs(value: unknown, out: string[] = []): string[] {
	if (Array.isArray(value)) value.forEach((v) => hrefs(v, out));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			if (k === 'href' && typeof v === 'string') out.push(v);
			else hrefs(v, out);
		}
	}
	return out;
}

/** Routes that exist without a file under src/pages of their own name. */
const KNOWN_ROUTES = new Set([
	'/', // src/pages/index.astro
	'/api/demo/start', // the demo door: a GET that sets the demo cookie and redirects
]);

function routeExists(href: string): boolean {
	if (KNOWN_ROUTES.has(href)) return true;
	const p = href.replace(/\/$/, '');
	const candidates = [
		`src/pages${p}.astro`,
		`src/pages${p}/index.astro`,
		`src/pages${p}.ts`,
		`public${p}/index.html`,
		`public${p}.html`,
	];
	return candidates.some((c) => existsSync(path.join(ROOT, c)));
}

describe('/learn is public, indexable and in the sitemap, in every language', () => {
	it('isPublicPath lists every language, with and without the trailing slash, and nothing that only starts with the word', () => {
		for (const l of LEARN_LANGS) {
			expect(isPublicPath(l.href), l.href).toBe(true);
			expect(isPublicPath(`${l.href}/`), l.href).toBe(true);
		}
		expect(isPublicPath('/learnx')).toBe(false);
		expect(isPublicPath('/learn/private')).toBe(false);
	});

	it('the sitemap submits every language', () => {
		for (const l of LEARN_LANGS) expect(sitemapFilter(`https://almstins.com${l.href}/`), l.href).toBe(true);
	});

	it('the pages render per request with noindex off and their canonical URLs', () => {
		for (const f of ['src/pages/learn.astro', 'src/pages/learn/es.astro', 'src/pages/learn/fr.astro']) {
			expect(read(f), f).toContain('export const prerender = false;');
		}
		const tpl = read('src/components/LearnPage.astro');
		expect(tpl).toContain('noindex={false}');
		expect(tpl).toContain('canonical={t.canonical}');
	});

	it('each copy has its own route, canonical and lang, and the switch lists exactly those', () => {
		expect(COPIES.map((c) => c.lang)).toEqual(LEARN_LANGS.map((l) => l.code));
		for (const [i, c] of COPIES.entries()) {
			const l = LEARN_LANGS[i];
			expect(c.canonical).toBe(`https://almstins.com${l.href}`);
			expect(routeExists(l.href), l.href).toBe(true);
		}
		const tpl = read('src/components/LearnPage.astro');
		expect(tpl).toContain('LEARN_LANGS.map');
		expect(tpl).toContain('hreflang="x-default"');
	});

	it('the footer links to the matching language', () => {
		expect(footerEn.learnHref).toBe('/learn');
		expect(footerEs.learnHref).toBe('/learn/es');
		expect(footerFr.learnHref).toBe('/learn/fr');
		expect(read('src/components/Footer.astro')).toContain('t.learnHref');
	});
});

describe('every item links somewhere real', () => {
	const all = COPIES.flatMap((c) => hrefs(c));

	it.each(COPIES.map((c) => [c.lang, c] as const))('%s has at least one link per tool, per resource and in the hero', (_lang, c) => {
		expect(c.tools.items.length).toBe(5);
		for (const tool of c.tools.items) {
			expect(tool.open.href, tool.name).toMatch(/^\//);
			expect(tool.learnMore.length, tool.name).toBeGreaterThan(0);
		}
		expect(c.resources.items.length).toBeGreaterThanOrEqual(10);
		for (const r of c.resources.items) expect(r.href, r.title).toMatch(/^\//);
	});

	it('the Spanish and French copies point at the pages that exist in their language', () => {
		for (const [c, lang] of [[es, 'es'], [fr, 'fr']] as const) {
			expect(c.hero.primary.href).toBe(`/wallet-checker/${lang}`);
			expect(c.hero.secondary.href).toBe(`/prices/${lang}`);
			expect(c.tools.items.find((x) => x.id === 'verify')!.open.href).toBe(`/verify/${lang}`);
			expect(c.tools.items.find((x) => x.id === 'watcher')!.open.href).toBe(`/${lang}`);
			expect(c.pricing.link.href).toBe(`/prices/${lang}`);
		}
	});

	it.each(Array.from(new Set(all)))('%s resolves to a page in this repository', (href) => {
		expect(href.startsWith('/'), 'internal links only').toBe(true);
		expect(routeExists(href.split('#')[0]), href).toBe(true);
	});

	it('the tool tiles jump to detail sections with the same ids, the same in every language', () => {
		const tpl = read('src/components/LearnPage.astro');
		expect(tpl).toContain('href={`#${tool.id}`}');
		expect(tpl).toContain('id={tool.id}');
		const ids = en.tools.items.map((x) => x.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const c of COPIES) expect(c.tools.items.map((x) => x.id)).toEqual(ids);
	});

	it('the tutorials section comes last, before the closing, and every copy carries the existing demos and guides', () => {
		const tpl = read('src/components/LearnPage.astro');
		expect(tpl.indexOf('id="tutorials"')).toBeGreaterThan(tpl.indexOf('id="not-h"'));
		expect(tpl.indexOf('id="tutorials"')).toBeLessThan(tpl.indexOf('class="closing"'));
		for (const c of COPIES) {
			const targets = c.resources.items.map((r) => r.href);
			for (const must of ['/artifacts/registry', '/artifacts/proof', '/artifacts/cairn', '/guides/crypto-holding-period-after-transfer', '/verify/guide', '/agentics/docs', '/api/demo/start']) {
				expect(targets, `${c.lang} ${must}`).toContain(must);
			}
		}
	});
});

describe('the words keep to the product\'s rules', () => {
	// The bright-line patterns are English (and police American spelling), so they run on the
	// English copy only; the em-dash and "safe" rules hold in every language.
	it.each(strings(en).map((s) => [s.slice(0, 60), s] as const))('en: %s', (_label, s) => {
		expect(brightLineViolations(s)).toEqual([]);
		expect(s).not.toMatch(/\b(trust|risk|safety) (score|rating)s?\b/i);
	});

	it.each(COPIES.flatMap((c) => strings(c).map((s) => [`${c.lang}: ${s.slice(0, 50)}`, s] as const)))('%s', (_label, s) => {
		expect(s).not.toContain('—');
		// "Google Safe Browsing" is a source's name, not a verdict.
		expect(s.replace(/Google Safe Browsing/g, '')).not.toMatch(/\bsafe\b/i);
	});

	it('the Spanish and French copies never say that Almstins stops or blocks anything, or calls a result safe', () => {
		for (const c of [es, fr]) {
			const all = strings(c).join(' ');
			expect(all, c.lang).not.toMatch(/\bbloque\w*\b|\bdetiene\w*\b|\barrête\w*\b/i);
			expect(all, c.lang).not.toMatch(/\bsegur[oa]s?\b|\bsûre?s?\b/i);
		}
	});

	it('the page template, the routes and the copy module hold no em dash', () => {
		for (const f of ['src/components/LearnPage.astro', 'src/i18n/learn.ts', 'src/pages/learn.astro', 'src/pages/learn/es.astro', 'src/pages/learn/fr.astro']) {
			expect(read(f), f).not.toContain('—');
		}
	});

	it('the prices match the prices page, in every language', () => {
		const prices = read('src/i18n/prices.ts');
		for (const n of ['$7', '$20', '$39']) expect(prices).toContain(n);
		for (const c of COPIES) {
			const pricing = c.pricing.rows.map((r) => `${r.price} ${r.body}`).join(' ');
			for (const n of ['$7', '$20', '$39', '$95']) expect(pricing, c.lang).toContain(n);
		}
		// Nothing on the page sells what cannot be bought yet.
		expect(en.pricing.rows.map((r) => r.body).join(' ')).toMatch(/Standard billing opens soon/);
		expect(en.pricing.rows.map((r) => r.body).join(' ')).toMatch(/Paid plans come later/);
		expect(es.pricing.rows.map((r) => r.body).join(' ')).toMatch(/abre pronto/);
		expect(fr.pricing.rows.map((r) => r.body).join(' ')).toMatch(/ouvre bientôt/);
	});
});
