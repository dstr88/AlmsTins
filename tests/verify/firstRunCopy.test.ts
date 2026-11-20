import { describe, it, expect } from 'vitest';
import { en, es, fr, getVerifyDashboard, type VerifyDashboardLocale } from '../../src/i18n/dashboard/verify';
import { verifyWelcomeLocales } from '../../src/i18n/emails/verifyWelcome';
import { verifyScanCopy } from '../../src/i18n/verifyScan';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * Verify first run, Part C: the words of the first-run card and the proving guide
 * (src/i18n/dashboard/verify.ts), in English, Spanish and French. Pure copy checks.
 *
 *   - every new string exists in all three languages, and no language is a copy of another;
 *   - no em dash (and no en dash) in any of them;
 *   - Almstins warns and flags: nothing says it stops, blocks or protects anything, and nothing
 *     is called safe;
 *   - the same {tokens} in every language, so nothing prints a raw token;
 *   - the product facts are the live ones: the proof and the two marks are the dashboard's own
 *     words, the payer's view is the public scanner's own title, and the screen does not
 *     contradict the two welcome emails;
 *   - the how-to line that said an address "flips to Verified" after the self-send now says what
 *     it becomes: Claimed.
 */

const LOCALES: Record<'en' | 'es' | 'fr', VerifyDashboardLocale> = { en, es, fr };
const LANGS = ['en', 'es', 'fr'] as const;
type Lang = (typeof LANGS)[number];

/** Every string Part C added: the first-run card ("first…") and the proving guide ("guide…"). */
const NEW_KEYS = (Object.keys(en) as (keyof VerifyDashboardLocale)[])
  .filter((k) => /^(first|guide)[A-Z]/.test(k));

