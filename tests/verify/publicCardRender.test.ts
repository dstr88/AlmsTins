import { describe, it, expect, beforeAll } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { publicVerifyCard, addressSafetyVerdict, type PublicVerifyLookup } from '../../src/lib/verifyPublicCard';
import { en as wcEn } from '../../src/i18n/walletChecker';
import { verifyScanCopy } from '../../src/i18n/verifyScan';

/**
 * Renders the two public Verify cards (wallet-checker and /verify/scan) to markup and
 * checks what a payer actually sees: never a freeform label, no name on Claimed, and no
 * green next to a flagged safety verdict.
 *
 * The unit config compiles JSX with the classic runtime (React.createElement), so React
 * is provided as a global before the components are imported. No DOM or network needed.
 */
type Components = {
  VerifyCard: (p: { card: any; c: any }) => React.ReactElement;
  ScanVerifyCard: (p: { card: any; noun: any; t: any }) => React.ReactElement;
};
let C: Components;

beforeAll(async () => {
  (globalThis as any).React = React;
  const wc = await import('../../src/components/WalletChecker');
  const scan = await import('../../src/components/verify/VerifyScan');
  C = { VerifyCard: wc.VerifyCard as any, ScanVerifyCard: scan.ScanVerifyCard as any };
});

const SQUAT = 'Coinbase Support';
const lookup = (over: Partial<PublicVerifyLookup>): PublicVerifyLookup => ({
  level: 'claimed', since: '2026-09-01', domain: null, label: SQUAT, source: 'merchant', ...over,
});
// Words that claim control was proven. A Claimed row can be a domain listing that went
// stale and never proved control, so no Claimed card may say this.
const CONTROL_PROVEN = /proved (it )?control|proved it controls|control confirmed/i;
const walletCard = (l: PublicVerifyLookup, safety: string) =>
  renderToStaticMarkup(React.createElement(C.VerifyCard, { card: publicVerifyCard(l, safety), c: wcEn.checker }));
const scanCard = (l: PublicVerifyLookup | null, safety: string, noun: 'address' | 'link' | 'code' = 'address') =>
  renderToStaticMarkup(React.createElement(C.ScanVerifyCard, { card: publicVerifyCard(l, safety), noun, t: verifyScanCopy.en }));

describe('wallet-checker Verify card', () => {
  it('Claimed: no freeform label, no domain, no "verified member"', () => {
    const html = walletCard(lookup({ domain: 'coinbase.com' }), 'clean');
    expect(html).not.toContain(SQUAT);
    expect(html).not.toContain('coinbase.com');
    expect(html).not.toMatch(/verified Almstins member/i);
    expect(html).toContain('Claimed by an Almstins account');
    expect(html).toContain('An Almstins account has claimed this address.');
    expect(html).toContain('Claimed since 2026-09-01');
  });

  it('Claimed from a domain listing that went stale: says claimed, never "proved control"', () => {
    // The row was flipped by a domain file listing (no self-send) and its anchor lapsed,
    // so the lookup answers level 'claimed' with the account's domain still attached.
    const html = walletCard(lookup({ level: 'claimed', label: 'Acme', domain: 'acme.com' }), 'clean');
    expect(html).not.toMatch(CONTROL_PROVEN);
    expect(html).not.toContain('acme.com');
    expect(html).not.toContain('Acme');
    expect(html).toContain('No website vouches for it right now');
  });

  it('Verified merchant, freeform label not derived from the domain: "Verified via {domain}" only', () => {
    const html = walletCard(lookup({ level: 'verified', domain: 'joescoffee.com' }), 'clean');
    expect(html).not.toContain(SQUAT);
    expect(html).toContain('Verified via joescoffee.com');
    expect(html).not.toContain('Listed');
    // The detail line must not say that domain lists the address: it may be another of
    // the account's proven domains.
    expect(html).not.toContain('joescoffee.com proved control of its domain and lists this');
    expect(html).toContain('proved it controls joescoffee.com');
    expect(html).toContain('var(--gain)');
  });

  it('Verified merchant with a domain-derived business name: "{name}, verified via {domain}"', () => {
    const html = walletCard(lookup({ level: 'verified', label: 'Joes Coffee', domain: 'joescoffee.com' }), 'clean');
    expect(html).toContain('Joes Coffee, verified via joescoffee.com');
  });

  it('Verified entity (the domain publishes its own list): "Listed on {domain}"', () => {
    const html = walletCard(lookup({ level: 'verified', source: 'entity', label: null, domain: 'exchange.example' }), 'clean');
    expect(html).toContain('Listed on exchange.example');
    expect(html).toContain('exchange.example proved control of its domain and lists this as one of its own receiving addresses.');
  });

  it('a lookalike or decorated name is never rendered', () => {
    const html = walletCard(lookup({ level: 'verified', label: 'Acme \u2705', domain: 'acme.com' }), 'clean');
    expect(html).not.toContain('\u2705');
    expect(html).toContain('Verified via acme.com');
  });

  it('Verified but flagged danger: neutral (no green), with the warning note', () => {
    const html = walletCard(lookup({ level: 'verified', label: 'Acme', domain: 'acme.com' }), 'danger');
    expect(html).not.toContain('var(--gain)');
    expect(html).toContain('Acme, verified via acme.com');
    expect(html).toContain('The safety screen flagged this address');
  });

  it('Verified with community reports on a clean scan: neutral, not green', () => {
    const html = walletCard(lookup({ level: 'verified', label: 'Acme', domain: 'acme.com' }), addressSafetyVerdict('clean', 3) as string);
    expect(html).not.toContain('var(--gain)');
    expect(html).toContain('The safety screen flagged this address');
  });

  it('Claimed but flagged: no caution-tape (it has green stripes), neutral card', () => {
    const html = walletCard(lookup({}), 'caution');
    expect(html).not.toContain('var(--gain)');
    expect(html).not.toContain(SQUAT);
  });
});

