import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Pin PetroTins to owner-only, so the sitemap case holds whatever the committed switch says.
vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));

import { PRIVACY_HREF, TERMS_HREF } from '../../src/lib/legalLinks';
import { en, es, fr } from '../../src/i18n/loginPage';
import { isPublicPath } from '../../src/middleware/auth';
import { sitemapFilter } from '../../src/lib/seo/sitemapFilter.mjs';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * The User Agreement and Privacy Policy at the moment an account is created (Nov 20, 2026).
 *
 * The Verify and Agentics sign-in pages linked neither, and the Agreement had no page of its own:
 * it opened only as a pop-up from the site footer, and /terms sent a visitor to sign in. Now the
 * Agreement has a public page at /terms, built like /privacy from the same source as the pop-up,
 * and one line sits under every sign-in form: "By continuing, you agree to the User Agreement.
 * The Privacy Policy explains what we keep and why." The public scanner, where no account is
 * created, carries the two links alone.
 *
 * The unit config does not compile .astro files, so the templates are pinned by their source;
 * the HTML was looked at against the built site.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('the User Agreement page', () => {
	it('exists, is public and is in the sitemap, like the Privacy Policy', () => {
		expect(existsSync(path.join(ROOT, `src/pages${TERMS_HREF}.astro`))).toBe(true);
		expect(existsSync(path.join(ROOT, `src/pages${PRIVACY_HREF}.astro`))).toBe(true);
		expect(isPublicPath(TERMS_HREF)).toBe(true);
		expect(isPublicPath(PRIVACY_HREF)).toBe(true);
		expect(sitemapFilter(`https://almstins.com${TERMS_HREF}/`)).toBe(true);
	});

	it('renders the same Agreement as the footer pop-up, with a title free of em dashes', () => {
		const page = read('src/pages/terms.astro');
		expect(page).toContain('import TermsOfService from "../components/terms-of-service.astro";');
		expect(page).toContain('<TermsOfService variant="modal" lang="en" />');
		expect(page).toMatch(/<Layout title="User Agreement \| Almstins">/);
		expect(page).not.toMatch(/<style/);
	});
});

describe('the agreement line', () => {
	const locales = { en, es, fr };

	it('has its words in every language, with exactly one place for each link', () => {
		for (const [lang, t] of Object.entries(locales)) {
			const a = t.signin.agreement;
			expect(a.line.split('{terms}')).toHaveLength(2);
			expect(a.line.split('{privacy}')).toHaveLength(2);
			expect(a.line.indexOf('{terms}')).toBeLessThan(a.line.indexOf('{privacy}'));
			for (const s of [a.line, a.terms, a.privacy]) {
				expect(s.length).toBeGreaterThan(0);
				expect(s).not.toMatch(/—/);
			}
			// The bright-line words are English, so they are checked on English copy only.
			if (lang === 'en') expect(brightLineViolations(`${a.line} ${a.terms} ${a.privacy}`)).toEqual([]);
		}
		expect(en.signin.agreement.line).toBe('By continuing, you agree to the {terms}. The {privacy} explains what we keep and why.');
	});

	it('links the two public pages from one place', () => {
		const c = read('src/components/SigninAgreement.astro');
		expect(c).toContain('href={TERMS_HREF}');
		expect(c).toContain('href={PRIVACY_HREF}');
		expect(c).toContain("import './SigninAgreement.css';");
		expect(c).not.toMatch(/<style|style=/);
	});

	it('sits under every sign-in form, and on the scanner as two links', () => {
		const verifyLogin = read('src/pages/verify/login.astro');
		expect(verifyLogin.indexOf('<SigninAgreement />')).toBeGreaterThan(verifyLogin.indexOf('class="cardfoot"'));
		const agenticsLogin = read('src/pages/agentics/login.astro');
		expect(agenticsLogin.indexOf('<SigninAgreement />')).toBeGreaterThan(agenticsLogin.indexOf('class="cardfoot"'));
		const main = read('src/components/LoginPageComponent.astro');
		expect(main.indexOf('<SigninAgreement lang={t.lang} />')).toBeGreaterThan(main.indexOf('{t.signin.sendMagicLink}'));
		expect(read('src/pages/verify/scan.astro')).toContain('<SigninAgreement variant="links" />');
	});
});
