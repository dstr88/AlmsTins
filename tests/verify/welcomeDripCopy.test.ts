import { describe, it, expect } from 'vitest';
import { verifyWelcomeLocales } from '../../src/i18n/emails/verifyWelcome';
import { renderDrip, type DripLocale } from '../../src/i18n/emails/dripTemplate';
import { verifyScanCopy } from '../../src/i18n/verifyScan';
import { getVerifyDashboard } from '../../src/i18n/dashboard/verify';
import { VERIFY_PLANS } from '../../src/lib/verifyPlans';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * The wording of the Verify welcome series (src/i18n/emails/verifyWelcome.ts), in English,
 * Spanish and French. Pure copy checks: nothing is sent.
 *
 *   - two emails in each language, in the shared template, each with one button to the Verify
 *     dashboard and the unsubscribe link;
 *   - the first carries the founder's question;
 *   - no em dash anywhere in what a person receives;
 *   - Almstins warns and flags: the copy never says it stops, blocks or protects anything, and
 *     calls nothing safe;
 *   - the product facts are the live ones, read from the code that holds them: the Free plan's
 *     numbers, the dashboard's names for the proof and the two marks, and the titles the public
 *     scanner shows a payer.
 */

const LANGS = ['en', 'es', 'fr'] as const;
type Lang = (typeof LANGS)[number];
const APP = 'https://app.example.test';
const UNSUB = `${APP}/api/email/unsubscribe?token=tok-example`;

const locale = (lang: Lang): DripLocale => verifyWelcomeLocales[lang];
const rendered = (lang: Lang, step: number) => renderDrip(locale(lang), step, APP, UNSUB);
/** Everything a person receives for one step: subject, HTML and plain text. */
const received = (lang: Lang, step: number): string => {
  const r = rendered(lang, step);
  return [r.subject, r.html, r.text].join('\n');
};
const body = (lang: Lang, step: number): string => locale(lang).emails[step - 1].paragraphs.join(' ');
const EVERY_EMAIL = LANGS.flatMap((lang) => [1, 2].map((step) => [lang, step] as const));

