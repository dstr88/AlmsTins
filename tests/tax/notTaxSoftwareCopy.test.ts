import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as prices from '../../src/i18n/prices';
import * as loginPage from '../../src/i18n/loginPage';
import * as faq from '../../src/i18n/faq';
import * as onboarding from '../../src/i18n/emails/onboarding';
import * as billing from '../../src/i18n/dashboard/billing';
import * as settings from '../../src/i18n/dashboard/settings';
import * as bookkeeping from '../../src/i18n/dashboard/bookkeeping';
import * as terms from '../../src/i18n/termsOfService';
import * as about from '../../src/i18n/about';
import * as changelog from '../../src/i18n/changelog';
import * as holdingPeriodGuide from '../../src/i18n/guides/holdingPeriodAfterTransfer';

/**
 * Almstins is not tax software (owner decision, Oct 12 2026). It organizes records; it does not
 * prepare or file returns, and tax-form views are the owner's alone. Public and in-app copy
 * must not sell a tax product: no "tax-ready", no "attach to your return", no "tax PDF" for
 * the Year Summary, no Form 8949-style PDF on offer. The Year Summary PDF is described as a
 * record for you and your tax professional, on the Unlimited plan. EN, ES and FR move together,
 * and the rewritten strings carry no em dash.
 */

const LANGS = ['en', 'es', 'fr'] as const;
type Lang = (typeof LANGS)[number];

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

const TAX_PRODUCT =
	/tax-ready|tax ready|listo para impuestos|prêt pour les impôts|ready to attach|attach (it )?to (a|your) return|adjuntar a tu declaración|joindre à votre déclaration|tax PDF|PDF fiscal|Year-Summary tax|full tax breakdown|tax breakdown|desglose fiscal|desglose de impuestos|récapitulatif fiscal|détail fiscal|synthèse fiscale|Form 8949-style|PDF estilo Form 8949|PDF de style Form 8949|crypto taxes, mostly done|impuestos de cripto, casi listos|impôts crypto, déjà presque faits|tax readiness|Tax Readiness/i;

const surfaces = (lang: Lang): Record<string, unknown> => ({
	prices: prices[lang],
	loginPage: loginPage[lang],
	faq: faq[lang],
	onboarding: onboarding[lang],
	billing: billing[lang],
	settings: settings[lang],
	bookkeeping: bookkeeping[lang],
	terms: terms[lang],
	about: about[lang],
	changelogPage: changelog[lang],
});

const PRO = { en: /tax professional/, es: /profesional de impuestos/, fr: /professionnel fiscal/ } as const;

