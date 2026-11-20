import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { copy, type VerifyCopy } from '../../src/i18n/verify';
import { verifyScanCopy } from '../../src/i18n/verifyScan';
import { en as dashEn, getVerifyDashboard } from '../../src/i18n/dashboard/verify';
import { verifyWelcomeLocales } from '../../src/i18n/emails/verifyWelcome';
import { VERIFY_PLANS } from '../../src/lib/verifyPlans';
import { ownerNextStep, VERIFY_SIGNIN_HREF } from '../../src/lib/verifyCheckFirst';
import { runScanCheck, scanValueKind, type ScanCheckResult, type ScanLookup, type ScanSafety } from '../../src/lib/verifyScanCheck';
import {
  CARRY_KEY, CARRY_MAX_AGE_MS, CARRY_MAX_LENGTH,
  carryDestination, clearCarriedDestination, takeCarriedDestination, type CarryStore,
} from '../../src/lib/carriedDestination';
import { isVerifyFirstRun } from '../../src/lib/verifyFirstRun';
import { brightLineViolations } from '../helpers/brightLineWording';

/**
 * Verify first run, Part D: a business owner checks the address they ask people to pay on the
 * public Verify page, sees what a payer sees, and is offered one action when nobody has proven
 * it. After sign-in, the first-run card already holds what they checked.
 *
 * What these pin:
 *   - the field uses the public scanner's check and cards, not a second implementation;
 *   - an unproven value gets the scanner's answer, said plainly, and exactly one action;
 *   - a claimed, verified or disputed value gets the scanner's normal answer and no invitation;
 *   - what was checked is carried in the browser only: never in a link, never sent anywhere by
 *     the carry step, removed when read, and gone after an hour;
 *   - the first-run card starts with it, and only that card;
 *   - the new words exist in English, Spanish and French, with no em dash, none of the banned
 *     words, and nothing that calls an unproven address unsafe.
 *
 * Rendered to markup with no browser and no network (as publicCardRender.test.ts does: the unit
 * config compiles JSX with the classic runtime, so React is a global before the components are
 * imported). Every address, link and domain here is made up.
 */

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const LANGS = ['en', 'es', 'fr'] as const;
type Lang = (typeof LANGS)[number];
type CheckFirst = VerifyCopy['checkFirst'];
const T: Record<Lang, CheckFirst> = { en: copy.en.checkFirst, es: copy.es.checkFirst, fr: copy.fr.checkFirst };

const ADDRESS = `bc1q${'qpzry9x8gf2tvdw0s3jn54khce6mua7l'}`;
const EVM = `0x${'ab12'.repeat(10)}`;
const LINK = 'https://buy.example.com/test_made_up_123';
const PIX = '00020126580014br.gov.bcb.pix0136made-up-key-for-a-test5204000053039865802BR6304ABCD';

const lookup = (over: Partial<ScanLookup> = {}): ScanLookup => ({
  verified: false, level: null, since: null, source: null, domain: null, provingDomain: null, label: null, ...over,
});
const result = (over: Partial<ScanCheckResult> = {}): ScanCheckResult => ({
  lookup: lookup(), lookupAnswered: true, safety: 'clean', goplus: false, ...over,
});
const CLAIMED = lookup({ verified: true, level: 'claimed', since: '2026-09-01', source: 'merchant' });
const VERIFIED = lookup({
  verified: true, level: 'verified', since: '2026-09-01', source: 'merchant',
  domain: 'acme-coffee.example', provingDomain: 'acme-coffee.example',
});
const DISPUTED = lookup({ level: 'disputed' });

let Result: (p: any) => React.ReactElement;
let Field: (p: any) => React.ReactElement;
let DashboardView: (p: any) => React.ReactElement;
let Card: (p: any) => React.ReactElement;
beforeAll(async () => {
  (globalThis as any).React = React;
  const island = await import('../../src/components/verify/VerifyCheckFirst');
  Result = island.CheckFirstResult as any;
  Field = island.default as any;
  DashboardView = (await import('../../src/components/verify/VerifyDashboard')).VerifyDashboardView as any;
  Card = (await import('../../src/components/verify/FirstRunCard')).FirstRunCard as any;
});

/** The answer a visitor sees for a finished check, as markup. */
const answer = (checked: string, res: ScanCheckResult, lang: Lang = 'en') =>
  renderToStaticMarkup(React.createElement(Result, {
    answer: { checked, result: res }, t: T[lang], scan: verifyScanCopy[lang], onProve: () => {},
  }));
/** Text as a person reads it: tags dropped, entities decoded. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const fill = (s: string, values: Record<string, string>) => s.replace(/\{(\w+)\}/g, (w, k) => values[k] ?? w);

/** A fetch that answers from a table and records every request it was asked to make. */
function fakeFetch(answers: Record<string, unknown>) {
  const calls: { path: string; url: string; method: string; body: string | null }[] = [];
  const impl = async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const p = url.split('?')[0];
    calls.push({ path: p, url, method: init?.method ?? 'GET', body: init?.body ?? null });
    if (!(p in answers)) throw new Error('offline');
    return { json: async () => answers[p] };
  };
  return { impl: impl as unknown as typeof fetch, calls };
}
const MISS = { ok: true, verified: false, level: null, since: null, source: null, domain: null, provingDomain: null, label: null, chain: null };
const CLEAN_WALLET = { ok: true, result: { scamLevel: 'safe', chainabuseReports: 0, partialCoverage: false, coverage: { goplus: 'ran' } } };