/** Words the copy must not use about what Almstins does, per language. */
const BANNED: Record<Lang, RegExp[]> = {
  en: [/\b(stop|block|protect|prevent|guarantee|secur)\w*/i, /\bsafe(r|st|ly|ty|guard\w*)?\b/i],
  es: [/\b(deten|detien|detuv|bloque|proteg|protej|protecc|impid|impedi|garanti)\w*/i, /\bsegur\w*/i, /\ba salvo\b/i],
  fr: [/\b(arrêt|bloqu|protég|protèg|protect|empêch|garanti|sécuri)\w*/i, /\bsûre?s?\b/i, /\bà l[’']abri\b/i],
};

describe('the series exists in English, Spanish and French', () => {
  it.each(LANGS)('%s: two emails, each with a subject, a body and one button to the Verify dashboard', (lang) => {
    const loc = locale(lang);
    expect(loc.lang).toBe(lang);
    expect(loc.emails).toHaveLength(2);
    for (const e of loc.emails) {
      expect(e.subject.trim().length).toBeGreaterThan(10);
      expect(e.paragraphs.length).toBeGreaterThanOrEqual(3);
      for (const p of e.paragraphs) expect(p.trim().length).toBeGreaterThan(20);
      expect(e.ctaLabel.trim().length).toBeGreaterThan(5);
      expect(e.ctaPath).toBe('/dashboard/verify');
    }
  });

  it('no language is a copy of another', () => {
    for (const step of [0, 1]) {
      const subjects = LANGS.map((l) => locale(l).emails[step].subject);
      expect(new Set(subjects).size).toBe(3);
      const firsts = LANGS.map((l) => locale(l).emails[step].paragraphs[0]);
      expect(new Set(firsts).size).toBe(3);
    }
  });

  it('the three languages say the same thing in the same number of paragraphs', () => {
    for (const step of [0, 1]) {
      const counts = LANGS.map((l) => locale(l).emails[step].paragraphs.length);
      expect(new Set(counts).size).toBe(1);
    }
  });
});

describe('each email, as a person receives it', () => {
  it.each(EVERY_EMAIL)('%s email %i uses the shared template: one button, the sign-off, the unsubscribe link', (lang, step) => {
    const { html, text, subject } = rendered(lang, step);
    const e = locale(lang).emails[step - 1];
    expect(subject).toBe(e.subject);
    // One button, to the Verify dashboard.
    expect(html.match(/<a href="[^"]*" style="display:inline-block;background:#2dd4a8/g)).toHaveLength(1);
    expect(html).toContain(`<a href="${APP}/dashboard/verify" style="display:inline-block;`);
    expect(html).toContain(`${e.ctaLabel} &rarr;</a>`);
    expect(text).toContain(`${e.ctaLabel}: ${APP}/dashboard/verify`);
    // The unsubscribe link, in both parts.
    expect(html).toContain(`<a href="${UNSUB}"`);
    expect(html).toContain(locale(lang).unsubscribe);
    expect(text).toContain(`${locale(lang).unsubscribe}: ${UNSUB}`);
    // Every paragraph made it into both parts.
    for (const p of e.paragraphs) {
      expect(html).toContain(p);
      expect(text).toContain(p);
    }
    expect(text).toContain(`\n\n${locale(lang).signoff}\n\n`);
  });

  it.each(EVERY_EMAIL)('%s email %i has no em dash (and no en dash)', (lang, step) => {
    expect(received(lang, step)).not.toMatch(/[—–]/);
  });

  it.each(EVERY_EMAIL)('%s email %i never says Almstins stops, blocks or protects anything, and calls nothing safe', (lang, step) => {
    const e = locale(lang).emails[step - 1];
    const words = [e.subject, ...e.paragraphs, e.ctaLabel, locale(lang).signoff, locale(lang).contact, locale(lang).unsubscribe].join(' ');
    for (const pattern of BANNED[lang]) expect(words.match(pattern)?.[0], `${lang} email ${step}`).toBeUndefined();
  });

  it.each([1, 2])('English email %i keeps the wording rules the rest of the product copy is held to', (step) => {
    const e = locale('en').emails[step - 1];
    expect(brightLineViolations([e.subject, ...e.paragraphs, e.ctaLabel].join(' '))).toEqual([]);
  });

  it('the banned-word lists do catch the words', () => {
    expect('Almstins protects your customers'.match(BANNED.en[0])?.[0]).toBe('protects');
    expect('it is safe to pay'.match(BANNED.en[1])?.[0]).toBe('safe');
    expect('Almstins bloquea el pago'.match(BANNED.es[0])?.[0]).toBe('bloquea');
    expect('es seguro pagar'.match(BANNED.es[1])?.[0]).toBe('seguro');
    expect('Almstins protège vos clients'.match(BANNED.fr[0])?.[0]).toBe('protège');
    expect('une adresse sûre'.match(BANNED.fr[1])?.[0]).toBe('sûre');
  });
});

describe('the first email has one job, and the founder\'s question', () => {
  it('asks the question in the founder\'s own words, as its own closing paragraph', () => {
    const last = locale('en').emails[0].paragraphs.at(-1)!;
    expect(last).toContain('What were you hoping to check? Reply to this email. It comes to me.');
  });

  it.each([
    ['es', '¿Qué esperabas comprobar? Responde a este correo. Me llega a mí.'],
    ['fr', 'Que souhaitiez-vous vérifier ? Répondez à cet e-mail. Il m’arrive directement.'],
  ] as const)('%s asks it too, in the closing paragraph', (lang, question) => {
    expect(locale(lang).emails[0].paragraphs.at(-1)).toContain(question);
  });

  it.each(LANGS)('%s: it is short, and signed by the founder with no dash before the name', (lang) => {
    const e = locale(lang).emails[0];
    expect(e.paragraphs).toHaveLength(3);
    expect(e.paragraphs.join(' ').split(/\s+/).length).toBeLessThan(120);
    expect(locale(lang).signoff).toBe('Donnie');
  });

  it('names the one step with the dashboard\'s own words, in each language', () => {
    expect(body('en', 1)).toContain('claim it with the satoshi test (a self-send)');
    expect(body('en', 1)).toContain('you send a tiny, exact amount from the address back to itself');
    expect(body('en', 1)).toContain('you pay only the normal network fee');
    expect(body('en', 1)).toContain('No wallet connection and no signature.');
    expect(body('es', 1)).toContain('la prueba del satoshi (un autoenvío)');
    expect(body('es', 1)).toContain('solo pagas la comisión normal de la red');
    expect(body('fr', 1)).toContain('le test du satoshi (un auto-envoi)');
    expect(body('fr', 1)).toContain('vous ne payez que les frais de réseau habituels');
  });

  it('those are the words the dashboard uses for the same step', () => {
    expect(getVerifyDashboard('en').ssIntro).toContain('Claim this address with the satoshi test (a self-send).');
    expect(getVerifyDashboard('en').ssIntro).toContain('you pay only the normal network fee');
    expect(getVerifyDashboard('es').ssIntro).toContain('la prueba del satoshi (un autoenvío)');
    expect(getVerifyDashboard('es').ssIntro).toContain('solo pagas la comisión normal de la red');
    expect(getVerifyDashboard('fr').ssIntro).toContain('le test du satoshi (un auto-envoi)');
    expect(getVerifyDashboard('fr').ssIntro).toContain('vous ne payez que les frais de réseau habituels');
  });
});

describe('the second email explains the two proofs and what a payer sees', () => {
  it('says what each proof costs and what each earns: Claimed, then Verified', () => {
    const text = body('en', 2);
    expect(text).toContain('The first is the satoshi test (a self-send).');
    expect(text).toContain('It costs only the normal network fee, with no wallet connection and no signature.');
    expect(text).toContain('The address then shows as Claimed.');
    expect(text).toContain('The second is a small file on your own website that lists the address.');
    expect(text).toContain('Almstins charges nothing for it, but you need a website you control.');
    expect(text).toContain('A claimed address then shows as Verified, with your domain beside it.');
    expect(text.indexOf('Claimed.')).toBeLessThan(text.indexOf('Verified,'));
  });

  it.each(LANGS)('%s: the two marks are the ones the dashboard shows in that language', (lang) => {
    const dash = getVerifyDashboard(lang);
    expect(body(lang, 2)).toContain(dash.statusClaimed);
    expect(body(lang, 2)).toContain(dash.statusProven);
  });

  it('the Spanish and French emails name the English marks too, which is what the scanner shows today', () => {
    for (const lang of ['es', 'fr'] as const) {
      expect(body(lang, 2)).toContain('(Claimed)');
      expect(body(lang, 2)).toContain('(Verified)');
    }
    expect(body('es', 2)).toContain('Por ahora, el escáner muestra el resultado en inglés.');
    expect(body('fr', 2)).toContain('Pour l’instant, le scanner affiche le résultat en anglais.');
  });

  it('what a payer sees is quoted from the scanner\'s own result card', () => {
    const scan = verifyScanCopy.en;
    const text = body('en', 2);
    expect(text).toContain(`An address nobody has proven reads "${scan.notVerifiedTitle}".`);
    expect(text).toContain(`A claimed address reads "${scan.claimedTitle.address}", with no name.`);
    expect(text).toContain(`A verified address reads "${scan.verifiedTitle}" and names the website that lists it.`);
    expect(scan.listedOn.address).toBe('Listed on {domain}.');
  });

  it.each(LANGS)('%s: anyone can check at the free scanner, with no account', (lang) => {
    expect(body(lang, 2)).toContain('almstins.com/verify/scan');
  });

  it('states the Free plan as the code enforces it', () => {
    const free = VERIFY_PLANS.free.limits;
    expect([free.address, free.qr]).toEqual([2, 1]);
    expect(body('en', 2)).toContain(`The Free plan holds ${free.address} wallet addresses and ${free.qr} payment QR or link.`);
    expect(body('es', 2)).toContain(`El plan gratuito incluye ${free.address} direcciones de billetera y ${free.qr} QR o enlace de pago.`);
    expect(body('fr', 2)).toContain(`Le forfait gratuit comprend ${free.address} adresses de portefeuille et ${free.qr} QR ou lien de paiement.`);
  });
});

describe('the two Verify series do not repeat each other', () => {
  it('no subject of the welcome series is a subject of the business series, in any language', async () => {
    const { businessLocales } = await import('../../src/i18n/emails/business');
    for (const lang of LANGS) {
      const business = new Set(businessLocales[lang].emails.map((e) => e.subject));
      for (const e of locale(lang).emails) expect(business.has(e.subject), `${lang}: ${e.subject}`).toBe(false);
    }
  });

  it('no paragraph is shared between them either', async () => {
    const { businessLocales } = await import('../../src/i18n/emails/business');
    for (const lang of LANGS) {
      const business = new Set(businessLocales[lang].emails.flatMap((e) => e.paragraphs));
      for (const e of locale(lang).emails) for (const p of e.paragraphs) expect(business.has(p), `${lang}: ${p.slice(0, 40)}`).toBe(false);
    }
  });
});
