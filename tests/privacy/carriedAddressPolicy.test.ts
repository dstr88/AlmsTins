import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as policy from '../../src/i18n/privacyPolicy';
import { CARRY_KEY, CARRY_MAX_AGE_MS } from '../../src/lib/carriedDestination';
import { VERIFY_SIGNIN_HREF } from '../../src/lib/verifyCheckFirst';

/**
 * Privacy Policy v1.8 adds one item to Section 9 (what is kept in the browser): an address or
 * payment link a visitor checked on the public Verify page, kept in that tab's session storage
 * when they press "Prove it's yours, free", so the first screen after sign-in can fill it in
 * (Verify first run, Part D). This file holds each claim of that item to the code it describes,
 * in English, Spanish and French. Pure copy and source checks: no database, no network.
 */
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const LANGS = ['en', 'es', 'fr'] as const;
type Lang = (typeof LANGS)[number];
const bodies: Record<Lang, string> = { en: policy.en.body, es: policy.es.body, fr: policy.fr.body };

function section(body: string, n: number): string {
  const start = body.indexOf(`<h2>${n}.`);
  expect(start, `policy section ${n}`).toBeGreaterThan(-1);
  const next = body.indexOf('<h2>', start + 4);
  return body.slice(start, next === -1 ? undefined : next);
}
const HEAD: Record<Lang, string> = {
  en: '<strong>An address you checked on the Verify page:</strong>',
  es: '<strong>Una dirección que comprobó en la página de Verify:</strong>',
  fr: '<strong>Une adresse que vous avez vérifiée sur la page Verify :</strong>',
};
/** The new list item of Section 9, in one language. */
function item(lang: Lang): string {
  const s9 = section(bodies[lang], 9);
  const start = s9.indexOf(HEAD[lang]);
  expect(start, `${lang}: the new item is in Section 9`).toBeGreaterThan(-1);
  return s9.slice(start, s9.indexOf('</li>', start));
}

