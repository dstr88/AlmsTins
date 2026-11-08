import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Pin PetroTins to owner-only, so the sitemap case holds whatever the committed switch says.
vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));

import { en } from '../../src/i18n/learn';
import { isPublicPath } from '../../src/middleware/auth';
import { sitemapFilter } from '../../src/lib/seo/sitemapFilter.mjs';
import { en as footerEn, es as footerEs, fr as footerFr } from '../../src/i18n/footer';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * /learn: the public page that lays out everything Almstins offers with a link on every item.
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

describe('/learn is public, indexable and in the sitemap', () => {
	it('isPublicPath lists it, with and without the trailing slash, and nothing that only starts with the word', () => {
		expect(isPublicPath('/learn')).toBe(true);
		expect(isPublicPath('/learn/')).toBe(true);
		expect(isPublicPath('/learnx')).toBe(false);
		expect(isPublicPath('/learn/private')).toBe(false);
	});

	it('the sitemap submits it', () => {
		expect(sitemapFilter('https://almstins.com/learn/')).toBe(true);
	});

	it('the page renders per request with noindex off and its canonical URL', () => {
		const page = read('src/pages/learn.astro');
		const tpl = read('src/components/LearnPage.astro');
		expect(page).toContain('export const prerender = false;');
		expect(tpl).toContain('noindex={false}');
		expect(tpl).toContain('canonical={t.canonical}');
		expect(en.canonical).toBe('https://almstins.com/learn');
	});

	it('the footer links to it in every language', () => {
		for (const f of [footerEn, footerEs, footerFr]) expect(f.learnHref).toBe('/learn');
		expect(read('src/components/Footer.astro')).toContain('t.learnHref');
	});
});

describe('every item links somewhere real', () => {
	const all = hrefs(en);

	it('has at least one link per tool, per resource and in the hero', () => {
		expect(en.tools.items.length).toBe(5);
		for (const tool of en.tools.items) {
			expect(tool.open.href, tool.name).toMatch(/^\//);
			expect(tool.learnMore.length, tool.name).toBeGreaterThan(0);
		}
		expect(en.resources.items.length).toBeGreaterThanOrEqual(10);
		for (const r of en.resources.items) expect(r.href, r.title).toMatch(/^\//);
	});

	it.each(Array.from(new Set(all)))('%s resolves to a page in this repository', (href) => {
		expect(href.startsWith('/'), 'internal links only').toBe(true);
		expect(routeExists(href.split('#')[0]), href).toBe(true);
	});

	it('the tool tiles jump to detail sections with the same ids', () => {
		const tpl = read('src/components/LearnPage.astro');
		expect(tpl).toContain('href={`#${tool.id}`}');
		expect(tpl).toContain('id={tool.id}');
		const ids = en.tools.items.map((x) => x.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('the tutorials section comes last, before the closing, and carries the existing demos and guides', () => {
		const tpl = read('src/components/LearnPage.astro');
		expect(tpl.indexOf('id="tutorials"')).toBeGreaterThan(tpl.indexOf('id="not-h"'));
		expect(tpl.indexOf('id="tutorials"')).toBeLessThan(tpl.indexOf('class="closing"'));
		const targets = en.resources.items.map((r) => r.href);
		for (const must of ['/artifacts/registry', '/artifacts/proof', '/artifacts/cairn', '/guides/crypto-holding-period-after-transfer', '/verify/guide', '/agentics/docs', '/api/demo/start']) {
			expect(targets, must).toContain(must);
		}
	});
});

describe('the words keep to the product\'s rules', () => {
	const all = strings(en);

	it.each(all.map((s) => [s.slice(0, 60), s] as const))('%s', (_label, s) => {
		expect(brightLineViolations(s)).toEqual([]);
		expect(s).not.toContain('—');
		// "Google Safe Browsing" is a source's name, not a verdict.
		expect(s.replace(/Google Safe Browsing/g, '')).not.toMatch(/\bsafe\b/i);
		expect(s).not.toMatch(/\b(trust|risk|safety) (score|rating)s?\b/i);
	});

	it('the page template and the copy module hold no em dash', () => {
		expect(read('src/components/LearnPage.astro')).not.toContain('—');
		expect(read('src/i18n/learn.ts')).not.toContain('—');
	});

	it('the prices match the prices page', () => {
		const prices = read('src/i18n/prices.ts');
		for (const n of ['$7', '$20', '$39']) expect(prices).toContain(n);
		const pricing = en.pricing.rows.map((r) => `${r.price} ${r.body}`).join(' ');
		expect(pricing).toContain('$7');
		expect(pricing).toContain('$20');
		expect(pricing).toContain('$39');
		expect(pricing).toContain('$95');
		// Nothing on the page sells what cannot be bought yet.
		expect(pricing).toMatch(/Standard billing opens soon/);
		expect(pricing).toMatch(/Paid plans come later/);
	});
});