/** A session storage stand-in that records what was written to it. */
function fakeStore() {
  const data = new Map<string, string>();
  const writes: string[] = [];
  const store: CarryStore = {
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => { writes.push(k); data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
  return { store, data, writes };
}
const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

// ─────────────────────────────────────────────────────────────────────────────

describe('one check: the field runs the public scanner’s own', () => {
  it('the scanner and the field both call runScanCheck, and neither asks the lookup itself', () => {
    const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '');
    const scanner = code('src/components/verify/VerifyScan.tsx');
    const field = code('src/components/verify/VerifyCheckFirst.tsx');
    for (const src of [scanner, field]) {
      expect(src).toMatch(/import \{[^}]*\brunScanCheck\b[^}]*\} from '\.\.\/\.\.\/lib\/verifyScanCheck';/);
      expect(src).toContain('await runScanCheck(q)');
      expect(src).not.toMatch(/\/api\/(verify\/lookup|wallet-check|dapp-check)/);
      expect(src).not.toMatch(/\bfetch\(/);
    }
  });

  it('both render the same two cards, with the scanner’s words', () => {
    const field = read('src/components/verify/VerifyCheckFirst.tsx');
    expect(field).toContain("import { ScanVerifyCard, SafetyCard, safetySentence } from './ScanResultCards';");
    expect(field).toContain("from '../../i18n/verifyScan'");
    expect(read('src/components/verify/VerifyScan.tsx')).toContain("import { ScanVerifyCard, SafetyCard, safetySentence } from './ScanResultCards';");
  });

  it('the field does not load the camera QR reader', () => {
    for (const file of ['VerifyCheckFirst.tsx', 'ScanResultCards.tsx']) {
      expect(read(`src/components/verify/${file}`)).not.toMatch(/qrScan|jsqr|getUserMedia/i);
    }
    expect(read('src/lib/verifyScanCheck.ts')).not.toMatch(/qrScan|jsqr/i);
  });

  it('a wallet address: the lookup and the address screen, and nothing else', async () => {
    const f = fakeFetch({ '/api/verify/lookup': MISS, '/api/wallet-check': CLEAN_WALLET });
    const res = await runScanCheck(`  ${ADDRESS} `, f.impl);
    expect(res).toEqual({ lookup: lookup(), lookupAnswered: true, safety: 'clean', goplus: true });
    expect(f.calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual(['GET /api/verify/lookup', 'POST /api/wallet-check']);
    expect(f.calls.find((c) => c.method === 'POST')!.body).toBe(JSON.stringify({ address: ADDRESS }));
  });

  it('a payment link goes to the site checker; a payment code gets no screen at all', async () => {
    const link = fakeFetch({ '/api/verify/lookup': MISS, '/api/dapp-check': { verdict: 'green', sources: [] } });
    expect((await runScanCheck(LINK, link.impl)).safety).toBe('clean');
    expect(link.calls.map((c) => c.path).sort()).toEqual(['/api/dapp-check', '/api/verify/lookup']);

    const code = fakeFetch({ '/api/verify/lookup': MISS });
    expect(await runScanCheck(PIX, code.impl)).toEqual({ lookup: lookup(), lookupAnswered: true, safety: 'idle', goplus: false });
    expect(code.calls.map((c) => c.path)).toEqual(['/api/verify/lookup']);
    expect(scanValueKind(PIX).noun).toBe('code');
    expect(scanValueKind(LINK).noun).toBe('link');
    expect(scanValueKind(ADDRESS).noun).toBe('address');
  });

  it('a hit comes back as the lookup sent it', async () => {
    const f = fakeFetch({
      '/api/verify/lookup': { ok: true, verified: true, level: 'claimed', since: '2026-09-01', source: 'merchant', domain: null, provingDomain: null, label: null },
      '/api/wallet-check': CLEAN_WALLET,
    });
    const res = await runScanCheck(ADDRESS, f.impl);
    expect(res.lookupAnswered).toBe(true);
    expect(res.lookup).toEqual(CLAIMED);
  });

  it('says when the lookup did not answer: a refused value, and a request that failed', async () => {
    const refused = fakeFetch({ '/api/verify/lookup': { ok: false, error: 'Invalid address format' }, '/api/wallet-check': { ok: false } });
    const a = await runScanCheck('not an address', refused.impl);
    expect(a.lookupAnswered).toBe(false);
    expect(a.lookup.level).toBeNull();

    const offline = fakeFetch({});
    const b = await runScanCheck(ADDRESS, offline.impl);
    expect(b).toEqual({ lookup: lookup(), lookupAnswered: false, safety: 'error', goplus: false });
  });
});

describe('when the page may offer the action', () => {
  it('only when the lookup answered and nobody has proven the value', () => {
    expect(ownerNextStep(result())).toBe('prove');
  });

  it.each([
    ['claimed', CLAIMED], ['verified', VERIFIED], ['disputed', DISPUTED],
  ] as const)('never for a %s value', (_name, l) => {
    expect(ownerNextStep(result({ lookup: l }))).toBe('none');
  });

  it('never when the lookup did not answer, whatever it would have said', () => {
    expect(ownerNextStep(result({ lookupAnswered: false }))).toBe('none');
  });
});

describe('an address nobody has proven: said plainly, with one action', () => {
  it('shows the scanner’s own answer for it', () => {
    const shown = text(answer(ADDRESS, result()));
    expect(shown).toContain(T.en.resultLabel);
    expect(shown).toContain(verifyScanCopy.en.notVerifiedTitle);
    expect(shown).toContain(verifyScanCopy.en.notVerifiedBody.address);
    expect(shown).toContain(verifyScanCopy.en.safetyClean.address);
  });

  it('says nobody has proven it, and offers "Prove it’s yours, free"', () => {
    const html = answer(ADDRESS, result());
    expect(text(html)).toContain('Nobody has proven this address with Almstins yet.');
    expect(T.en.proveCta).toBe('Prove it’s yours, free');
    expect(html).toContain(`<a class="vcf__prove" href="${VERIFY_SIGNIN_HREF}">${T.en.proveCta}</a>`);
  });

  it('the action is the only one: one link, no button', () => {
    const html = answer(ADDRESS, result());
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).not.toContain('<button');
  });

  it('leads to the Verify sign-in, by a link that is the same for every visitor', () => {
    expect(VERIFY_SIGNIN_HREF).toBe('/verify/login?next=/dashboard/verify');
    for (const checked of [ADDRESS, EVM, LINK, PIX]) {
      const html = answer(checked, result({ safety: scanValueKind(checked).isPaymentQr ? 'idle' : 'clean' }));
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
      expect(hrefs).toEqual([VERIFY_SIGNIN_HREF]);
    }
  });

  it('says what proving takes and what a payer then sees, in the scanner’s own titles', () => {
    const shown = text(answer(ADDRESS, result()));
    expect(shown).toContain('the satoshi test (a self-send)');
    expect(shown).toContain('you pay only the normal network fee, with no wallet connection and no signature');
    expect(shown).toContain(`A payer then sees “${verifyScanCopy.en.claimedTitle.address}”.`);
    expect(shown).toContain(`a payer sees “${verifyScanCopy.en.verifiedTitle}”, with your domain beside it.`);
    expect(shown).not.toMatch(/\{\w+\}/);
  });

  it('states the Free plan as the code enforces it', () => {
    const free = VERIFY_PLANS.free.limits;
    expect([free.address, free.qr]).toEqual([2, 1]);
    expect(text(answer(ADDRESS, result()))).toContain('The Free plan holds 2 wallet addresses and 1 payment QR or link.');
  });

  it('says where the checked value goes if the visitor continues', () => {
    expect(text(answer(ADDRESS, result()))).toContain(T.en.carryNote);
    expect(T.en.carryNote).toMatch(/in this tab only/);
    expect(T.en.carryNote).toMatch(/not put in a link/);
  });

  it('a payment link or code is not promised the satoshi test', () => {
    for (const [checked, noun] of [[LINK, 'link'], [PIX, 'code']] as const) {
      const shown = text(answer(checked, result({ safety: noun === 'code' ? 'idle' : 'clean' })));
      expect(shown).toContain(T.en.unproven[noun]);
      expect(shown).not.toMatch(/satoshi/i);
      expect(shown).toContain(`a payer keeps seeing “${verifyScanCopy.en.notVerifiedTitle}” until your account has proven a website domain`);
    }
    // A payment code has no safety screen, on the scanner or here.
    expect(answer(PIX, result({ safety: 'idle' }))).not.toContain(verifyScanCopy.en.safetyTitle);
  });

  it('when the safety screen flagged it, the warning leads and proving is not said to remove it', () => {
    const html = answer(ADDRESS, result({ safety: 'danger' }));
    expect(html.indexOf(verifyScanCopy.en.safetyTitle)).toBeLessThan(html.indexOf(verifyScanCopy.en.notVerifiedTitle));
    expect(text(html)).toContain(T.en.proveFlagged);
    expect(text(answer(ADDRESS, result()))).not.toContain(T.en.proveFlagged);
  });
});