describe('public and in-app copy does not sell a tax product', () => {
	for (const lang of LANGS) {
		it.each(Object.entries(surfaces(lang)))(`${lang}: %s`, (_name, copy) => {
			expect(JSON.stringify(copy)).not.toMatch(TAX_PRODUCT);
		});
	}

	it('the holding-period guide (English only) does not sell a tax product', () => {
		expect(JSON.stringify(holdingPeriodGuide.en)).not.toMatch(TAX_PRODUCT);
	});

	it.each(LANGS)('%s: Terms section B.3 is named for records, not a tax breakdown', (lang) => {
		const heading = terms[lang].body.match(/<h2>B\.3 [^<]*<\/h2>/)?.[0] ?? '';
		expect(heading).toMatch(/Year Summary|Resumen Anual|Résumé Annuel/);
		expect(heading).not.toMatch(/tax|fiscal|impuesto|impôt/i);
	});

	it.each(LANGS)('%s: the Unlimited plan offers the Year Summary PDF as a record for your tax professional', (lang) => {
		const item = prices[lang].plans.unlimited.items[2];
		expect(item).toMatch(/Year Summary PDF|PDF de resumen anual|PDF de récapitulatif annuel/);
		expect(item).toMatch(PRO[lang]);
	});

	it.each(LANGS)('%s: the FAQ offers the Year Summary on Unlimited, not a tax form', (lang) => {
		const text = faq[lang].items.map((i) => i.a).join('\n');
		expect(text).toMatch(/Unlimited/);
		expect(text).not.toMatch(/Box C|Box F/);
		expect(text).toMatch(/not a tax form|No es un formulario fiscal|Ce n'est pas un formulaire fiscal/);
	});

	it.each(LANGS)('%s: the Bookkeeping completeness bar talks about records, not tax readiness', (lang) => {
		expect(bookkeeping[lang].readinessCalculating).not.toMatch(/tax|fiscal|impuesto|impôt/i);
		expect(bookkeeping[lang].readinessLink).not.toMatch(/readiness|preparación|préparation/i);
	});

	it.each(LANGS)('%s: the locked Year Summary button names the Unlimited plan, as the pricing page does', (lang) => {
		const b = bookkeeping[lang];
		expect(b.pdfPremiumBadge).toBe(prices[lang].plans.unlimited.name);
		expect(b.pdfLockedTitle).toMatch(/Unlimited/);
		expect(`${b.pdfLockedTitle} ${b.pdfPremiumBadge}`).not.toMatch(/Premium/);
	});

	it('fr: the Bookkeeping page calls the Year Summary the récapitulatif annuel throughout', () => {
		const b = bookkeeping.fr;
		for (const s of [b.pdfDownloadTitle(2025), b.pdfBtnLabel, b.pdfLockedTitle, b.pdfLockedLabel, b.readinessLink]) {
			expect(s, s).toMatch(/[Rr]écapitulatif annuel/);
			expect(s, s).not.toMatch(/[Rr]ésumé annuel/);
		}
	});

	it('es: the completeness bar checks whether records are complete, not their integrity', () => {
		expect(bookkeeping.es.readinessCalculating).toBe('Comprobando si los registros están completos…');
	});

	it.each(LANGS)('%s: the FAQ calls it the pipeline, not a tax pipeline', (lang) => {
		const faqTax = faq[lang].items.find((i) => i.id === 'faq-tax')!.a;
		expect(faqTax).toMatch(/The pipeline classifies|El pipeline clasifica|Le pipeline classe/);
		expect(faqTax).not.toMatch(/tax pipeline|pipeline de impuestos|pipeline fiscal/i);
	});

	it.each(LANGS)('%s: the international profile description makes no form claim', (lang) => {
		expect(settings[lang].otherProfileDesc).not.toMatch(/form|formulario|formulaire/i);
	});

	it.each(LANGS)('%s: the DeFi Positions note describes the record, with no tax conclusion', (lang) => {
		const note = bookkeeping[lang].defiToolbarNote;
		expect(note).toMatch(/Aave/);
		expect(note).toMatch(/cost basis/);
		expect(note).not.toMatch(/tax|impuesto|taxe|impôt|withdrawn|retirar|retrait/i);
		expect(note).not.toMatch(/—|&/);
	});

	it.each(LANGS)('%s: the rewritten strings carry no em dash', (lang) => {
		const p = prices[lang];
		const l = loginPage[lang];
		const e = onboarding[lang].emails;
		const faqTax = faq[lang].items.find((i) => i.id === 'faq-tax')!.a;
		const yearSummarySentence = faqTax.split(/(?<=\.)\s+/).find((s) => /Unlimited/.test(s)) ?? '';
		const rewritten = [
			p.meta.description,
			p.free.tracking.desc,
			p.plans.sub,
			p.plans.unlimited.items[2],
			l.hub.watcher.desc,
			l.meta.description,
			e[2].subject,
			e[2].paragraphs[1],
			e[2].ctaLabel,
			e[3].paragraphs[2],
			billing[lang].starterFeat3,
			settings[lang].usProfileDesc,
			bookkeeping[lang].readinessCalculating,
			bookkeeping[lang].readinessLink,
			yearSummarySentence,
		];
		expect(yearSummarySentence).not.toBe('');
		for (const s of rewritten) expect(s, s).not.toMatch(/—/);
	});
});

describe('the FAQ describes records, not gain calculation or holding-term classification', () => {
	// The public FAQ once sold "FIFO cost basis and realized gains calculation" and "short-term vs.
	// long-term gain classification" as features, and said lot age decides your tax bill. It now
	// says what the records hold (purchase dates, what you paid, the Year Summary on Unlimited)
	// and leaves the tax meaning to the reader's tax professional (owner rule, Oct 12 2026).
	const FEATURE_CLAIM =
		/realized gains calculation|gain classification|cost basis FIFO y ganancias realizadas|Clasificación de ganancias|cost basis FIFO et des gains réalisés|Classification des gains|gains and losses are calculated automatically|se calculan automáticamente|sont calculés automatiquement|handled for you based on actual hold time|se maneja por ti|gérée automatiquement en fonction du temps de détention|matters at tax time|importa en época de impuestos|compte à la période fiscale|tax bill|factura de impuestos|facture fiscale/i;

	const faqAnswer = (lang: Lang, id: string) => faq[lang].items.find((i) => i.id === id)!.a;
	const paragraphWith = (html: string, re: RegExp) => html.split(/<p>/).find((p) => re.test(p)) ?? '';
	const bookkeepingFeatures = (lang: Lang) => {
		const support = faqAnswer(lang, 'faq-support');
		const start = support.indexOf('<p><strong>Bookkeeping</strong></p>');
		return start === -1 ? '' : support.slice(start, support.indexOf('</ul>', start));
	};

	it.each(LANGS)('%s: no FAQ answer sells gain calculation or term classification', (lang) => {
		const text = faq[lang].items.map((i) => `${i.q}\n${i.a}`).join('\n');
		expect(text).not.toMatch(FEATURE_CLAIM);
	});

	it.each(LANGS)('%s: the Bookkeeping feature list offers purchase history and the Year Summary on Unlimited', (lang) => {
		const list = bookkeepingFeatures(lang);
		expect(list).not.toBe('');
		expect(list).toMatch(/cost basis/);
		expect(list).toMatch(/Year Summary PDF|PDF de resumen anual|PDF de récapitulatif annuel/);
		expect(list).toMatch(/Unlimited/);
		expect(list).toMatch(PRO[lang]);
		expect(list).not.toMatch(/\bgains?\b|ganancia|plus-value|short-term|long-term|corto plazo|largo plazo|court terme|long terme/i);
	});

	it.each(LANGS)('%s: Bookkeeping keeps lot dates for you and your tax professional', (lang) => {
		const lots = paragraphWith(faqAnswer(lang, 'faq-bookkeeping'), /January 1, 2025|1 de enero de 2025|1er janvier 2025/);
		expect(lots).toMatch(/pooled across all your wallets and accounts|de todos tus wallets y cuentas|de tous vos wallets et comptes/);
		expect(lots).toMatch(PRO[lang]);
		expect(lots).not.toMatch(/short-term|long-term|corto|largo plazo|court terme|long terme/i);
	});

	it.each(LANGS)('%s: the rewritten FAQ lines carry no em dash', (lang) => {
		const project = faqAnswer(lang, 'faq-project');
		const overview = project.slice(project.indexOf('<ul'), project.indexOf('</ul>'));
		const fifo = paragraphWith(faqAnswer(lang, 'faq-transactions'), /FIFO/);
		const lots = paragraphWith(faqAnswer(lang, 'faq-bookkeeping'), /January 1, 2025|1 de enero de 2025|1er janvier 2025/);
		const features = bookkeepingFeatures(lang)
			.split('<li>')
			.filter((li) => /cost basis|Unlimited/.test(li));
		expect(features).toHaveLength(2);
		for (const s of [overview, fifo, lots, ...features]) {
			expect(s, s).not.toBe('');
			expect(s, s).not.toMatch(/—/);
		}
	});
});

describe('the completeness score speaks about records, not returns', () => {
	it('no grade label mentions a CPA, a return, or filing', () => {
		const src = read('src/pages/api/yearEnd/completeness.ts');
		const grades = src.slice(src.indexOf('function gradeFrom'), src.indexOf('function pillarOk'));
		expect(grades).not.toMatch(/CPA|your return|file without|—/);
		expect(grades).toMatch(/records look complete/);
	});

	it('the Bookkeeping bar joins the grade and its details without an em dash', () => {
		const src = read('src/pages/dashboard/bookkeeping.astro');
		const fn = src.slice(src.indexOf('function buildLabel'), src.indexOf('try {', src.indexOf('function buildLabel')));
		expect(fn).toMatch(/join\(' · '\)/);
		expect(fn).not.toMatch(/—/);
	});
});

describe('changelog, October 12, 2026: tax-form views', () => {
	const src = read('src/pages/changelog.astro');
	const start = src.indexOf('Tax-form views are no longer offered.');
	const articleStart = src.lastIndexOf('<article', start);
	const entry = src.slice(articleStart, src.indexOf('</article>', start));

	it('is dated October 12, 2026 and says it in plain words', () => {
		expect(start).toBeGreaterThan(-1);
		expect(entry).toMatch(/<time class="entry-date">October 12, 2026<\/time>/);
		expect(entry).toMatch(/it is not tax software, and it does not prepare or file returns/);
		expect(entry).toMatch(/The Year Summary PDF and its verification bundle remain on the Unlimited plan/);
		expect(entry).not.toMatch(/—/);
	});

	it('keeps the privacy entry as the first October 12 entry', () => {
		expect(src.indexOf('October 12, 2026')).toBeLessThan(articleStart);
	});
});

describe('the FAQ describes an Aave liquidation as an event, not a tax characterization', () => {
	// "What if I get liquidated?" once said a liquidation "is treated as a disposal of your
	// collateral, meaning it can be a taxable event". It now says what happens and that Almstins
	// adds the liquidation to your records, for you and your tax professional (owner rule, Oct 12 2026).
	const HEADING = /What if I get liquidated\?|¿Qué pasa si me liquidan\?|Que se passe-t-il si je suis liquidé \?/;
	const liquidation = (lang: Lang) =>
		faq[lang].items
			.find((i) => i.id === 'faq-borrowed-money')!
			.a.split('<p>')
			.find((p) => HEADING.test(p)) ?? '';

	it.each(LANGS)('%s: says the liquidation is added to your records, for you and your tax professional', (lang) => {
		const p = liquidation(lang);
		expect(p).not.toBe('');
		expect(p).toMatch(/Almstins/);
		expect(p).toMatch(/records|registros|registres/);
		expect(p).toMatch(PRO[lang]);
	});

	it.each(LANGS)('%s: calls it neither a disposal nor a taxable event, and carries no em dash', (lang) => {
		const p = liquidation(lang);
		expect(p).not.toMatch(/disposal|disposición|cession|taxable|gravable|imponible|imposable|treated\s+as|se\s+trata\s+como|traité\s+comme/i);
		expect(p).not.toMatch(/—/);
	});
});

describe('changelog, October 12, 2026: FAQ features and Aave liquidation notes', () => {
	const src = read('src/pages/changelog.astro');
	const start = src.indexOf('The help pages no longer list gain calculations');
	const articleStart = src.lastIndexOf('<article', start);
	const entry = src.slice(articleStart, src.indexOf('</article>', start));

	it('is dated October 12, 2026, says it in plain words, and keeps the privacy entry first', () => {
		expect(start).toBeGreaterThan(-1);
		expect(entry).toMatch(/<time class="entry-date">October 12, 2026<\/time>/);
		expect(entry).toMatch(/for your records and your tax professional/);
		expect(entry).toMatch(/the alert email, the note under the liquidation on the Vault page, and the help page answer about liquidations no longer call it a taxable disposal/);
		expect(entry).not.toMatch(/—/);
		expect(src.indexOf('October 12, 2026')).toBeLessThan(articleStart);
	});
});
