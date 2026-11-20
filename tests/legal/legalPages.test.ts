import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Pin PetroTins to owner-only, so the sitemap cases hold whatever the committed switch says.
vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));

import { LEGAL_HREF, legalHref, type LegalDoc } from '../../src/lib/legalLinks';
import { legalPagesCopy } from '../../src/i18n/legalPages';
import { getVerifyRoster } from '../../src/i18n/dashboard/verifyRoster';
import { isPublicPath } from '../../src/middleware/auth';
import { sitemapFilter } from '../../src/lib/seo/sitemapFilter.mjs';

/**
 * The public legal pages (Nov 20, 2026, second change of the day).
 *
 * /privacy and /terms used the signed-in app's layout, so a signed-out visitor saw "Titanium Hut",
 * the app menu and an Account button above the document. Now all six pages (both documents in
 * English, Spanish and French) use the public layout that /learn, /prices and /changelog use, with
 * a language switch, and the sign-in line links the page in its own language. The same change
 * shows "Almstins" where the app said "Titanium Hut" (Donnie: "show Almstins, not TitaniumHut.").
 *
 * The unit config does not compile .astro files, so the templates are pinned by their source;
 * the HTML was looked at against the built site.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const LANGS = ['en', 'es', 'fr'] as const;
const DOCS: LegalDoc[] = ['terms', 'privacy'];

describe('the six legal pages', () => {
	it('each exists, renders the shared page for its document and language, is public and is in the sitemap', () => {
		for (const doc of DOCS) for (const lang of LANGS) {
			const href = LEGAL_HREF[doc][lang];
			expect(legalHref(doc, lang)).toBe(href);
			const file = `src/pages${href}.astro`;
			expect(existsSync(path.join(ROOT, file)), file).toBe(true);
			expect(read(file)).toContain(`<LegalPage doc="${doc}" lang="${lang}" />`);
			expect(isPublicPath(href), href).toBe(true);
			expect(sitemapFilter(`https://almstins.com${href}/`), href).toBe(true);
		}
	});

	it('use the public layout, never the app layout, and show the document from its one source', () => {
		const page = read('src/components/legal/LegalPage.astro');
		expect(page).toContain("import Layout from '@/layouts/LoginLayout.astro';");
		expect(page).not.toMatch(/layouts\/Layout\.astro/);
		expect(page).not.toMatch(/Titanium Hut/);
		expect(page).toContain('<TermsOfService variant="modal" lang={lang} />');
		expect(page).toContain('<PrivacyPolicy variant="modal" lang={lang} />');
		expect(page).toContain('hreflang="x-default"');
		expect(page).toContain('href={HOME_HREF[lang]}');
		expect(page).toContain("import './LegalPage.css';");
		expect(page).not.toMatch(/<style|style=/);
	});

	it('have a title and a description in every language, free of em dashes', () => {
		for (const lang of LANGS) for (const doc of DOCS) {
			const { title, description } = legalPagesCopy[lang].docs[doc];
			expect(title).toMatch(/ \| Almstins$/);
			for (const s of [title, description]) {
				expect(s.length).toBeGreaterThan(0);
				expect(s).not.toMatch(/—/);
			}
		}
	});
});

describe('the sign-in line links its own language', () => {
	it('builds both links from the line\'s language', () => {
		expect(legalHref('terms', 'es')).toBe('/terms/es');
		expect(legalHref('privacy', 'fr')).toBe('/privacy/fr');
	});
});

describe('Almstins, not Titanium Hut, in what customers see', () => {
	it('the app header and the Verify roster page say Almstins', () => {
		const layout = read('src/layouts/Layout.astro');
		expect(layout).toContain('<p class="brand">Almstins</p>');
		expect(layout).not.toMatch(/Titanium Hut/);
		for (const lang of LANGS) expect(getVerifyRoster(lang).brandLabel).toBe('Almstins');
	});
});