describe('a value an account already holds: the scanner’s normal answer, and no invitation', () => {
  const cases = [
    ['claimed', CLAIMED, verifyScanCopy.en.claimedTitle.address],
    ['verified', VERIFIED, verifyScanCopy.en.verifiedTitle],
    ['disputed', DISPUTED, verifyScanCopy.en.disputedTitle.address],
  ] as const;

  it.each(cases)('%s: shows the scanner’s card', (_name, l, title) => {
    expect(text(answer(ADDRESS, result({ lookup: l })))).toContain(title);
  });

  it.each(cases)('%s: no action, no sign-in link, no word about proving it', (_name, l) => {
    const html = answer(ADDRESS, result({ lookup: l }));
    expect(html).not.toContain('vcf__next');
    expect(html).not.toContain('vcf__prove');
    expect(html).not.toContain(VERIFY_SIGNIN_HREF);
    expect(html).not.toContain('<a');
    const shown = text(html);
    for (const words of [T.en.proveCta, T.en.unproven.address, T.en.carryNote, T.en.freePlan.split('{')[0]]) {
      expect(shown).not.toContain(words);
    }
  });

  it('a verified value names the website that lists it, as on the scanner', () => {
    expect(text(answer(ADDRESS, result({ lookup: VERIFIED })))).toContain('Listed on acme-coffee.example.');
  });

  it('a claimed value is not invited even when the safety screen flagged it', () => {
    expect(answer(ADDRESS, result({ lookup: CLAIMED, safety: 'danger' }))).not.toContain('vcf__next');
  });
});

