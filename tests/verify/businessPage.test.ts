import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// Pin PetroTins to owner-only, so the sitemap cases hold whatever the committed switch says.
vi.mock('../../src/lib/petroTinsFlag.mjs', () => ({ PETRO_TINS_PUBLIC: false }));

import { verifyBusinessCopy, type VerifyBusinessCopy } from '../../src/i18n/verifyBusiness';
import {
	AGENT_DOCS_HREF, CHECK_ANSWERS, MONITOR_EVERY_HOURS, PLANS_EMAIL, READER_HREFS, SCANNER_HREF, SCANNER_RENDERS_IN,
	VERIFY_BUSINESS_LANGS, VERIFY_SIGNIN_HREF, selfSendNetworks, verifyBusinessFacts, verifyBusinessPage,
} from '../../src/lib/verifyBusiness';
import { VERIFY_PLANS } from '../../src/lib/verifyPlans';
import { WELL_KNOWN_PATH } from '../../src/lib/verifyProof';
import { testAmountSpec } from '../../src/lib/verifyTestAmount';
import { VERIFY_ADDRESS_RAILS } from '../../src/lib/chains';
import { verifyScanCopy } from '../../src/i18n/verifyScan';
import { getVerifyDashboard } from '../../src/i18n/dashboard/verify';
import { isPublicPath } from '../../src/middleware/auth';
import { sitemapFilter } from '../../src/lib/seo/sitemapFilter.mjs';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * /verify/business, /verify/business/es and /verify/business/fr: the public page for a business
 * that puts a crypto address on its invoices and for the teams and agents that pay such invoices.
 *
 * The unit config does not compile .astro files, so "renders" is pinned in two halves: the page
 * each language hands the template (verifyBusinessPage, every placeholder filled), and the
 * template's source (it draws every section from that page, in order). The real HTML is looked at
 * against the built server by hand.
 *
 * Pinned here: public, indexable and in the sitemap in three languages; every string present in
 * all three; no em dash and none of the words Almstins never uses about itself; every number read
 * from the code that enforces it; the limits as a section of their own at body size; one action
 * per reader, in the page's order; every internal link a route that exists; components with their
 * own stylesheets, no style block, no style attribute, no script.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const LANGS = ['en', 'es', 'fr'] as const;
type Lang = (typeof LANGS)[number];
const copy = (lang: Lang): VerifyBusinessCopy => verifyBusinessCopy[lang];
const page = (lang: Lang) => verifyBusinessPage(lang);

const COMPONENT_DIR = 'src/components/verifyBusiness';
const COMPONENTS = readdirSync(path.join(ROOT, COMPONENT_DIR)).filter((f) => f.endsWith('.astro')).sort();
const STYLESHEETS = readdirSync(path.join(ROOT, COMPONENT_DIR)).filter((f) => f.endsWith('.css')).sort();
const ROUTE_FILES = ['src/pages/verify/business.astro', 'src/pages/verify/business/es.astro', 'src/pages/verify/business/fr.astro'];
const TEMPLATE = read(`${COMPONENT_DIR}/VerifyBusinessPage.astro`);
const NEW_FILES = [
	'src/i18n/verifyBusiness.ts', 'src/lib/verifyBusiness.ts', ...ROUTE_FILES,
	...COMPONENTS.map((f) => `${COMPONENT_DIR}/${f}`), ...STYLESHEETS.map((f) => `${COMPONENT_DIR}/${f}`),
];

/** A file's code without its comments (headers name the things a file does NOT do). */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');

/** Every string in a value, flattened. */
function strings(value: unknown, out: string[] = []): string[] {
	if (typeof value === 'string') out.push(value);
	else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
	else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
	return out;
}

/** The shape of a value: its keys and the length of its lists, with every string reduced to "s". */
function shape(value: unknown): unknown {
	if (typeof value === 'string') return 's';
	if (Array.isArray(value)) return value.map(shape);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shape(v)]));
	return typeof value;
}