describe('Section 9 says what the browser keeps when you check an address on the Verify page', () => {
  it.each(LANGS)('%s: the item sits with the other browser storage, after Preferences and before Analytics', (lang) => {
    const s9 = section(bodies[lang], 9);
    const order = [s9.indexOf('<li>', 0), s9.indexOf(HEAD[lang]), s9.indexOf('Google Analytics')];
    expect(order[1]).toBeGreaterThan(order[0]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(s9.match(/<li>/g)).toHaveLength(4);
  });

  it('says when it is kept: only after the button is pressed', () => {
    expect(item('en')).toContain('if you check an address or payment link in the field on the Almstins Verify page and then press the button to prove it is yours');
    expect(item('es')).toContain('y luego pulsa el botón para demostrar que le pertenece');
    expect(item('fr')).toContain('puis appuyez sur le bouton pour prouver');
    const field = read('src/components/verify/VerifyCheckFirst.tsx');
    expect(field.match(/carryDestination\(/g)).toHaveLength(1);
    expect(field).toContain('onProve={() => { carryDestination(answer.checked); }}');
  });

  it('says where: session storage, for that tab only', () => {
    expect(item('en')).toContain('in its session storage, for that tab only');
    expect(item('es')).toContain('en su almacenamiento de sesión, solo para esa pestaña');
    expect(item('fr')).toContain('dans son stockage de session, pour cet onglet uniquement');
    const src = read('src/lib/carriedDestination.ts');
    expect(src).toContain('window.sessionStorage');
    expect(src.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/localStorage|document\.cookie/);
    expect(CARRY_KEY).toBe('almstins.verify.checked');
  });

  it('says it is never in a web address, and that keeping it sends nothing to our servers', () => {
    expect(item('en')).toContain('It is never put in a web address, and keeping it sends nothing to our servers; nothing is stored in an account until you register it there.');
    expect(item('es')).toContain('Nunca se pone en una dirección web, y conservarlo no envía nada a nuestros servidores; nada se guarda en una cuenta hasta que usted lo registre allí.');
    expect(item('fr')).toContain("Il n'est jamais placé dans une adresse web, et le conserver n'envoie rien à nos serveurs ; rien n'est enregistré dans un compte tant que vous ne l'y avez pas enregistré.");
    // The link the button follows is fixed, and the carry file makes no request.
    expect(VERIFY_SIGNIN_HREF).toBe('/verify/login?next=/dashboard/verify');
    const src = read('src/lib/carriedDestination.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|location|\bimport\b/);
    // The first-run card registers only when its button is pressed.
    expect(read('src/components/verify/FirstRunCard.tsx')).not.toMatch(/useEffect/);
  });

  it('says when it is removed, as the code removes it', () => {
    expect(item('en')).toContain('Your browser removes it as soon as that first screen has read it, when you return to the Verify page or check something else there, and when you close the tab; a copy more than one hour old is thrown away without being used.');
    expect(item('es')).toContain('Su navegador lo elimina en cuanto esa primera pantalla lo ha leído, cuando usted vuelve a la página de Verify o comprueba otra cosa allí, y cuando cierra la pestaña; una copia de más de una hora se descarta sin usarse.');
    expect(item('fr')).toContain("Votre navigateur le supprime dès que ce premier écran l'a lu, lorsque vous revenez sur la page Verify ou y vérifiez autre chose, et lorsque vous fermez l'onglet ; une copie de plus d'une heure est écartée sans être utilisée.");

    expect(CARRY_MAX_AGE_MS).toBe(60 * 60 * 1000);
    // Read and removed in one step by the dashboard, whoever the account is.
    const take = read('src/lib/carriedDestination.ts');
    const body = take.slice(take.indexOf('export function takeCarriedDestination'), take.indexOf('export function clearCarriedDestination'));
    expect(body.indexOf('store.removeItem(CARRY_KEY)')).toBeGreaterThan(body.indexOf('store.getItem(CARRY_KEY)'));
    expect(body.indexOf('store.removeItem(CARRY_KEY)')).toBeLessThan(body.indexOf('JSON.parse'));
    expect(read('src/components/verify/VerifyDashboard.tsx')).toContain('const checked = takeCarriedDestination();');
    // Returning to the Verify page (a fresh load, or the browser's back button) and a new check both clear it.
    const field = read('src/components/verify/VerifyCheckFirst.tsx');
    expect(field).toContain('clearCarriedDestination();');
    expect(field).toContain("window.addEventListener('pageshow', onShow);");
  });

  it('points to the sections that cover the check itself', () => {
    expect(item('en')).toContain('The check in that field is a public check like any other: Sections 3.2, 5 and 10 say what our logs keep, what the answer shows, and which services receive the address or link.');
    expect(item('es')).toContain('las Secciones 3.2, 5 y 10 indican');
    expect(item('fr')).toContain('les Sections 3.2, 5 et 10 indiquent');
    // The field makes no request of its own: it runs the scanner's check.
    expect(read('src/components/verify/VerifyCheckFirst.tsx').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\bfetch\(|\/api\//);
    expect(section(bodies.en, 3)).toContain('Our logs of checks run on the public checkers keep your country and salted one-way hashes of your IP address and of the address or domain checked.');
    expect(section(bodies.en, 10)).toContain('receive the address or link being checked');
  });

  it.each(LANGS)('%s: no em dash, and nothing that says Almstins stops, blocks or protects', (lang) => {
    const words = item(lang).replace(/<[^>]+>/g, ' ');
    expect(words).not.toMatch(/[—–]/);
    expect(words).not.toMatch(/\b(safe|secure|protect|block|seguro|segura|proteg|bloque|sûr|sûre|protég|bloqu)\w*/i);
  });

  it('each language is version 1.8, the version in effect', () => {
    expect(bodies.en).toContain('<strong>Effective Date:</strong> November 20, 2026 &nbsp;&middot;&nbsp; <strong>Version:</strong> 1.8');
    expect(bodies.es).toContain('<strong>Fecha de Vigencia:</strong> 20 de noviembre de 2026 &nbsp;&middot;&nbsp; <strong>Versión:</strong> 1.8');
    expect(bodies.fr).toContain("<strong>Date d'entrée en vigueur :</strong> 20 novembre 2026 &nbsp;&middot;&nbsp; <strong>Version :</strong> 1.8");
  });
});
