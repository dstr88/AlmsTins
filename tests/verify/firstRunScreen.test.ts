import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { en, type VerifyDashboardLocale } from '../../src/i18n/dashboard/verify';
import { isVerifyFirstRun } from '../../src/lib/verifyFirstRun';
import { readDestinationInput } from '../../src/lib/verifyDestinationInput';

/**
 * Verify first run, Part C: what /dashboard/verify renders for each kind of account. The view is
 * rendered to markup for a given state (no browser, no network), and the state's first-run flag
 * comes from the rule itself, so these check the screen and the rule together:
 *
 *   - an empty account sees the three steps and the one card, and nothing else;
 *   - the sections it hid are back the moment a destination exists;
 *   - right after the first address, the two proving steps, in order, each with its cost and
 *     what it earns;
 *   - a payment link or QR can be the first destination, and is told what is true of it;
 *   - the demo and an account that already has destinations render none of the new screen.
 *
 * The unit config compiles JSX with the classic runtime, so React is a global before the
 * components are imported (as publicCardRender.test.ts does). Every address is made up.
 */

const T = en as VerifyDashboardLocale;
const FREE = { address: 2, qr: 1, total: null };
const ADDRESS = `bc1q${'qpzry9x8gf2tvdw0s3jn54khce6mua7l'}`;
const LINK = 'https://buy.example.com/test_made_up_123';
const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

type Dest = Record<string, unknown>;
const dest = (over: Dest = {}): Dest => ({
  id: 'd-1', kind: 'address', rail: 'bitcoin', value: ADDRESS, label: null, displayHint: null,
  proofStatus: 'unproven', proofMethod: 'none', proofDomain: null, domainAnchoredAt: null,
  lastConfirmedAt: null, provenAt: null, registeredAt: '2026-11-19 12:00:00',
  monitorUrl: null, monitorStatus: null, monitorCheckedAt: null, ...over,
});

let View: (p: any) => React.ReactElement;
let Card: (p: any) => React.ReactElement;
let readout: (input: any, t: VerifyDashboardLocale) => string | null;
beforeAll(async () => {
  (globalThis as any).React = React;
  View = (await import('../../src/components/verify/VerifyDashboard')).VerifyDashboardView as any;
  const card = await import('../../src/components/verify/FirstRunCard');
  Card = card.FirstRunCard as any;
  readout = card.inputReadout;
});

/** The dashboard for an account in a given state, as markup. First-run comes from the rule. */
function render(state: {
  destinations?: Dest[]; isDemo?: boolean; platformAccount?: boolean; entitiesApproved?: boolean;
  loading?: boolean; firstId?: string | null; error?: string | null;
}): string {
  const destinations = state.destinations ?? [];
  const isDemo = state.isDemo ?? false;
  const firstRun = isVerifyFirstRun({
    isDemo, platformAccount: state.platformAccount ?? false, destinationCount: destinations.length,
  });
  return renderToStaticMarkup(React.createElement(View, {
    t: T, isDemo, entitiesApproved: state.entitiesApproved ?? false, firstRun,
    destinations, limits: FREE, planName: 'Free', loading: state.loading ?? false, error: state.error ?? null,
    firstId: state.firstId ?? null, proveRequest: null,
    onChange: () => {}, onRegisteredFirst: () => {}, onStartProof: () => {},
  }));
}

