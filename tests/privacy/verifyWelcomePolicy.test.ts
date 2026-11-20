import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as policy from '../../src/i18n/privacyPolicy';
import { verifyWelcomeLocales } from '../../src/i18n/emails/verifyWelcome';

/**
 * Privacy Policy v1.7 describes the Verify welcome emails and personal notes, in English,
 * (The policy has moved on to v1.8 since; that wording is unchanged.)
 * Spanish and French. Section 4 lists what we use information for ("only to"), so every email
 * Almstins sends has to be in it. This file holds the new lines to the code they describe
 * (src/lib/onboardingDrip.ts, campaign `verify-welcome`):
 *
 *   - an account that signed up through Almstins Verify gets two emails, one on the day it signs
 *     up and one three days later, in place of the getting-started series;
 *   - they end when it registers its first Verify Destination;
 *   - it gets the getting-started series only if it adds a wallet;
 *   - we may write to an account holder personally, who can ask us to stop.
 *
 * The version and date are held by tests/privacy/agenticsPolicyV13.test.ts. Pure copy checks.
 */
const LANGS = ['en', 'es', 'fr'] as const;
type Lang = (typeof LANGS)[number];
const bodies: Record<Lang, string> = { en: policy.en.body, es: policy.es.body, fr: policy.fr.body };
const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