/** Everything a visitor can read on the page: the filled copy (minus the paid plans' own templates) and the built lists. */
function visible(lang: Lang): string[] {
	const p = page(lang);
	const { paid: _templates, ...plansCopy } = p.t.plans;
	const words = strings({ ...p.t, plans: plansCopy });
	const built = strings([p.readers, p.steps, p.scan.results, p.answers, p.plans.map(({ href: _href, ...card }) => card)]);
	return [...words, ...built];
}

/** Routes that exist without a file under src/pages of their own name. */
const KNOWN_ROUTES = new Set(['/']);
function routeExists(href: string): boolean {
	const bare = href.split(/[?#]/)[0];
	if (KNOWN_ROUTES.has(bare)) return true;
	const p = bare.replace(/\/$/, '');
	return [`src/pages${p}.astro`, `src/pages${p}/index.astro`, `src/pages${p}.ts`].some((c) => existsSync(path.join(ROOT, c)));
}

describe('/verify/business is public, indexable and in the sitemap, in every language', () => {
	it('has one route per language, each a page file that renders per request', () => {
		expect(VERIFY_BUSINESS_LANGS.map((l) => l.code)).toEqual([...LANGS]);
		expect(VERIFY_BUSINESS_LANGS.map((l) => l.href)).toEqual(['/verify/business', '/verify/business/es', '/verify/business/fr']);
		for (const [i, f] of ROUTE_FILES.entries()) {
			const src = read(f);
			expect(src, f).toContain('export const prerender = false;');
			expect(src, f).toContain("import VerifyBusinessPage from '@/components/verifyBusiness/VerifyBusinessPage.astro';");
			expect(src, f).toContain(`<VerifyBusinessPage lang="${LANGS[i]}" />`);
			expect(routeExists(VERIFY_BUSINESS_LANGS[i].href), f).toBe(true);
		}
	});

	it('is reachable without a session, with and without the trailing slash', () => {
		for (const l of VERIFY_BUSINESS_LANGS) {
			expect(isPublicPath(l.href), l.href).toBe(true);
			expect(isPublicPath(`${l.href}/`), l.href).toBe(true);
		}
	});

	it('the sitemap submits every language, and still nothing else new under /verify/', () => {
		for (const l of VERIFY_BUSINESS_LANGS) {
			expect(sitemapFilter(`https://almstins.com${l.href}/`), l.href).toBe(true);
			expect(sitemapFilter(`https://almstins.com${l.href}`), l.href).toBe(true);
		}
		for (const p of ['/verify/business/de/', '/verify/business/private/', '/verify/scan/', '/verify/login/']) {
			expect(sitemapFilter(`https://almstins.com${p}`), p).toBe(false);
		}
	});

	it('the template turns noindex off and names the canonical and an alternate per language', () => {
		expect(TEMPLATE).toContain('noindex={false}');
		expect(TEMPLATE).toContain('canonical={page.canonical}');
		expect(TEMPLATE).toContain('VERIFY_BUSINESS_LANGS.map((l) => <link rel="alternate" hreflang={l.code}');
		expect(TEMPLATE).toContain('<link rel="alternate" hreflang="x-default" href="https://almstins.com/verify/business" />');
		expect(TEMPLATE).toContain('title={t.meta.title} description={t.meta.description} lang={lang}');
		expect(code(TEMPLATE)).not.toMatch(/name="robots"/);
	});

	it.each(LANGS)('%s: its own canonical, title and description', (lang) => {
		const p = page(lang);
		const here = VERIFY_BUSINESS_LANGS.find((l) => l.code === lang)!;
		expect(p.canonical).toBe(`https://almstins.com${here.href}`);
		expect(p.t.lang).toBe(lang);
		expect(p.t.meta.title.length).toBeGreaterThan(30);
		expect(p.t.meta.title.length).toBeLessThanOrEqual(90);
		expect(p.t.meta.description.length).toBeGreaterThan(110);
		expect(p.t.meta.description.length).toBeLessThanOrEqual(320);
		expect(p.t.meta.title).toContain('Almstins Verify');
	});
});

describe('the page renders in three languages', () => {
	it.each(LANGS)('%s: every section has its words, and no placeholder is left unfilled', (lang) => {
		const p = page(lang);
		expect(p.readers).toHaveLength(3);
		expect(p.steps).toHaveLength(2);
		expect(p.scan.results).toHaveLength(3);
		expect(p.answers).toHaveLength(4);
		expect(p.plans).toHaveLength(3);
		expect(p.t.problem.body.length).toBeGreaterThanOrEqual(2);
		expect(p.t.limits.items).toHaveLength(4);
		const all = visible(lang);
		expect(all.length).toBeGreaterThan(80);
		for (const s of all) {
			expect(s.trim().length, s).toBeGreaterThan(0);
			expect(s, s).not.toMatch(/[{}]/);
			expect(s, s).not.toMatch(/undefined|null|NaN/);
		}
	});

	it('the template draws every section from the page it is handed, in the order the page speaks', () => {
		expect(TEMPLATE).toContain('const page = verifyBusinessPage(lang);');
		const order = [
			'<h1 class="vb-hero__title" id="vb-h1">{t.hero.h1}</h1>',
			'<Section id="readers" heading={t.readers.heading}>',
			'<ReaderCards items={page.readers} />',
			'<Section id="problem" heading={t.problem.heading} tone="problem">',
			'<Section id="prove" heading={t.prove.heading} lede={t.prove.lede}>',
			'<ProofSteps steps={page.steps} costLabel={t.prove.costLabel} earnsLabel={t.prove.earnsLabel} />',
			'<TitledList items={t.prove.more} />',
			'<Section id="payer" heading={t.payer.heading} lede={t.payer.lede}>',
			'<ScanResults results={page.scan.results} titleLang={page.scan.titleLang} />',
			'<Section id="agent" heading={t.agent.heading} lede={t.agent.lede}>',
			'<AnswerCards items={page.answers} />',
			'<Callout title={t.agent.rule.title} body={t.agent.rule.body} tone="rule" />',
			'<Section id="limits" heading={t.limits.heading} lede={t.limits.lede} tone="limits">',
			'<Section id="plans" heading={t.plans.heading} lede={t.plans.lede}>',
			'<PlanCards plans={page.plans} />',
			'<Section id="next" heading={t.closing.heading} lede={t.closing.body}>',
		];
		let at = -1;
		for (const piece of order) {
			const next = TEMPLATE.indexOf(piece);
			expect(next, piece).toBeGreaterThan(at);
			at = next;
		}
		expect((TEMPLATE.match(/<h1/g) ?? []).length).toBe(1);
	});

	it('the template holds no words of its own: they come from the copy file', () => {
		const en = strings(copy('en')).filter((s) => s.length > 12);
		for (const s of en) expect(TEMPLATE.includes(s), s).toBe(false);
		expect(TEMPLATE).toContain("import { VERIFY_BUSINESS_LANGS, verifyBusinessPage } from '@/lib/verifyBusiness';");
	});
});

describe('every string exists in all three languages', () => {
	it('the three copies have the same shape: the same keys and the same number of items in every list', () => {
		expect(shape(copy('es'))).toEqual(shape(copy('en')));
		expect(shape(copy('fr'))).toEqual(shape(copy('en')));
	});

	it.each(LANGS)('%s: no string is empty', (lang) => {
		for (const s of strings(copy(lang))) expect(s.trim().length).toBeGreaterThan(0);
	});

	it('no language is a copy of another', () => {
		// The product name, the plan sizes and the money pattern are the same words in every language.
		const SHARED = new Set(['Almstins Verify', '${n}', '$0']);
		const en = strings(copy('en'));
		for (const lang of ['es', 'fr'] as const) {
			const other = strings(copy(lang));
			expect(other).toHaveLength(en.length);
			other.forEach((s, i) => {
				if (i === 0 || SHARED.has(s)) return; // the first string is the language code
				expect(s, `${lang}: ${s}`).not.toBe(en[i]);
			});
		}
		expect(strings(copy('es')).slice(1)).not.toEqual(strings(copy('fr')).slice(1));
	});

	it('the placeholders are the same in every language, string by string', () => {
		const holders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
		const en = strings(copy('en'));
		for (const lang of ['es', 'fr'] as const) {
			strings(copy(lang)).forEach((s, i) => expect(holders(s), `${lang}: ${s}`).toEqual(holders(en[i])));
		}
	});
});

describe("the words keep to the product's rules", () => {
	/** Words the copy never uses about what Almstins does, per language. */
	const BANNED: Record<Lang, RegExp[]> = {
		en: [/\b(stop|block|protect|prevent|secur)\w*/i, /\b(un)?safe(r|st|ly|ty|guard\w*)?\b/i, /\bfraud\w*/i],
		es: [/\b(deten|detien|detuv|bloque|proteg|protej|protecc|impid|impedi|previen|preven)\w*/i, /\b(in)?segur\w*/i, /\ba salvo\b/i, /\bfraude\w*/i],
		fr: [/\b(arrêt|bloqu|protég|protèg|protect|empêch|prévien|préven|sécuri)\w*/i, /\bsûre?s?\b/i, /\bà l[’']abri\b/i, /\bfraude\w*/i],
	};
	/** "Guarantee" appears once, in the limit that says a result is not one. */
	const GUARANTEE: Record<Lang, { word: RegExp; negated: RegExp }> = {
		en: { word: /guarant/i, negated: /is not a guarantee/i },
		es: { word: /garant[ií]/i, negated: /no es una garantía/i },
		fr: { word: /garanti/i, negated: /n[’']est pas une garantie/i },
	};

	it.each(LANGS.flatMap((lang) => visible(lang).map((s) => [`${lang}: ${s.slice(0, 50)}`, lang, s] as const)))('%s', (_label, lang, s) => {
		expect(s).not.toContain('—');
		for (const pattern of BANNED[lang]) expect(s.match(pattern)?.[0] ?? null, s).toBeNull();
		if (GUARANTEE[lang].word.test(s)) expect(s).toMatch(GUARANTEE[lang].negated);
	});

	it.each(LANGS)('%s: a result is called not a guarantee exactly once', (lang) => {
		expect(visible(lang).filter((s) => GUARANTEE[lang].word.test(s))).toHaveLength(1);
	});

	it.each(visible('en').map((s) => [s.slice(0, 60), s] as const))('en bright lines: %s', (_label, s) => {
		expect(brightLineViolations(s)).toEqual([]);
		expect(s).not.toMatch(/\b(trust|risk|safety) (score|rating)s?\b/i);
	});

	it('the copy states no statistic, count of customers or dated case: it holds no digits but the Free price', () => {
		for (const lang of LANGS) {
			const free = copy(lang).plans.free.price;
			for (const s of strings(copy(lang))) {
				if (s === free) continue;
				expect(s.match(/\d/)?.[0] ?? null, `${lang}: ${s}`).toBeNull();
				expect(s, s).not.toContain('%');
			}
		}
	});

	it('never says that registering a payment link is a proof', () => {
		expect(visible('en').join(' ')).not.toMatch(/is the proof|is proof|proves? (a|the|your) (payment )?link/i);
		// A payment link appears only as something a payer can paste, something the screen checks, and a plan size.
		for (const lang of LANGS) {
			const p = page(lang);
			expect(strings([p.steps, p.t.prove.more]).join(' '), lang).not.toMatch(/Stripe|PayPal/i);
		}
	});

	it('the French copy never lets a punctuation mark wrap alone: non-breaking spaces before : ; ? ! and inside the quote marks', () => {
		for (const s of strings(copy('fr'))) {
			expect(s.match(/ [:;?!»]|« /)?.[0] ?? null, s).toBeNull();
		}
		const all = strings(copy('fr')).join(' ');
		expect(all).toContain('«\u00a0Vérifié\u00a0»');
		expect(all).toContain('\u00a0:');
	});

	it('no new file holds an em dash', () => {
		for (const f of NEW_FILES) expect(read(f), f).not.toContain('—');
	});
});

describe('every number comes from the code that enforces it', () => {
	const free = VERIFY_PLANS.free.limits;

	it('the placeholders stand for the live values', () => {
		expect(verifyBusinessFacts()).toEqual({
			address: String(free.address),
			qr: String(free.qr),
			hours: String(MONITOR_EVERY_HOURS),
			path: WELL_KNOWN_PATH,
			networks: selfSendNetworks().join(', '),
			email: PLANS_EMAIL,
		});
	});

	it.each(LANGS)('%s: the plan cards carry the plans in src/lib/verifyPlans.ts, Free first', (lang) => {
		const cards = page(lang).plans;
		expect(cards.map((c) => c.id)).toEqual(['free', 'business', 'pro']);
		const [freeCard, business, pro] = cards;

		expect(VERIFY_PLANS.free.monthlyUsd).toBe(0);
		expect(freeCard.price).toMatch(/^\$0$|^0 \$$/);
		expect(freeCard.yearly).toBeNull();
		expect(freeCard.items[0]).toMatch(new RegExp(`^${free.address} .+ ${free.qr} `));
		expect(freeCard.href).toBe(VERIFY_SIGNIN_HREF);

		for (const [card, id] of [[business, 'business'], [pro, 'pro']] as const) {
			const plan = VERIFY_PLANS[id];
			expect(card.name).toBe(plan.name);
			expect(card.price.replace(/\D/g, '')).toBe(String(plan.monthlyUsd));
			expect(card.yearly!.replace(/\D/g, '')).toBe(String(plan.yearlyUsd));
			expect(card.items[0].startsWith(`${plan.limits.total} `), card.items[0]).toBe(true);
			expect(card.href).toBe(`mailto:${PLANS_EMAIL}?subject=Almstins%20Verify%3A%20Business%20or%20Pro%20plan`);
		}
	});

	it('the English cards read as the brief states them', () => {
		const [freeCard, business, pro] = page('en').plans;
		expect(freeCard.items[0]).toBe('2 wallet addresses and 1 payment QR or link');
		expect(business.items[0]).toBe('10 destinations, any mix of wallet addresses and payment QRs or links');
		expect(pro.items[0]).toBe('50 destinations, any mix of wallet addresses and payment QRs or links');
		expect([business.price, business.yearly, pro.price, pro.yearly]).toEqual(['$99', 'or $990/year', '$299', 'or $2,990/year']);
		expect(business.items).toContain('Not sold online: ask by email');
		expect(page('en').t.plans.lede).toBe('The Free plan stays free. The paid plans hold more destinations and are arranged by email.');
	});

	it.each(LANGS)('%s: the page description and the plans note carry the Free sizes and the plans mailbox', (lang) => {
		const p = page(lang);
		expect(p.t.meta.description).toMatch(new RegExp(`\\b${free.address}\\b.+\\b${free.qr}\\b`));
		expect(p.t.plans.note).toContain(PLANS_EMAIL);
	});

	it("the plans mailbox is the one the dashboard's plan notice names", () => {
		expect(read('src/i18n/dashboard/verify.ts')).toContain(`available by email at ${PLANS_EMAIL}`);
	});

	it('the re-check interval is the monitor job\'s schedule', () => {
		const workflow = read('.github/workflows/verify-monitor.yml');
		expect(workflow).toContain(`- cron: '30 */${MONITOR_EVERY_HOURS} * * *'`);
		expect(workflow).toContain('/api/cron/verify-monitor');
		for (const lang of LANGS) {
			const p = page(lang);
			expect(p.t.limits.items[3].body, lang).toContain(` ${MONITOR_EVERY_HOURS} `);
			expect(p.t.prove.more[2].body, lang).toContain(` ${MONITOR_EVERY_HOURS} `);
		}
	});

	it('the proof file path is the one the proof check fetches', () => {
		expect(WELL_KNOWN_PATH).toBe('/.well-known/almstins-verify.json');
		for (const lang of LANGS) expect(page(lang).steps[1].body, lang).toContain(WELL_KNOWN_PATH);
	});

	it('the satoshi test is offered on the networks that have a test amount, and only those', () => {
		const withSpec = VERIFY_ADDRESS_RAILS.filter((c) => testAmountSpec(c) !== null);
		expect(selfSendNetworks()).toHaveLength(withSpec.length);
		expect(selfSendNetworks()).toEqual(expect.arrayContaining(['Bitcoin', 'Ethereum']));
		for (const lang of LANGS) expect(page(lang).steps[0].note, lang).toContain(selfSendNetworks().join(', '));
	});

	it('the four answers are the ones the check gives and the agent docs explain, with the same tones', () => {
		const codes = CHECK_ANSWERS.map((a) => a.code);
		expect(codes).toEqual(['proven', 'mismatch', 'unanchored', 'unknown']);
		const check = read('src/pages/api/verify/check.ts');
		for (const c of codes) expect(check, c).toContain(`'${c}'`);
		const docs = read('src/pages/agentics/docs.astro');
		const documented = [...docs.matchAll(/code: '(\w+)',\s*cls: '(\w+)'/g)].map((m) => ({ code: m[1], cls: m[2] }));
		expect(documented).toEqual(CHECK_ANSWERS.map((a) => ({ code: a.code, cls: a.cls })));
		for (const lang of LANGS) expect(page(lang).answers.map((a) => a.code), lang).toEqual(codes);
	});

	it('the rule is the published one: proven, with the expected domain passed, and everything else held for a person', () => {
		const docs = read('src/pages/agentics/docs.astro');
		expect(docs).toContain('Hold everything else for a human.');
		expect(docs).toContain('The API ignores an empty expect');
		const en = page('en').t.agent;
		expect(en.rule.body).toMatch(/^Proceed only when the answer is proven and you passed the domain you expected, taken from your own records and never from the invoice\./);
		expect(en.rule.body).toContain('Hold everything else for a person.');
		expect(en.answers.proven.p).toContain('the only answer to proceed on');
		for (const code of ['mismatch', 'unanchored', 'unknown'] as const) expect(en.answers[code].p, code).toMatch(/\bHold\b/);
		for (const lang of ['es', 'fr'] as const) expect(page(lang).t.agent.rule.body, lang).toContain('proven');
	});

	it("what a payer sees carries the scanner's own titles, in the language the scanner renders in", () => {
		expect(SCANNER_RENDERS_IN).toBe('en');
		const scanPage = read('src/pages/verify/scan.astro');
		expect(scanPage).toContain('<html lang="en">');
		expect(scanPage).toContain('<VerifyScan client:load initialAddress={initialAddress} />');
		const scanner = verifyScanCopy[SCANNER_RENDERS_IN];
		for (const lang of LANGS) {
			const { titleLang, results } = page(lang).scan;
			expect(titleLang).toBe('en');
			expect(results.map((r) => [r.id, r.tone, r.title])).toEqual([
				['verified', 'good', scanner.verifiedTitle],
				['claimed', 'warn', scanner.claimedTitle.address],
				['unproven', 'plain', scanner.notVerifiedTitle],
			]);
		}
		// The Spanish and French pages say that the result is shown in English for now.
		expect(page('es').t.payer.lede).toContain('en inglés');
		expect(page('fr').t.payer.lede).toContain('en anglais');
		expect(read(`${COMPONENT_DIR}/ScanResults.astro`)).toContain('lang={titleLang}');
	});

	it("the steps use the dashboard's own words for the test and the two marks", () => {
		const en = page('en');
		expect(en.steps[0].title).toContain('the satoshi test (a self-send)');
		expect(en.steps[0].earns).toContain(`reads ${getVerifyDashboard('en').statusClaimed}`);
		expect(en.steps[1].earns).toContain(`reads ${getVerifyDashboard('en').statusProven}`);
		for (const lang of ['es', 'fr'] as const) {
			const d = getVerifyDashboard(lang);
			expect(page(lang).steps[0].earns, lang).toContain(d.statusClaimed);
			expect(page(lang).steps[1].earns, lang).toContain(d.statusProven);
		}
		expect(page('es').steps[0].title).toContain('la prueba del satoshi (un autoenvío)');
		expect(page('fr').steps[0].title).toContain('le test du satoshi (un auto-envoi)');
	});

	it('a DNS record is described as proving the domain and the name, never as listing addresses', () => {
		expect(read('src/lib/verifyProof.ts')).toContain('a TXT record carries NO address list');
		expect(page('en').t.prove.more[1].body).toBe('A DNS record proves that you control the domain and attaches your business name. It carries no list of addresses, so the file or the roster is what earns Verified.');
	});
});

describe('the limits are on the page, as a section of their own', () => {
	it('English states the four limits', () => {
		const items = page('en').t.limits.items;
		expect(items.map((i) => i.title)).toEqual([
			'It proves control, not identity.',
			'A good result is not a guarantee.',
			'Almstins warns and flags. That is all it does.',
			'A change can go unnoticed for hours.',
		]);
		expect(items[0].body).toMatch(/does not show who legally owns the business/);
		expect(items[1].body).toMatch(/not a promise about any payment/);
		expect(items[2].body).toMatch(/never in the path of a payment\. It holds no keys and no funds, and it moves and signs nothing\./);
		expect(items[3].body).toMatch(/every 6 hours/);
	});

	it.each(LANGS)('%s: four limits, each a title and a full sentence', (lang) => {
		const { heading, lede, items } = page(lang).t.limits;
		expect(heading.length).toBeGreaterThan(5);
		expect(lede.length).toBeGreaterThan(15);
		expect(items).toHaveLength(4);
		for (const item of items) {
			expect(item.title.length, item.title).toBeGreaterThan(20);
			expect(item.body.length, item.body).toBeGreaterThan(90);
		}
	});

	it('they sit between what the page offers and the plans, in the framed section, at body size', () => {
		const limits = TEMPLATE.indexOf('<Section id="limits"');
		expect(limits).toBeGreaterThan(TEMPLATE.indexOf('<Section id="agent"'));
		expect(limits).toBeLessThan(TEMPLATE.indexOf('<Section id="plans"'));
		expect(TEMPLATE).toContain('<TitledList items={t.limits.items} variant="limits" />');
		const css = read(`${COMPONENT_DIR}/TitledList.css`);
		expect(css).toContain('.vb-titled--limits .vb-titled__body { font-size: 1rem; color: var(--text-primary); }');
		expect(css).toContain('.vb-titled--limits .vb-titled__title { font-size: 1.08rem; }');
		expect(read(`${COMPONENT_DIR}/Section.css`)).toContain('.vb-section--limits {');
	});
});

describe('one clear action for each reader, and every link a route that exists', () => {
	it('the readers come in the page\'s order, each with its own action', () => {
		expect([...READER_HREFS]).toEqual([VERIFY_SIGNIN_HREF, SCANNER_HREF, AGENT_DOCS_HREF]);
		expect([VERIFY_SIGNIN_HREF, SCANNER_HREF, AGENT_DOCS_HREF]).toEqual(['/verify/login?next=/dashboard/verify', '/verify/scan', '/agentics/docs']);
		for (const lang of LANGS) expect(page(lang).readers.map((r) => r.href), lang).toEqual([...READER_HREFS]);
		const en = page('en').readers;
		expect(en.map((r) => r.title)).toEqual([
			'A business that puts a crypto address on its invoices',
			'A payments or treasury team',
			'Someone running AI agents that pay suppliers',
		]);
		expect(en.map((r) => r.action)).toEqual(['Prove your addresses', 'Check an address now', 'Read the agent docs']);
	});

	it('each action is offered where its section ends and once more at the close', () => {
		expect(TEMPLATE).toContain('<ActionLink href={links.signin} label={t.prove.cta} />');
		expect(TEMPLATE).toContain('<ActionLink href={links.scanner} label={t.payer.cta} />');
		expect(TEMPLATE).toContain('<ActionLink href={links.agentDocs} label={t.agent.cta} />');
		expect(TEMPLATE).toContain('<ActionLink href={reader.href} label={reader.action} />');
		for (const lang of LANGS) {
			const p = page(lang);
			expect([p.t.prove.cta, p.t.payer.cta, p.t.agent.cta], lang).toEqual(p.readers.map((r) => r.action));
		}
	});

	const internal = Array.from(new Set(LANGS.flatMap((lang) => {
		const p = page(lang);
		return [...Object.values(p.links), ...p.readers.map((r) => r.href), ...p.plans.map((c) => c.href), ...VERIFY_BUSINESS_LANGS.map((l) => l.href)];
	}).filter((href) => !href.startsWith('mailto:'))));

	it.each(internal)('%s resolves to a page in this repository', (href) => {
		expect(href.startsWith('/'), 'internal links only').toBe(true);
		expect(routeExists(href), href).toBe(true);
		const next = new URL(href, 'https://x.invalid').searchParams.get('next');
		if (next) expect(routeExists(next), next).toBe(true);
	});

	it('the Spanish and French pages point at the pages that exist in their language', () => {
		for (const lang of ['es', 'fr'] as const) {
			expect(page(lang).links.shop).toBe(`/verify/${lang}`);
			expect(page(lang).links.prices).toBe(`/prices/${lang}`);
		}
		expect(page('en').links.shop).toBe('/verify');
		expect(page('en').links.prices).toBe('/prices');
	});

	it('the components link nowhere on their own: every href is handed to them', () => {
		for (const f of COMPONENTS) {
			const literal = [...code(read(`${COMPONENT_DIR}/${f}`)).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
			expect(literal, f).toEqual(f === 'VerifyBusinessPage.astro' ? ['https://almstins.com/verify/business'] : []);
		}
	});
});

describe('built from components, with the styles in their own files', () => {
	it('every component has a stylesheet of its own name and imports it', () => {
		expect(COMPONENTS.length).toBeGreaterThanOrEqual(8);
		for (const f of COMPONENTS) {
			const css = f.replace(/\.astro$/, '.css');
			expect(STYLESHEETS, f).toContain(css);
			expect(read(`${COMPONENT_DIR}/${f}`), f).toContain(`import './${css}';`);
		}
		expect(STYLESHEETS).toHaveLength(COMPONENTS.length);
	});

	it('no style block, no style attribute, no script and no raw html, in the components or the routes', () => {
		for (const f of [...COMPONENTS.map((c) => `${COMPONENT_DIR}/${c}`), ...ROUTE_FILES]) {
			expect(code(read(f)), f).not.toMatch(/<style|\sstyle=|<script|set:html|innerHTML/);
		}
	});

	it('the four answers reuse the docs kit cards the agent docs show', () => {
		expect(TEMPLATE).toContain("import AnswerCards from '@/components/docs/AnswerCards.astro';");
		expect(read('src/pages/agentics/docs.astro')).toContain("import AnswerCards from '@/components/docs/AnswerCards.astro';");
	});

	it('the stylesheets take every color from the design tokens', () => {
		for (const f of STYLESHEETS) {
			const css = code(read(`${COMPONENT_DIR}/${f}`));
			expect(css, f).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
			for (const token of css.match(/var\(--[\w-]+\)/g) ?? []) {
				expect(read('src/styles/tokens.css'), `${f} ${token}`).toContain(`${token.slice(4, -1)}:`);
			}
		}
	});
});