/** Text as a person reads it: tags dropped, entities decoded. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const NEW_SCREEN = /class="[^"]*\b(vfr|vfr-card|vfr-steps|vpg)\b/;

describe('an empty account: the three steps and one card, nothing else', () => {
  it('shows the card: one sentence, one field, one button', () => {
    const html = render({});
    expect(html).toContain('class="vfr-card"');
    expect(html).toContain(`<h1 id="vfr-card-title" class="vfr-card__title">${T.firstCardTitle}</h1>`);
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(`placeholder="${T.firstFieldPlaceholder}"`);
    expect(html).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*disabled=""[^>]*>${T.registerBtn}</button>`));
    // No select until the field holds something it cannot settle on its own.
    expect(html).not.toContain('<select');
  });

  it('the sentence is for any business: the address you ask people to pay', () => {
    expect(T.firstCardTitle).toBe('Register the address you ask people to pay');
    const shown = text(render({}));
    expect(shown).not.toMatch(/QR codes|sticker|customers|shop/i);
  });

  it('shows the three steps above the card, in order, with the first one current', () => {
    const html = render({});
    const [register, prove, share, card] = [T.firstStepRegister, T.firstStepProve, T.firstStepShare, 'vfr-card__title']
      .map((s) => html.indexOf(s));
    expect(register).toBeGreaterThan(-1);
    expect(register).toBeLessThan(prove);
    expect(prove).toBeLessThan(share);
    expect(share).toBeLessThan(card);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/vfr-steps__step--current" aria-current="step"><span class="vfr-steps__num" aria-hidden="true">1</);
  });

  it('keeps everything else out of the way: plan notice, both panels, "Verify a sign", platform lists, how-to', () => {
    const shown = text(render({}));
    for (const hidden of [
      T.notice, T.addressesTitle, T.qrTitle, T.emptyNone, T.emptyAddrBody, T.emptyQrBody,
      T.verifyTitle, T.entHeading, T.howToHeading, T.demoBanner, T.labelPlaceholder,
    ]) expect(shown).not.toContain(hidden);
  });

  it('is there before the list has loaded, and a load error still shows', () => {
    const html = render({ loading: true, error: T.loadError });
    expect(html).toContain('class="vfr-card"');
    expect(html).toContain(`<div class="vd__error">${T.loadError}</div>`);
  });

  it('names the networks from the one list of rails, and says a link or a QR works too', () => {
    const shown = text(render({}));
    expect(shown).toContain('Ethereum, Polygon, Avalanche, Bitcoin, Solana, Litecoin');
    expect(shown).toContain('paste the link or the text the QR holds');
    expect(shown).not.toContain('{chains}');
  });
});

describe('the card says what it read in the one field', () => {
  it.each([
    [ADDRESS, 'Recognized as a Bitcoin address.'],
    [`0x${'ab12'.repeat(10)}`, T.firstReadNetworks],
    [LINK, T.firstReadLink],
    ['upi://pay?pa=loja@examplebank', T.firstReadCode],
    ['pay me here', T.firstReadUnknown],
  ])('%s', (value, sentence) => {
    expect(readout(readDestinationInput(value), T)).toBe(sentence);
  });

  it('says nothing while the field is empty', () => {
    expect(readout(readDestinationInput(''), T)).toBeNull();
    expect(renderToStaticMarkup(React.createElement(Card, { t: T, limitText: () => '', onRegistered: () => {} })))
      .not.toContain('vfr-card__readout');
  });
});

describe('once a destination exists, the dashboard is back', () => {
  it('one registered address: the card is gone and every hidden section is shown', () => {
    const html = render({ destinations: [dest()] });
    expect(html).not.toMatch(NEW_SCREEN);
    const shown = text(html);
    for (const back of [T.notice, T.addressesTitle, T.qrTitle, T.verifyTitle, T.entHeading, T.emptyQrBody])
      expect(shown).toContain(back);
    expect(shown).toContain(ADDRESS);
    expect(shown).toContain(T.statusRegistered);
  });

  it('a payment link alone ends first-run just the same', () => {
    const html = render({ destinations: [dest({ id: 'q-1', kind: 'qr', rail: 'url', value: LINK })] });
    expect(html).not.toMatch(NEW_SCREEN);
    const shown = text(html);
    for (const back of [T.notice, T.addressesTitle, T.qrTitle, T.verifyTitle, T.entHeading]) expect(shown).toContain(back);
    expect(shown).toContain(LINK);
  });

  it('removing the last destination brings the card back', () => {
    expect(render({ destinations: [] })).toContain('class="vfr-card"');
  });
});

describe('right after the first address: how to prove it, as two ordered steps', () => {
  const html = () => render({ destinations: [dest()], firstId: 'd-1' });

  it('shows the guide above the dashboard, with the steps strip on "Prove"', () => {
    const out = html();
    expect(out).toContain(`<h1 id="vpg-title" class="vpg__title">${T.guideAddressTitle}</h1>`);
    expect(out.indexOf('class="vpg"')).toBeLessThan(out.indexOf('class="vd__notice"'));
    expect(out).toMatch(/vfr-steps__step--done"><span class="vfr-steps__num" aria-hidden="true">✓</);
    expect(out).toMatch(/vfr-steps__step--current" aria-current="step"><span class="vfr-steps__num" aria-hidden="true">2</);
    // The dashboard itself is all there under it.
    for (const section of [T.notice, T.addressesTitle, T.qrTitle, T.verifyTitle]) expect(text(out)).toContain(section);
  });

  it('step 1 is the satoshi test: the network fee, and Claimed', () => {
    const shown = text(html());
    const at = (s: string) => shown.indexOf(s);
    expect(at(T.guideClaimTitle)).toBeGreaterThan(-1);
    expect(at(T.guideClaimTitle)).toBeLessThan(at(T.guideListTitle));
    expect(shown).toContain('Claim it with the satoshi test (a self-send)');
    expect(shown).toContain('Costs: the normal network fee.');
    expect(shown).toContain('Earns: Claimed.');
    expect(shown).toContain('No wallet connection and no signature.');
  });

  it('step 2 is the file on your own website: free, needs a website, and Verified with the domain shown', () => {
    const shown = text(html());
    expect(shown).toContain('List it in a file on your own website');
    expect(shown).toContain('Costs: nothing from Almstins. You need a website you control.');
    expect(shown).toContain('Earns: Verified, with your domain shown beside the address.');
  });

  it('says the file can be used without the test, and what skipping it costs', () => {
    const shown = text(html());
    expect(shown).toContain('You can skip step 1: the file alone takes a registered address to Verified.');
    expect(shown).toContain('goes back to Claimed, and one that skipped it shows as Lapsed.');
    expect(shown).not.toMatch(/\{\w+\}/);
  });

  it('each step has one button; the next one is the primary', () => {
    const out = html();
    expect(out).toContain(`<button type="button" class="vd-prove__verify vpg__btn">${T.guideClaimBtn}</button>`);
    expect(out).toContain(`<button type="button" class="vd-prove__get vpg__btn">${T.guideListBtn}</button>`);
  });

  it('once the address is Claimed, step 1 reads done and step 2 is next', () => {
    const out = render({
      destinations: [dest({ proofStatus: 'proven', proofMethod: 'micro_deposit', provenAt: '2026-11-19 12:30:00' })], firstId: 'd-1',
    });
    expect(out).toContain(`<span class="vpg__done">${T.guideStepDone}</span>`);
    expect(out).not.toContain(T.guideClaimBtn);
    expect(out).toContain(`<button type="button" class="vd-prove__verify vpg__btn">${T.guideListBtn}</button>`);
    expect(text(out)).not.toContain('You can skip step 1');
  });

  it('the guide leaves with its address, and is only for the one registered in this visit', () => {
    expect(render({ destinations: [dest({ id: 'other' })], firstId: 'd-1' })).not.toMatch(NEW_SCREEN);
    expect(render({ destinations: [dest()], firstId: null })).not.toMatch(NEW_SCREEN);
  });
});

describe('right after a first payment link or QR: what is true of it, and no proving steps', () => {
  const link = () => render({ destinations: [dest({ id: 'q-1', kind: 'qr', rail: 'url', value: LINK })], firstId: 'q-1' });

  it('says it is saved, what the account can do now, and what a payer sees', () => {
    const shown = text(link());
    expect(shown).toContain(T.guideQrTitleLink);
    expect(shown).toContain('use “Verify a sign” below to check that a sign, invoice or checkout still carries it.');
    expect(shown).toContain('What a payer sees: “Not a verified destination”, until this account has proven a website domain.');
    expect(shown).toContain('choose Prove on its row, then Domain.');
    expect(shown).not.toMatch(/\{\w+\}/);
  });

  it('offers no satoshi test and no steps strip: a link has no proof of its own', () => {
    const out = link();
    expect(out).toContain('class="vpg vpg--qr"');
    expect(out).not.toContain('vpg__steps');
    expect(out).not.toContain('vfr-steps');
    expect(out).not.toContain(T.guideClaimBtn);
  });

  it('a PIX or UPI code is called a payment QR code', () => {
    const out = render({ destinations: [dest({ id: 'q-2', kind: 'qr', rail: 'pix', value: `emvqr:${'a'.repeat(64)}` })], firstId: 'q-2' });
    expect(text(out)).toContain(T.guideQrTitleCode);
  });
});

describe('the demo and accounts that already have destinations are unchanged', () => {
  const seeded = [
    dest({ id: 'a-1', proofStatus: 'proven', proofMethod: 'micro_deposit', provenAt: '2026-11-01 10:00:00', label: 'Front counter' }),
    dest({ id: 'q-1', kind: 'qr', rail: 'url', value: LINK }),
  ];

  it('the demo renders its banner, both panels and the how-to, and none of the new screen', () => {
    const html = render({ isDemo: true, destinations: seeded });
    expect(html).not.toMatch(NEW_SCREEN);
    const shown = text(html);
    for (const part of [T.demoBanner, T.addressesTitle, T.qrTitle, T.verifyTitle, T.howToHeading]) expect(shown).toContain(part);
    expect(shown).not.toContain(T.notice);
    expect(shown).not.toContain(T.firstCardTitle);
  });

  it('the demo with nothing seeded still shows its two empty panels, never the card', () => {
    const html = render({ isDemo: true, destinations: [] });
    expect(html).not.toMatch(NEW_SCREEN);
    expect(html.match(/class="vd-empty"/g)).toHaveLength(2);
    expect(text(html)).toContain(T.howToHeading);
  });

  it('an account with destinations renders none of the new screen', () => {
    const html = render({ destinations: seeded });
    expect(html).not.toMatch(NEW_SCREEN);
    const shown = text(html);
    for (const part of [T.notice, T.addressesTitle, T.qrTitle, T.verifyTitle, T.entHeading, T.statusClaimed, 'Front counter'])
      expect(shown).toContain(part);
    // Its add forms are the dashboard's own: chain picker, label field, Register.
    expect(html).toContain('class="vd-add__rail"');
    expect(html).toContain(`placeholder="${T.labelPlaceholder}"`);
  });

  it('a platform account with no destination keeps the dashboard and its list controls', () => {
    const html = render({ platformAccount: true, entitiesApproved: true });
    expect(html).not.toMatch(NEW_SCREEN);
    expect(text(html)).toContain(T.entHeading);
    expect(html.match(/class="vd-empty"/g)).toHaveLength(2);
  });
});

describe('built as components with their own stylesheets', () => {
  const FILES = ['FirstRunSteps.tsx', 'FirstRunCard.tsx', 'ProveGuide.tsx'].map((f) => `src/components/verify/${f}`);

  it.each(FILES)('%s has no style attribute and no inline style block', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\bstyle=/);
    expect(src).not.toContain('<style');
    expect(src).toMatch(/import '\.\/(VerifyFirstRun|ProveGuide)\.css';/);
  });

  it.each(['VerifyFirstRun.css', 'ProveGuide.css'])('%s takes every color from the shared tokens', (file) => {
    const css = read(`src/components/verify/${file}`).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(/);
    expect(css).toMatch(/var\(--accent\)/);
  });

  it('the page hides its hero for a first-run account and adds no style of its own', () => {
    const page = read('src/pages/dashboard/verify.astro');
    expect(page).toContain('{!firstRun && <div class="hero-bleed">');
    expect(page.match(/<style>/g)).toHaveLength(1); // the hero's own block, as before
    expect(page).not.toMatch(/\.vfr|\.vpg/);
  });
});