/** The same lists tests/verify/welcomeDripCopy.test.ts holds the welcome emails to. */
const BANNED: Record<Lang, RegExp[]> = {
  en: [/\b(stop|block|protect|prevent|guarantee|secur)\w*/i, /\bsafe(r|st|ly|ty|guard\w*)?\b/i],
  es: [/\b(deten|detien|detuv|bloque|proteg|protej|protecc|impid|impedi|garanti)\w*/i, /\bsegur\w*/i, /\ba salvo\b/i],
  fr: [/\b(arrêt|bloqu|protég|protèg|protect|empêch|garanti|sécuri)\w*/i, /\bsûre?s?\b/i, /\bà l[’']abri\b/i],
};
const tokens = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
const str = (lang: Lang, key: keyof VerifyDashboardLocale) => String(LOCALES[lang][key]);

describe('every new string exists in English, Spanish and French', () => {
  it('the set of new strings is the one this test knows', () => {
    expect(NEW_KEYS).toEqual([
      'firstStepsAria', 'firstStepRegister', 'firstStepRegisterBody', 'firstStepProve', 'firstStepProveBody',
      'firstStepShare', 'firstStepShareBody', 'firstCardTitle', 'firstFieldLabel', 'firstFieldPlaceholder',
      'firstFieldHelp', 'firstReadAddress', 'firstReadNetworks', 'firstReadLink', 'firstReadCode',
      'firstReadUnknown', 'firstChooseNetwork', 'firstChooseKind', 'firstOptionAddress', 'firstOptionQr',
      'firstNote', 'guideAddressTitle', 'guideClaimTitle', 'guideClaimBody', 'guideClaimCost', 'guideClaimEarns',
      'guideClaimBtn', 'guideListTitle', 'guideListBody', 'guideListCost', 'guideListEarns', 'guideListBtn',
      'guideOrderNote', 'guideStepDone', 'guideQrTitleLink', 'guideQrTitleCode', 'guideQrNow', 'guideQrPayer',
    ]);
  });

  it.each(LANGS)('%s has every one, as a non-empty string', (lang) => {
    expect(getVerifyDashboard(lang)).toBe(LOCALES[lang]);
    for (const key of NEW_KEYS) {
      expect(typeof LOCALES[lang][key], `${lang}.${key}`).toBe('string');
      expect(str(lang, key).trim().length, `${lang}.${key}`).toBeGreaterThan(2);
    }
  });

  it('no language is a copy of another', () => {
    for (const key of NEW_KEYS) {
      const versions = new Set(LANGS.map((l) => str(l, key)));
      expect(versions.size, String(key)).toBe(3);
    }
  });

  it('the same tokens in every language', () => {
    for (const key of NEW_KEYS) {
      expect(tokens(str('es', key)), `es.${key}`).toEqual(tokens(str('en', key)));
      expect(tokens(str('fr', key)), `fr.${key}`).toEqual(tokens(str('en', key)));
    }
  });
});

describe('the wording rules', () => {
  const EVERY = LANGS.flatMap((lang) => NEW_KEYS.map((key) => [lang, key] as const));

  it.each(EVERY)('%s.%s has no em dash and no en dash', (lang, key) => {
    expect(str(lang, key)).not.toMatch(/[—–]/);
  });

  it.each(EVERY)('%s.%s never says Almstins stops, blocks or protects anything, and calls nothing safe', (lang, key) => {
    for (const pattern of BANNED[lang]) expect(str(lang, key).match(pattern)?.[0], `${lang}.${key}`).toBeUndefined();
  });

  it('the English keeps the wording rules the rest of the product copy is held to', () => {
    expect(brightLineViolations(NEW_KEYS.map((k) => str('en', k)).join(' '))).toEqual([]);
  });

  it('the banned-word lists do catch the words', () => {
    expect('Almstins blocks the payment'.match(BANNED.en[0])?.[0]).toBe('blocks');
    expect('a safe address'.match(BANNED.en[1])?.[0]).toBe('safe');
    expect('Almstins protege tu dirección'.match(BANNED.es[0])?.[0]).toBe('protege');
    expect('une adresse sûre'.match(BANNED.fr[1])?.[0]).toBe('sûre');
  });
});

describe('the screen describes what is live, in the dashboard’s own words', () => {
  it('the card is worded for any business, with one sentence', () => {
    expect(en.firstCardTitle).toBe('Register the address you ask people to pay');
    expect(en.firstCardTitle).not.toMatch(/[.!?]/); // one sentence, as a heading
    for (const lang of LANGS) expect(str(lang, 'firstCardTitle')).not.toMatch(/\bQR\b/);
  });

  it('the three steps are register, prove, share', () => {
    expect([en.firstStepRegister, en.firstStepProve, en.firstStepShare]).toEqual(['Register', 'Prove', 'Share']);
    // "Share" is the QR badge on a proven address's row and the free scanner, both live.
    expect(en.firstStepShareBody).toContain('QR badge');
    expect(en.firstStepShareBody).toContain('free scanner');
    expect(en.firstStepShareBody).toContain('no account');
  });

  it.each([
    ['en', 'the satoshi test (a self-send)'],
    ['es', 'la prueba del satoshi (un autoenvío)'],
    ['fr', 'le test du satoshi (un auto-envoi)'],
  ] as const)('%s: step 1 of the guide uses the proving panel’s own name for the test', (lang, name) => {
    const t = LOCALES[lang];
    expect(t.ssIntro).toContain(name); // what the panel the button opens calls it
    expect(t.guideClaimTitle).toContain(name);
  });

  it.each(LANGS)('%s: the marks are tokens filled from the badge labels, never retyped', (lang) => {
    const t = LOCALES[lang];
    expect(t.guideClaimEarns).toContain('{status}');
    expect(t.guideListEarns).toContain('{status}');
    for (const key of ['guideClaimEarns', 'guideListEarns', 'guideOrderNote'] as const) {
      expect(t[key]).not.toContain(t.statusClaimed);
      expect(t[key]).not.toContain(t.statusProven);
      expect(t[key]).not.toContain(t.statusLapsed);
    }
  });

  it('each step says what it costs: the network fee, and nothing from Almstins', () => {
    expect(en.guideClaimCost).toBe('Costs: the normal network fee.');
    expect(en.guideListCost).toBe('Costs: nothing from Almstins. You need a website you control.');
  });

  it.each(LANGS)('%s: the payer’s view of an unproven link is the public scanner’s own title', (lang) => {
    // /verify/scan renders in English today, so every language quotes the English title.
    expect(str(lang, 'guideQrPayer')).toContain(verifyScanCopy.en.notVerifiedTitle);
  });

  it('agrees with the two welcome emails', () => {
    const [first, second] = verifyWelcomeLocales.en.emails;
    const said = [...first.paragraphs, ...second.paragraphs].join(' ');
    // The same name for the test, the same two marks, the same promise about the wallet.
    expect(said).toContain('the satoshi test (a self-send)');
    expect(en.guideClaimTitle).toContain('the satoshi test (a self-send)');
    expect(said).toContain('No wallet connection and no signature.');
    expect(en.guideClaimBody).toContain('No wallet connection and no signature.');
    expect(said).toContain('The address then shows as Claimed.');
    expect(said).toContain('shows as Verified, with your domain beside it.');
    expect(en.statusClaimed).toBe('Claimed');
    expect(en.statusProven).toBe('Verified');
    expect(said).toContain('the address you ask people to pay');
    expect(en.firstCardTitle).toContain('the address you ask people to pay');
    expect(said).toContain('you need a website you control');
    expect(en.guideListCost).toContain('You need a website you control.');
  });
});

describe('the how-to line no longer says a self-send makes an address Verified', () => {
  const line = (lang: Lang) => LOCALES[lang].howToWalletSteps[3];

  it('English: the address shows as Claimed', () => {
    expect(line('en')).toBe('Once we see it, the address shows as Claimed and is locked to your account: claimed once, so no one else can list it as theirs.');
  });

  it.each(LANGS)('%s: it names the dashboard’s own Claimed badge, not the Verified one', (lang) => {
    const t = LOCALES[lang];
    expect(line(lang)).toContain(t.statusClaimed);
    expect(line(lang)).not.toMatch(/Verified|Verificad|Vérifié/);
    expect(line(lang)).not.toMatch(/flips to|pasa a|passe à/);
    expect(line(lang)).not.toMatch(/[—–]/);
  });

  it.each(LANGS)('%s: the demo’s prove note says the same', (lang) => {
    const t = LOCALES[lang];
    expect(t.demoProveNote).toContain(t.statusClaimed);
    expect(t.demoProveNote).not.toMatch(/is Verified|queda Verificada|est Vérifiée/);
  });

  it('the Spanish word for Claimed is left as it was on the dashboard', () => {
    expect(es.statusClaimed).toBe('Control confirmado');
    expect(fr.statusClaimed).toBe('Contrôle confirmé');
  });
});
