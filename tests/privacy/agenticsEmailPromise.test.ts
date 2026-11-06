import { describe, it, expect } from 'vitest';
import { en, es, fr } from '../../src/i18n/privacyPolicy';
import { en as agentics } from '../../src/i18n/agentics';

/**
 * The privacy policy says what email an Agentics signup gets: a welcome email the first time the account
 * opens Agentics, one email on the day the vault opens (for an account that signed up before), and not the
 * getting-started series. That must match what the door promises on the landing page and in the letter
 * itself (src/i18n/agentics.ts) and what the code does (tests/agentics/doorDrip.test.ts,
 * tests/agentics/firstVisit.test.ts, tests/agentics/doorSignup.test.ts). Pure copy checks, all three languages.
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
    expect(sectionFour(bodies.en)).toMatch(/Send you a welcome email the first time you open Almstins Agentics and, if you signed up before the Agent Vault opened to everyone, one email on the day it opens\./);
    expect(sectionFour(bodies.es)).toMatch(/Enviarle un correo de bienvenida la primera vez que abra Almstins Agentics y, si se registró antes de que el Agent Vault se abriera a todos, un correo el día en que se abra\./);
    expect(sectionFour(bodies.fr)).toMatch(/Vous envoyer un e-mail de bienvenue la première fois que vous ouvrez Almstins Agentics et, si vous vous êtes inscrit avant l'ouverture de l'Agent Vault à tous, un e-mail le jour de son ouverture\./);
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

  it('is in version 1.3, which added Agentics (the date is held by agenticsPolicyV13.test.ts)', () => {
    for (const [lang, body] of Object.entries(bodies)) expect(body, lang).toMatch(/<strong>Vers(?:ion|ión) ?:?<\/strong> 1\.3/);
  });
});

describe('the policy names every alert email the Vault sends', () => {
  // src/lib/agentVault/alerts.ts emails an unmatched payment (Nov 6, 2026); Section 3's Agentics line says so.
  it.each([
    ['en', /to email you at once when a transfer out of an agent's wallet is marked as unmatched, at most one email an hour for the same address/],
    ['es', /para escribirle de inmediato cuando una transferencia que sale de la wallet de un agente se marca como sin correspondencia, como máximo un correo por hora para la misma dirección/],
    ['fr', /pour vous écrire aussitôt lorsqu'un transfert sortant du wallet d'un agent est marqué comme sans correspondance, au plus un e-mail par heure pour la même adresse/],
  ] as const)('%s', (lang, line) => {
    expect(bodies[lang]).toMatch(line);
  });
});