/** One numbered section of the policy, from its <h2> to the next. */
function section(body: string, n: number): string {
	const start = body.indexOf(`<h2>${n}.`);
	expect(start, `section ${n}`).toBeGreaterThan(-1);
	const next = body.indexOf('<h2>', start + 4);
	return body.slice(start, next === -1 ? undefined : next);
}
/** The list items of Section 4, How We Use Information. */
const uses = (lang: Lang): string[] => [...section(bodies[lang], 4).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const useThatOpens = (lang: Lang, opening: string): string => {
	const found = uses(lang).filter((item) => item.startsWith(opening));
	expect(found, `${lang}: ${opening}`).toHaveLength(1);
	return found[0];
};

const WELCOME_OPENS: Record<Lang, string> = {
	en: 'If you signed up through Almstins Verify, send you two emails about proving your first address',
	es: 'Si usted se registró a través de Almstins Verify, enviarle dos correos sobre cómo demostrar su primera dirección',
	fr: 'Si vous vous êtes inscrit via Almstins Verify, vous envoyer deux e-mails sur la façon de prouver votre première adresse',
};
const NOTE_OPENS: Record<Lang, string> = {
	en: 'Write to you personally, on occasion,',
	es: 'Escribirle personalmente, de vez en cuando,',
	fr: "Vous écrire personnellement, à l'occasion,",
};

describe('Section 4 describes the Verify welcome emails', () => {
	const said: Record<Lang, { when: string; ends: string; wallet: string; unsubscribe: string; insteadOf: string }> = {
		en: {
			insteadOf: 'in place of the getting-started series',
			when: 'one on the day you sign up and one three days later',
			ends: 'They end as soon as you register your first Verify Destination, when the series about Almstins Verify described above begins.',
			wallet: 'You get the getting-started series only if you add a wallet.',
			unsubscribe: 'Each has the same unsubscribe link.',
		},
		es: {
			insteadOf: 'en lugar de la serie de correos de introducción',
			when: 'uno el día en que se registra y otro tres días después',
			ends: 'Terminan en cuanto usted registra su primer Destino en Verify, momento en que comienza la serie sobre Almstins Verify descrita arriba.',
			wallet: 'Usted recibe la serie de correos de introducción solo si agrega una wallet.',
			unsubscribe: 'Cada uno incluye el mismo enlace para darse de baja.',
		},
		fr: {
			insteadOf: "à la place de la série d'e-mails de prise en main",
			when: 'un le jour de votre inscription et un trois jours plus tard',
			ends: 'Ils prennent fin dès que vous enregistrez votre première Destination Verify ; la série consacrée à Almstins Verify décrite ci-dessus commence alors.',
			wallet: "Vous ne recevez la série d'e-mails de prise en main que si vous ajoutez un wallet.",
			unsubscribe: 'Chacun contient le même lien de désabonnement.',
		},
	};

	it.each(LANGS)('%s: who gets them, when, when they end, and the wallet rule', (lang) => {
		const line = useThatOpens(lang, WELCOME_OPENS[lang]);
		for (const words of Object.values(said[lang])) expect(line, words).toContain(words);
	});

	it.each(LANGS)('%s: it is its own line, right after the line about the two older series', (lang) => {
		const items = uses(lang);
		const at = items.findIndex((item) => item.startsWith(WELCOME_OPENS[lang]));
		expect(items[at - 1]).toMatch(/Almstins Verify/);
		expect(items[at - 1]).toMatch(/unsubscribe link|enlace para darse de baja|lien de désabonnement/);
		expect(items[at - 1]).not.toBe(items[at]);
	});

	it('that is what the code does: two emails, on day 0 and day 3, ended by a destination, the other series only with a wallet', () => {
		// Read as source: the engine needs a database to load.
		const engine = read('src/lib/onboardingDrip.ts');
		expect(engine).toContain("'verify-welcome': { cadence: [0, 3], locales: verifyWelcomeLocales, replyTo: VERIFY_WELCOME_REPLY_TO },");
		expect(engine).toContain("AND NOT ${verifyStartedUser('campaign_drip.user_id')}");
		expect(engine).toContain("AND NOT ${verifyOnlyUser('au.id')}");
		for (const lang of LANGS) expect(verifyWelcomeLocales[lang].emails).toHaveLength(2);
	});

	it.each(LANGS)('%s: the line about the two older series still says what it said', (lang) => {
		const older: Record<Lang, string> = {
			en: 'Send you a short series of getting-started emails after you sign up, and a series about Almstins Verify after you register your first Verify Destination. They describe features, including our paid plans. Accounts that use only our financing desks do not get the first series. Each email has an unsubscribe link that stops the rest of that series.',
			es: 'Enviarle una breve serie de correos de introducción después de registrarse, y una serie sobre Almstins Verify después de registrar su primer Destino en Verify. Describen funciones, incluidos nuestros planes de pago. Las cuentas que solo usan nuestras mesas de financiación no reciben la primera serie. Cada correo incluye un enlace para darse de baja que detiene el resto de esa serie.',
			fr: "Vous envoyer une courte série d'e-mails de prise en main après votre inscription, et une série consacrée à Almstins Verify après l'enregistrement de votre première Destination Verify. Ils présentent des fonctionnalités, y compris nos abonnements payants. Les comptes qui n'utilisent que nos bureaux de financement ne reçoivent pas la première série. Chaque e-mail contient un lien de désabonnement qui arrête le reste de cette série.",
		};
		expect(uses(lang)).toContain(older[lang]);
	});
});

describe('Section 4 says we may write to you personally', () => {
	const whole: Record<Lang, string> = {
		en: 'Write to you personally, on occasion, about your account or to ask how the Service is working for you; you can ask us to stop at any time.',
		es: 'Escribirle personalmente, de vez en cuando, sobre su cuenta o para preguntarle cómo le está funcionando el Servicio; usted puede pedirnos que dejemos de hacerlo en cualquier momento.',
		fr: "Vous écrire personnellement, à l'occasion, au sujet de votre compte ou pour vous demander comment le Service fonctionne pour vous ; vous pouvez nous demander d'arrêter à tout moment.",
	};

	it.each(LANGS)('%s: one sentence, as its own line, with the way to end it', (lang) => {
		expect(useThatOpens(lang, NOTE_OPENS[lang])).toBe(whole[lang]);
	});

	it.each(LANGS)('%s: Section 10 names those notes among what our own inboxes carry', (lang) => {
		const notes: Record<Lang, string> = {
			en: 'and notes we write to you personally)',
			es: 'y las notas que le escribimos personalmente)',
			fr: 'et notes que nous vous écrivons personnellement)',
		};
		expect(section(bodies[lang], 10)).toContain(notes[lang]);
	});
});

describe('the rest of the policy agrees with the new lines', () => {
	it.each(LANGS)('%s: Section 5 says a registered Destination decides which Verify emails are sent', (lang) => {
		const decides: Record<Lang, string> = {
			en: 'and decide which Verify emails to send you (Section 4).',
			es: 'y decidir qué correos de Verify enviarle (Sección 4).',
			fr: 'et déterminer quels e-mails Verify vous envoyer (Section 4).',
		};
		expect(section(bodies[lang], 5)).toContain(decides[lang]);
		expect(bodies[lang]).not.toMatch(/start the Verify getting-started emails|iniciar los correos de introducción de Verify|déclencher les e-mails de prise en main de Verify/);
	});

	it.each(LANGS)('%s: the list of account information still names the product signed up for, which is what picks the series', (lang) => {
		const kept: Record<Lang, string> = {
			en: 'the Almstins product you signed up for',
			es: 'el producto de Almstins con el que se dio de alta',
			fr: 'le produit Almstins pour lequel vous vous êtes inscrit',
		};
		expect(bodies[lang]).toContain(kept[lang]);
	});

	it.each(LANGS)('%s: Section 10 still names the provider that sends the series', (lang) => {
		expect(section(bodies[lang], 10)).toContain('<strong>Resend</strong>');
	});

	it.each(LANGS)('%s: the new lines keep the product wording: no em dash, nothing called safe, no payment said to be stopped or blocked', (lang) => {
		const lines = [useThatOpens(lang, WELCOME_OPENS[lang]), useThatOpens(lang, NOTE_OPENS[lang])].join(' ');
		expect(lines).not.toMatch(/[—–]/);
		expect(lines).not.toMatch(/\b(safe|secure|protect|block|seguro|segura|proteg|bloque|sûr|sûre|protég|bloqu)\w*/i);
	});

	it('each language is version 1.8, the version in effect', () => {
		expect(bodies.en).toContain('<strong>Version:</strong> 1.8');
		expect(bodies.es).toContain('<strong>Versión:</strong> 1.8');
		expect(bodies.fr).toContain('<strong>Version :</strong> 1.8');
	});
});
