import { describe, it, expect } from 'vitest';
import { en, es, fr } from '../../src/i18n/privacyPolicy';
import { en as agentics } from '../../src/i18n/agentics';

/**
 * The privacy policy says what email an Agentics signup gets: a welcome email, and one email when the
 * vault opens, and not the getting-started series. That must match what the door promises on the
 * landing page and in the letter itself (src/i18n/agentics.ts) and what the code does
 * (tests/agentics/doorDrip.test.ts). Pure copy checks, all three languages.
 */

const bodies = { en: en.body, es: es.body, fr: fr.body };

/** Section 4, How We Use Information, in one language. */
function sectionFour(body: string): string {
  const start = body.indexOf('<h2>4.');
  const end = body.indexOf('<h2>5.');
  expect(start, 'section 4 found').toBeGreaterThan(-1);
  expect(end, 'section 5 found').toBeGreaterThan(start);
  return body.slice(start, end);
}

describe('the Agentics email line in the privacy policy', () => {
  it('is in Section 4, in English, Spanish and French', () => {
    expect(sectionFour(bodies.en)).toMatch(/Send you a welcome email when you create an Almstins Agentics account, and one email when the Almstins Agentics vault opens\./);
    expect(sectionFour(bodies.es)).toMatch(/Enviarle un correo de bienvenida cuando cree una cuenta de Almstins Agentics, y un correo cuando se abra el Vault de Almstins Agentics\./);
    expect(sectionFour(bodies.fr)).toMatch(/Vous envoyer un e-mail de bienvenue lorsque vous créez un compte Almstins Agentics, et un e-mail à l'ouverture du Vault Almstins Agentics\./);
  });

  it('says Agentics-only accounts do not get the getting-started series, in all three languages', () => {
    expect(sectionFour(bodies.en)).toMatch(/Accounts that use only Almstins Agentics do not get the getting-started series\./);
    expect(sectionFour(bodies.es)).toMatch(/Las cuentas que solo usan Almstins Agentics no reciben la serie de correos de introducción\./);
    expect(sectionFour(bodies.fr)).toMatch(/Les comptes qui n'utilisent qu'Almstins Agentics ne reçoivent pas la série d'e-mails de prise en main\./);
  });

  it('is its own line, next to the getting-started line and not inside it', () => {
    for (const [lang, body] of Object.entries(bodies)) {
      const items = [...sectionFour(body).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
      const line = items.filter((t) => /Agentics/.test(t));
      expect(line, lang).toHaveLength(1);
      expect(items.indexOf(line[0]), lang).toBeGreaterThan(0);
    }
  });

  it('matches what the door tells a new account: one more email, when the vault opens, no newsletter', () => {
    expect(agentics.letter.paragraphs.join(' ')).toContain('I will write once, when your vault opens. No newsletter.');
    expect(agentics.landing.finePrint).toContain('We will email you once, when your vault opens.');
    expect(agentics.letter.why).toContain('only email we will send until your vault opens');
  });

  it('leaves the version and date alone: that is a decision for the policy\'s owner', () => {
    expect(bodies.en).toMatch(/October 12, 2026 &nbsp;&middot;&nbsp; <strong>Version:<\/strong> 1\.2/);
  });
});