describe('a value the lookup could not answer for', () => {
  it('says it could not be checked, shows no card and offers nothing', () => {
    const html = answer('not an address', result({ lookupAnswered: false, safety: 'error' }));
    expect(text(html)).toContain(T.en.couldNotCheck);
    expect(html).not.toContain('vs__card');
    expect(html).not.toContain(verifyScanCopy.en.notVerifiedTitle);
    expect(html).not.toContain('<a');
  });
});

describe('the field itself', () => {
  it('is the sentence, one field and one button, with nothing checked yet', () => {
    const html = renderToStaticMarkup(React.createElement(Field, { lang: 'en', t: T.en }));
    expect(T.en.title).toBe('Paste the address you ask people to pay. See what a payer sees today.');
    expect(html).toContain(`<h2 id="vcf-title" class="vcf__title">${T.en.title}</h2>`);
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(`placeholder="${T.en.placeholder}"`);
    expect(html).toContain(`>${T.en.button}</button>`);
    expect(html).not.toContain('vcf__result');
    expect(html).not.toContain('<a');
  });

  it('takes a payment link too, and says so', () => {
    expect(T.en.placeholder).toBe('Wallet address or payment link');
    expect(T.en.fieldLabel).toMatch(/wallet address or payment link/);
  });

  it('sits near the top of the public Verify page, above the tools, in the page’s language', () => {
    const page = read('src/components/VerifyPage.astro');
    const at = page.indexOf('<VerifyCheckFirst client:load lang={lang} t={t.checkFirst} />');
    expect(at).toBeGreaterThan(page.indexOf('</header>'));
    expect(at).toBeLessThan(page.indexOf('class="vsection vtools"'));
    for (const file of ['src/pages/verify.astro', 'src/pages/verify/es.astro', 'src/pages/verify/fr.astro']) {
      expect(read(file)).toMatch(/<VerifyPage lang="(en|es|fr)" \/>/);
    }
  });
});

