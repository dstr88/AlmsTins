import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { VERIFY_BUSINESS_HREF, verifyBusinessHref } from '../../src/lib/verifyBusinessHref';
import { VERIFY_BUSINESS_LANGS } from '../../src/lib/verifyBusiness';
import { VERIFY_PLANS } from '../../src/lib/verifyPlans';
import { copy as verifyCopy } from '../../src/i18n/verify';
import { en as learnEn, es as learnEs, fr as learnFr } from '../../src/i18n/learn';
import { getPrices } from '../../src/i18n/prices';
import { getVerifyDashboard } from '../../src/i18n/dashboard/verify';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * Links to the Verify business page (Nov 20, 2026). The page went live with nothing linking to it;
 * five places now do, each in every language it exists in, each to the business page in that
 * language: the Domain-verified tile and a FAQ question on /verify, the Verify card on /learn, the
 * Verify section of /prices, and the payee section of /agentics/docs (English only).
 *
 * The same change corrects "registering a payment link is the proof": a payer sees a registered
 * link as verified only once the account has proven a website domain.
 *
 * The unit config does not compile .astro files, so the templates are pinned by their source and
 * the copy by its values; the HTML was looked at against the built site.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const LANGS = ['en', 'es', 'fr'] as const;
const FREE = VERIFY_PLANS.free.limits;

// The bright-line words are English ("lien" is the French for link), so they are checked on English copy,
// as tests/verify/businessPage.test.ts does.
function clean(s: string, lang: (typeof LANGS)[number]) {
	expect(s.length).toBeGreaterThan(0);
	expect(s).not.toMatch(/—/);
	if (lang === 'en') expect(brightLineViolations(s)).toEqual([]);
}

describe('where the business page lives', () => {
	it('has one address per language, each a page that exists', () => {
		for (const lang of LANGS) {
			const href = verifyBusinessHref(lang);
			expect(href).toBe(VERIFY_BUSINESS_HREF[lang]);
			expect(existsSync(path.join(ROOT, `src/pages${href}.astro`))).toBe(true);
		}
	});

	it("is the same list the business page's own language switch uses", () => {
		expect(VERIFY_BUSINESS_LANGS.map((l) => [l.code, l.href])).toEqual(LANGS.map((l) => [l, VERIFY_BUSINESS_HREF[l]]));
	});
});

describe('/verify', () => {
	const page = read('src/components/VerifyPage.astro');

	it('the Domain-verified tile points to the business page in the page language', () => {
		expect(page).toMatch(/const BUSINESS_HREF = verifyBusinessHref\(lang\);/);
		const tile = page.slice(page.indexOf('id="tile-dns"'), page.indexOf('</article>', page.indexOf('id="tile-dns"')));
		expect(tile).toContain('<a href={BUSINESS_HREF}>{t.tools.businessLine.link}');
		for (const lang of LANGS) {
			clean(verifyCopy[lang].tools.businessLine.text, lang);
			clean(verifyCopy[lang].tools.businessLine.link, lang);
		}
	});

	it('has one FAQ question that ends with the link, in every language, with the Free plan read from the plans file', () => {
		expect(page).toContain('href={BUSINESS_HREF}>{item.businessLink}');
		for (const lang of LANGS) {
			const linked = verifyCopy[lang].faq.items.filter((i) => i.businessLink);
			expect(linked).toHaveLength(1);
			const [item] = linked;
			expect(verifyCopy[lang].faq.items.indexOf(item)).toBe(1);
			for (const s of [item.q, item.a, item.businessLink!]) clean(s, lang);
			expect(item.a).toContain(`${FREE.address} `);
			expect(item.a).toContain(`${FREE.qr} `);
		}
	});

	it('no longer says registering a payment link is the proof', () => {
		const step = (lang: (typeof LANGS)[number]) => verifyCopy[lang].how.steps[1].body;
		expect(step('en')).not.toMatch(/is the proof/);
		expect(step('es')).not.toMatch(/es la prueba/);
		expect(step('fr')).not.toMatch(/est la preuve/);
		expect(step('en')).toMatch(/payers see it as verified once your account has proven your website’s domain/);
		expect(step('es')).toMatch(/cuando tu cuenta haya demostrado el dominio de tu sitio web/);
		expect(step('fr')).toMatch(/une fois que votre compte a prouvé le domaine de votre site web/);
	});
});

describe('the signed-in guide to adding a payment link', () => {
	it('says registering locks the link to the account, not that it proves it', () => {
		for (const lang of LANGS) {
			const step = getVerifyDashboard(lang).howToStripeSteps[1];
			expect(step).not.toMatch(/is the proof|es la prueba|est la preuve/);
			expect(step).not.toMatch(/—/);
		}
		expect(getVerifyDashboard('en').howToStripeSteps[1]).toMatch(/locks it to your account the moment you save it/);
	});
});

describe('/learn', () => {
	it("lists the business page first among the Verify card's links, in each language", () => {
		for (const [lang, learn] of [['en', learnEn], ['es', learnEs], ['fr', learnFr]] as const) {
			const card = learn.tools.items.find((t) => t.id === 'verify')!;
			expect(card.learnMore[0].href).toBe(VERIFY_BUSINESS_HREF[lang]);
			clean(card.learnMore[0].label, lang);
		}
	});
});

describe('/prices', () => {
	it('links from the Verify section to the business page in the page language', () => {
		const tpl = read('src/components/prices.astro');
		const verify = tpl.slice(tpl.indexOf('<!-- ─── VERIFY'), tpl.indexOf('pricing__foot'));
		expect(verify).toContain('<a href={verifyBusinessHref(t.lang)}>{t.verify.businessLink}');
		for (const lang of LANGS) clean(getPrices(lang).verify.businessLink, lang);
	});
});

describe('/agentics/docs', () => {
	it('points payees to the business page from "If you are the one being paid"', () => {
		const docs = read('src/pages/agentics/docs.astro');
		const section = docs.slice(docs.indexOf('<section id="for-payees">'), docs.indexOf('</section>', docs.indexOf('<section id="for-payees">')));
		expect(section).toContain('<a href={VERIFY_BUSINESS_HREF.en}>almstins.com/verify/business</a>');
	});
});