describe('/verify/scan Verify card', () => {
  it('Claimed address: no name, neutral wording, no control claim', () => {
    const html = scanCard(lookup({ domain: 'coinbase.com' }), 'clean');
    expect(html).not.toContain(SQUAT);
    expect(html).not.toContain('coinbase.com');
    expect(html).not.toMatch(CONTROL_PROVEN);
    expect(html).toContain('Claimed by an Almstins account');
    expect(html).toContain('An Almstins account has claimed this address.');
    expect(html).toContain('No website vouches for it right now');
  });

  it('Claimed payment link: says registered, not proven, and no name', () => {
    const html = scanCard(lookup({ domain: 'buy.stripe.com' }), 'clean', 'link');
    expect(html).not.toContain(SQUAT);
    expect(html).toContain('An Almstins account registered this link.');
  });

  it('Verified merchant address: green, "Verified via {domain}", never the freeform label', () => {
    const html = scanCard(lookup({ level: 'verified', domain: 'joescoffee.com' }), 'clean');
    expect(html).toContain('vs__card--ok');
    expect(html).toContain('Verified via joescoffee.com.');
    expect(html).not.toContain('Listed');
    expect(html).not.toContain(SQUAT);
  });

  it('Verified entity address: "Listed on {domain}"', () => {
    const html = scanCard(lookup({ level: 'verified', source: 'entity', label: null, domain: 'exchange.example' }), 'clean');
    expect(html).toContain('Listed on exchange.example.');
  });

  it('Verified payment link: registered by the verified owner of the domain', () => {
    const html = scanCard(lookup({ level: 'verified', label: 'Acme', domain: 'acme.com' }), 'clean', 'link');
    expect(html).toContain('Registered by Acme, the verified owner of acme.com.');
  });

  it('Verified but flagged danger: not green, and the flagged note is shown', () => {
    const html = scanCard(lookup({ level: 'verified', label: 'Acme', domain: 'acme.com' }), 'danger');
    expect(html).not.toContain('vs__card--ok');
    expect(html).not.toContain('✓');
    expect(html).toContain('Acme, verified via acme.com.');
    expect(html).toContain('The safety screen flagged this address');
  });

  it('no hit: the not-verified card', () => {
    const html = scanCard(null, 'clean');
    expect(html).toContain('Not a verified destination');
  });
});