describe('what was checked is carried in the browser only', () => {
  it('pressing the action writes one value to the tab’s storage, and nothing else', () => {
    const { store, data, writes } = fakeStore();
    expect(carryDestination(`  ${ADDRESS}  `, store, NOW)).toBe(true);
    expect(writes).toEqual([CARRY_KEY]);
    expect([...data.keys()]).toEqual([CARRY_KEY]);
    expect(JSON.parse(data.get(CARRY_KEY)!)).toEqual({ v: ADDRESS, t: NOW });
  });

  it('the first screen reads it once, and it is gone from the browser', () => {
    const { store, data } = fakeStore();
    carryDestination(ADDRESS, store, NOW);
    expect(takeCarriedDestination(store, NOW + 60_000)).toBe(ADDRESS);
    expect(data.size).toBe(0);
    expect(takeCarriedDestination(store, NOW + 60_000)).toBeNull();
  });

  it('carries a payment link and a payment code as they were checked', () => {
    for (const value of [LINK, PIX, EVM]) {
      const { store } = fakeStore();
      carryDestination(value, store, NOW);
      expect(takeCarriedDestination(store, NOW)).toBe(value);
    }
  });

  it('a new check replaces the old value: there is only ever one', () => {
    const { store, data } = fakeStore();
    carryDestination(ADDRESS, store, NOW);
    carryDestination(LINK, store, NOW + 1);
    expect(data.size).toBe(1);
    expect(takeCarriedDestination(store, NOW + 2)).toBe(LINK);
  });

  it('is gone after an hour, and is removed even then', () => {
    expect(CARRY_MAX_AGE_MS).toBe(60 * 60 * 1000);
    const { store, data } = fakeStore();
    carryDestination(ADDRESS, store, NOW);
    expect(takeCarriedDestination(store, NOW + CARRY_MAX_AGE_MS + 1)).toBeNull();
    expect(data.size).toBe(0);

    const fresh = fakeStore();
    carryDestination(ADDRESS, fresh.store, NOW);
    expect(takeCarriedDestination(fresh.store, NOW + CARRY_MAX_AGE_MS)).toBe(ADDRESS);
  });

  it('the visitor can drop it: clearing removes it unread', () => {
    const { store, data } = fakeStore();
    carryDestination(ADDRESS, store, NOW);
    clearCarriedDestination(store);
    expect(data.size).toBe(0);
    expect(takeCarriedDestination(store, NOW)).toBeNull();
  });

  it('coming back to the Verify page, or checking something else there, drops it', () => {
    const field = read('src/components/verify/VerifyCheckFirst.tsx');
    expect(field).toContain('useEffect(() => { clearCarriedDestination(); }, []);');
    const check = field.slice(field.indexOf('async function check()'), field.indexOf('return (', field.indexOf('async function check()')));
    expect(check.indexOf('clearCarriedDestination();')).toBeGreaterThan(-1);
    expect(check.indexOf('clearCarriedDestination();')).toBeLessThan(check.indexOf('await runScanCheck(q)'));
  });

  it('keeps nothing it would not have written itself', () => {
    const junk = ['', 'not json', '{}', 'null', '[]', JSON.stringify({ v: ADDRESS }), JSON.stringify({ v: 42, t: NOW }),
      JSON.stringify({ v: ADDRESS, t: 'yesterday' }), JSON.stringify({ v: `${ADDRESS}\n<script>`, t: NOW }),
      JSON.stringify({ v: 'x'.repeat(CARRY_MAX_LENGTH + 1), t: NOW }), JSON.stringify({ v: ADDRESS, t: NOW + 5_000 })];
    for (const raw of junk) {
      const { store, data } = fakeStore();
      data.set(CARRY_KEY, raw);
      expect(takeCarriedDestination(store, NOW), raw.slice(0, 40)).toBeNull();
      expect(data.size).toBe(0);
    }
    const { store, data } = fakeStore();
    expect(carryDestination('   ', store, NOW)).toBe(false);
    expect(carryDestination('x'.repeat(CARRY_MAX_LENGTH + 1), store, NOW)).toBe(false);
    expect(carryDestination(`${ADDRESS}\u0000`, store, NOW)).toBe(false);
    expect(data.size).toBe(0);
  });

  it('with no storage (the server, or a browser that refuses it) every step does nothing', () => {
    expect(carryDestination(ADDRESS, null, NOW)).toBe(false);
    expect(takeCarriedDestination(null, NOW)).toBeNull();
    expect(() => clearCarriedDestination(null)).not.toThrow();
    // In this test run there is no window: the default store is none.
    expect(carryDestination(ADDRESS)).toBe(false);
    expect(takeCarriedDestination()).toBeNull();
    const refusing: CarryStore = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(carryDestination(ADDRESS, refusing, NOW)).toBe(false);
    expect(takeCarriedDestination(refusing, NOW)).toBeNull();
    expect(() => clearCarriedDestination(refusing)).not.toThrow();
  });

  it('the carry step makes no request and writes no log', async () => {
    const realFetch = (globalThis as any).fetch;
    let asked = 0;
    (globalThis as any).fetch = () => { asked++; throw new Error('the carry step must not make a request'); };
    try {
      const { store } = fakeStore();
      carryDestination(ADDRESS, store, NOW);
      takeCarriedDestination(store, NOW);
      clearCarriedDestination(store);
    } finally {
      (globalThis as any).fetch = realFetch;
    }
    expect(asked).toBe(0);

    const src = read('src/lib/carriedDestination.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|\bimport\b/);
    expect(src).not.toMatch(/console\.|localStorage|document\.|cookie|location|history\.|gtag|dataLayer/);
    expect(src).toMatch(/window\.sessionStorage/);
  });

  it('it is session storage under one key, and one file owns that key', () => {
    expect(CARRY_KEY).toBe('almstins.verify.checked');
    const owners = walk(path.join(ROOT, 'src'))
      .filter((file) => readFileSync(file, 'utf8').includes(CARRY_KEY))
      .map((file) => path.relative(ROOT, file));
    expect(owners).toEqual(['src/lib/carriedDestination.ts']);
  });

  it('one place writes it and one place reads it', () => {
    const importers = (name: string) => walk(path.join(ROOT, 'src'))
      .filter((file) => !file.endsWith('carriedDestination.ts'))
      .filter((file) => new RegExp(`\\b${name}\\b`).test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    expect(importers('carryDestination')).toEqual(['src/components/verify/VerifyCheckFirst.tsx']);
    expect(importers('takeCarriedDestination')).toEqual(['src/components/verify/VerifyDashboard.tsx']);
    expect(importers('clearCarriedDestination')).toEqual(['src/components/verify/VerifyCheckFirst.tsx']);
  });

  it('the field writes it only when the action is pressed, and writes what was checked', () => {
    const field = read('src/components/verify/VerifyCheckFirst.tsx');
    expect(field.match(/carryDestination\(/g)).toHaveLength(1);
    expect(field).toContain('onProve={() => { carryDestination(answer.checked); }}');
    expect(field).toContain('<a className="vcf__prove" href={VERIFY_SIGNIN_HREF} onClick={onProve}>');
  });

  it('nothing new builds a link from it, logs it or counts it', () => {
    for (const file of ['src/components/verify/VerifyCheckFirst.tsx', 'src/lib/verifyCheckFirst.ts']) {
      const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/console\.|gtag|dataLayer|localStorage|document\.cookie/);
      expect(src, file).not.toMatch(/location|history\.|URLSearchParams|encodeURIComponent|window\.open/);
    }
    // The sign-in page never sees it: it has no word of the carry step.
    expect(read('src/pages/verify/login.astro')).not.toMatch(/carried|sessionStorage|almstins\.verify/i);
  });

  it('the check itself is the scanner’s own requests, and pressing the action adds none', async () => {
    const f = fakeFetch({ '/api/verify/lookup': MISS, '/api/wallet-check': CLEAN_WALLET });
    const res = await runScanCheck(ADDRESS, f.impl);
    expect(ownerNextStep(res)).toBe('prove');
    const before = f.calls.length;
    const { store } = fakeStore();
    carryDestination(ADDRESS, store, NOW);
    expect(f.calls.length).toBe(before);
    expect(f.calls.every((c) => ['/api/verify/lookup', '/api/wallet-check'].includes(c.path))).toBe(true);
    expect(f.calls.some((c) => /destinations|auth|signin|login/.test(c.url))).toBe(false);
  });
});

describe('after sign-in: the first-run card already holds it', () => {
  const FREE = { address: 2, qr: 1, total: null };
  const view = (state: { carried?: string | null; destinations?: unknown[]; isDemo?: boolean }) => {
    const destinations = state.destinations ?? [];
    const isDemo = state.isDemo ?? false;
    return renderToStaticMarkup(React.createElement(DashboardView, {
      t: dashEn, isDemo, entitiesApproved: false,
      firstRun: isVerifyFirstRun({ isDemo, platformAccount: false, destinationCount: destinations.length }),
      destinations, limits: FREE, planName: 'Free', loading: false, error: null, firstId: null, proveRequest: null,
      carried: state.carried ?? null,
      onChange: () => {}, onRegisteredFirst: () => {}, onStartProof: () => {},
    }));
  };
  const dest = {
    id: 'd-1', kind: 'address', rail: 'bitcoin', value: `bc1q${'0'.repeat(32)}`, label: null, displayHint: null,
    proofStatus: 'unproven', proofMethod: 'none', proofDomain: null, domainAnchoredAt: null,
    lastConfirmedAt: null, provenAt: null, registeredAt: '2026-11-19 12:00:00',
    monitorUrl: null, monitorStatus: null, monitorCheckedAt: null,
  };

  it('the field starts with what the visitor checked', () => {
    const html = view({ carried: ADDRESS });
    expect(html).toMatch(new RegExp(`<input[^>]*id="vfr-card-value"[^>]*value="${ADDRESS}"`));
  });

  it('the card reads it like anything pasted, so the button is ready', () => {
    const html = view({ carried: ADDRESS });
    expect(text(html)).toContain('Recognized as a Bitcoin address.');
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${dashEn.registerBtn}</button>`));
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it('a carried payment link is read as a payment link', () => {
    const html = view({ carried: LINK });
    expect(html).toContain(`value="${LINK}"`);
    expect(text(html)).toContain(dashEn.firstReadLink);
  });

  it('says where it came from and that the browser’s copy is removed, with a way to clear the field', () => {
    const html = view({ carried: ADDRESS });
    expect(text(html)).toContain(dashEn.carriedNote);
    expect(dashEn.carriedNote).toMatch(/in this tab only/);
    expect(dashEn.carriedNote).toMatch(/now removed/);
    expect(html).toContain(`<button type="button" class="vfr-card__carried-clear">${dashEn.carriedClear}</button>`);
  });

  it('with nothing carried the card is Part C’s card: an empty field, one button, no note', () => {
    const html = view({});
    expect(html).toMatch(/<input[^>]*id="vfr-card-value"[^>]*value=""/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).not.toContain('vfr-card__carried');
    expect(renderToStaticMarkup(React.createElement(Card, { t: dashEn, limitText: () => '', onRegistered: () => {} })))
      .not.toContain('vfr-card__carried');
  });

  it('only the first-run card uses it: an account with a destination, and the demo, never show it', () => {
    expect(view({ carried: ADDRESS, destinations: [dest] })).not.toContain(ADDRESS);
    expect(view({ carried: ADDRESS, isDemo: true })).not.toContain(ADDRESS);
  });

  it('the dashboard reads and removes it on arrival, whoever the account is', () => {
    const dash = read('src/components/verify/VerifyDashboard.tsx');
    const at = dash.indexOf('const checked = takeCarriedDestination();');
    expect(at).toBeGreaterThan(-1);
    // Before the first-run rule is asked, and not inside any condition on it.
    expect(at).toBeLessThan(dash.indexOf('const firstRun = isVerifyFirstRun('));
    expect(dash.slice(dash.lastIndexOf('useEffect(() => {', at), at)).not.toMatch(/\bif\b/);
    expect(dash.match(/takeCarriedDestination\(/g)).toHaveLength(1);
  });

  it('the card registers nothing on its own: the visitor still presses the button', () => {
    const card = read('src/components/verify/FirstRunCard.tsx');
    expect(card.match(/registerDestination\(/g)).toHaveLength(1);
    expect(card).toContain('async function submit()');
    expect(card).not.toMatch(/useEffect/);
  });

  it.each(LANGS)('%s: the note and its button are worded', (lang) => {
    const t = getVerifyDashboard(lang);
    expect(t.carriedNote.length).toBeGreaterThan(20);
    expect(t.carriedClear.length).toBeGreaterThan(2);
    expect(t.carriedNote).not.toMatch(/[—–]/);
    expect(t.carriedNote).toContain('Verify');
  });

  it('the three languages are three translations', () => {
    for (const key of ['carriedNote', 'carriedClear'] as const) {
      expect(new Set(LANGS.map((l) => getVerifyDashboard(l)[key])).size).toBe(3);
    }
  });
});

describe('the words, in English, Spanish and French', () => {
  /** Every string of a language's checkFirst block, with its path. */
  const strings = (t: CheckFirst): [string, string][] =>
    Object.entries(t).flatMap(([k, v]) =>
      typeof v === 'string' ? [[k, v] as [string, string]] : Object.entries(v).map(([n, s]) => [`${k}.${n}`, s] as [string, string]));
  const KEYS = strings(T.en).map(([k]) => k);
  const EVERY = LANGS.flatMap((lang) => strings(T[lang]).map(([k, s]) => [lang, k, s] as const));
  const tokens = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

  /** The same lists tests/verify/firstRunCopy.test.ts and welcomeDripCopy.test.ts hold their copy to. */
  const BANNED: Record<Lang, RegExp[]> = {
    en: [/\b(stop|block|protect|prevent|guarantee|secur)\w*/i, /\bsafe(r|st|ly|ty|guard\w*)?\b/i],
    es: [/\b(deten|detien|detuv|bloque|proteg|protej|protecc|impid|impedi|garanti)\w*/i, /\bsegur\w*/i, /\ba salvo\b/i],
    fr: [/\b(arrêt|bloqu|protég|protèg|protect|empêch|garanti|sécuri)\w*/i, /\bsûre?s?\b/i, /\bà l[’']abri\b/i],
  };
  /** Words that would call a value unsafe. An unproven address is only unproven. */
  const UNSAFE: Record<Lang, RegExp> = {
    en: /unsafe|risk|danger|suspicious|suspect|scam|fraud|fake|threat|beware|untrusted|not trusted|insecure|unverified|at your own/i,
    es: /insegur|riesg|peligr|sospech|estafa|fraud|fals|amenaza|cuidado|no confiable|desconfi|no verificad/i,
    fr: /dangere|risqu|suspect|arnaque|fraud|faux|fausse|menace|méfi|non fiable|peu sûr|non vérifié/i,
  };

  it('the set of strings is the one this test knows', () => {
    expect(KEYS).toEqual([
      'title', 'fieldLabel', 'placeholder', 'button', 'checking', 'hint', 'resultLabel', 'scannerLangNote',
      'couldNotCheck', 'unproven.address', 'unproven.link', 'unproven.code', 'proveCta',
      'proveHow.address', 'proveHow.link', 'proveHow.code', 'freePlan', 'proveFlagged', 'carryNote',
    ]);
  });

  it.each(LANGS)('%s has every one', (lang) => {
    expect(strings(T[lang]).map(([k]) => k)).toEqual(KEYS);
    for (const [k, s] of strings(T[lang])) {
      if (k === 'scannerLangNote') continue;
      expect(s.trim().length, `${lang}.${k}`).toBeGreaterThan(2);
    }
  });

  it('no language is a copy of another', () => {
    for (const key of KEYS.filter((k) => k !== 'scannerLangNote')) {
      const versions = new Set(LANGS.map((l) => strings(T[l]).find(([k]) => k === key)![1]));
      expect(versions.size, key).toBe(3);
    }
  });

  it('the same tokens in every language, and none is printed raw', () => {
    for (const key of KEYS) {
      const of = (l: Lang) => tokens(strings(T[l]).find(([k]) => k === key)![1]);
      expect(of('es'), `es.${key}`).toEqual(of('en'));
      expect(of('fr'), `fr.${key}`).toEqual(of('en'));
    }
    for (const lang of LANGS) {
      for (const checked of [ADDRESS, LINK, PIX]) {
        expect(text(answer(checked, result({ safety: 'danger' }), lang)), `${lang} ${checked.slice(0, 8)}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it.each(EVERY)('%s.%s has no em dash and no en dash', (_lang, _key, s) => {
    expect(s).not.toMatch(/[—–]/);
  });

  it.each(EVERY)('%s.%s never says Almstins stops, blocks or protects anything, and calls nothing safe', (lang, key, s) => {
    for (const pattern of BANNED[lang]) expect(s.match(pattern)?.[0], `${lang}.${key}`).toBeUndefined();
  });

  it.each(EVERY)('%s.%s does not call an unproven address unsafe', (lang, key, s) => {
    expect(s.match(UNSAFE[lang])?.[0], `${lang}.${key}`).toBeUndefined();
  });

  it('the word lists do catch the words', () => {
    expect('Almstins blocks the payment'.match(BANNED.en[0])?.[0]).toBe('blocks');
    expect('a safe address'.match(BANNED.en[1])?.[0]).toBe('safe');
    expect('Almstins protege tu dirección'.match(BANNED.es[0])?.[0]).toBe('protege');
    expect('une adresse sûre'.match(BANNED.fr[1])?.[0]).toBe('sûre');
    expect('This address may be risky'.match(UNSAFE.en)?.[0]).toBe('risk');
    expect('Esta dirección puede ser peligrosa'.match(UNSAFE.es)?.[0]).toBe('peligr');
    expect('Cette adresse est peut-être dangereuse'.match(UNSAFE.fr)?.[0]).toBe('dangere');
  });

  it('the English keeps the wording rules the rest of the product copy is held to', () => {
    expect(brightLineViolations(strings(T.en).map(([, s]) => s).join(' '))).toEqual([]);
  });

  it('the new FAQ answer and the feature line keep the same rules', () => {
    const Q: Record<Lang, RegExp> = { en: /box at the top/, es: /cuadro de la parte superior/, fr: /champ en haut/ };
    for (const lang of LANGS) {
      const item = copy[lang].faq.items.find((i) => Q[lang].test(i.q));
      expect(item, lang).toBeDefined();
      const feature = copy[lang].jsonld.featureList.at(-1)!;
      for (const s of [item!.q, item!.a, feature]) {
        expect(s).not.toMatch(/[—–]/);
        for (const pattern of BANNED[lang]) expect(s.match(pattern)?.[0], lang).toBeUndefined();
        expect(s.match(UNSAFE[lang])?.[0], lang).toBeUndefined();
      }
    }
    expect(brightLineViolations(copy.en.faq.items.find((i) => Q.en.test(i.q))!.a)).toEqual([]);
  });

  it.each(LANGS)('%s: the unproven result and its action render in that language, with the scanner’s words', (lang) => {
    const html = answer(ADDRESS, result(), lang);
    const shown = text(html);
    const scan = verifyScanCopy[lang];
    expect(shown).toContain(T[lang].resultLabel);
    expect(shown).toContain(scan.notVerifiedTitle);
    expect(shown).toContain(scan.notVerifiedBody.address);
    expect(shown).toContain(T[lang].unproven.address);
    expect(html).toContain(`<a class="vcf__prove" href="${VERIFY_SIGNIN_HREF}">${T[lang].proveCta}</a>`);
    expect(shown).toContain(fill(T[lang].proveHow.address, { claimed: scan.claimedTitle.address, verified: scan.verifiedTitle }));
    expect(shown).toContain(fill(T[lang].freePlan, { addresses: '2', qr: '1' }));
    expect(shown).toContain(T[lang].carryNote);
  });

  it.each(LANGS)('%s: a claimed value gets no invitation in that language either', (lang) => {
    const html = answer(ADDRESS, result({ lookup: CLAIMED }), lang);
    expect(text(html)).toContain(verifyScanCopy[lang].claimedTitle.address);
    expect(html).not.toContain('vcf__next');
    expect(html).not.toContain('<a');
  });

  it('Spanish and French say the scan page itself still shows the result in English; English says nothing', () => {
    expect(T.en.scannerLangNote).toBe('');
    expect(answer(ADDRESS, result())).not.toContain('vcf__lang-note');
    expect(text(answer(ADDRESS, result(), 'es'))).toContain('Por ahora, el escáner público muestra este mismo resultado en inglés.');
    expect(text(answer(ADDRESS, result(), 'fr'))).toContain('Pour l’instant, le scanner public affiche ce même résultat en anglais.');
    // Still true: the scan page takes no language.
    expect(read('src/pages/verify/scan.astro')).toContain('<VerifyScan client:load initialAddress={initialAddress} />');
  });

  it('the proof is named in the dashboard’s own words, in every language', () => {
    expect(T.en.proveHow.address).toContain('the satoshi test (a self-send)');
    expect(T.es.proveHow.address).toContain('la prueba del satoshi (un autoenvío)');
    expect(T.fr.proveHow.address).toContain('le test du satoshi (un auto-envoi)');
    expect(getVerifyDashboard('en').ssIntro).toContain('the satoshi test (a self-send)');
    expect(getVerifyDashboard('es').ssIntro).toContain('la prueba del satoshi (un autoenvío)');
    expect(getVerifyDashboard('fr').ssIntro).toContain('le test du satoshi (un auto-envoi)');
    expect(T.en.proveHow.address).toContain('you pay only the normal network fee');
    expect(T.es.proveHow.address).toContain('solo pagas la comisión normal de la red');
    expect(T.fr.proveHow.address).toContain('vous ne payez que les frais de réseau habituels');
  });

  it('the Free plan sentence is the welcome email’s, word for word', () => {
    for (const lang of LANGS) {
      const sentence = fill(T[lang].freePlan, { addresses: '2', qr: '1' });
      expect(JSON.stringify(verifyWelcomeLocales[lang]), lang).toContain(sentence);
    }
  });
});

describe('built as components with their own stylesheets', () => {
  const COMPONENTS = ['VerifyCheckFirst.tsx', 'ScanResultCards.tsx'].map((f) => `src/components/verify/${f}`);

  it.each(COMPONENTS)('%s has no style attribute and no inline style block', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\bstyle=/);
    expect(src).not.toContain('<style');
    expect(src).toMatch(/import '\.\/(VerifyCheckFirst|ScanResultCards)\.css';/);
  });

  it.each(['VerifyCheckFirst.css', 'ScanResultCards.css'])('%s takes every color from the shared tokens', (file) => {
    const css = read(`src/components/verify/${file}`).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).toMatch(/var\(--/);
  });

  it('the page adds no markup or style of its own for the field: one component line', () => {
    const page = read('src/components/VerifyPage.astro');
    expect(page.match(/<VerifyCheckFirst\b/g)).toHaveLength(1);
    expect(page).toContain("import VerifyCheckFirst from './verify/VerifyCheckFirst';");
    expect(page).not.toMatch(/\.vcf\b/);
  });

  it('the rule, the carry step and the sign-in link live in src/lib, not in the component', () => {
    const field = read('src/components/verify/VerifyCheckFirst.tsx');
    expect(field).not.toMatch(/sessionStorage|\/verify\/login/);
    expect(field).toContain("from '../../lib/verifyCheckFirst'");
    expect(field).toContain("from '../../lib/carriedDestination'");
    expect(read('src/components/VerifyPage.astro')).toContain('const LOGIN_HREF = VERIFY_SIGNIN_HREF;');
  });
});

/** Every source file under a directory. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|astro|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
