import { describe, it, expect } from 'vitest';
import { siteVerdict, siteVerdictText, type SourceResult, type SourceVerdict } from '../../src/lib/siteVerdict';
import { en, es, fr } from '../../src/i18n/walletChecker';

/**
 * The link checker's overall verdict (code review 2026-10-11).
 *
 * Bug 1: a site on MetaMask's verified-safe list read green even when ScamSniffer, GoPlus or
 * another source flagged it. Now any flag wins; the allowlist only softens MetaMask's own
 * blocklist entry (checkMetaMask reports 'whitelisted').
 *
 * Bug 2: the yellow state for unreachable sources needed EVERY source to fail, and the
 * downloaded MetaMask list never fails, so a partial or total live outage still read green.
 * Now any unreachable source keeps the site off green and marks the check limited.
 */

const src = (name: string, verdict: SourceVerdict): SourceResult => ({ name, verdict, detail: '', icon: '' });

const ALL_CLEAN: SourceResult[] = [
  src('MetaMask Blocklist', 'clean'),
  src('ScamSniffer', 'clean'),
  src('GoPlus Security', 'clean'),
  src('URLScan.io', 'clean'),
  src('OpenPhish', 'clean'),
  src('Google Safe Browsing', 'skipped'),
  src('VirusTotal', 'skipped'),
];
const withSource = (name: string, verdict: SourceVerdict, base = ALL_CLEAN) =>
  base.map((s) => (s.name === name ? { ...s, verdict } : s));
const allowlisted = withSource('MetaMask Blocklist', 'whitelisted');

describe('siteVerdict: any flag wins', () => {
  it('every source clean → green, not limited', () => {
    expect(siteVerdict(ALL_CLEAN)).toEqual({ verdict: 'green', limited: false });
  });

  it.each(['ScamSniffer', 'GoPlus Security', 'URLScan.io', 'OpenPhish', 'Google Safe Browsing', 'VirusTotal'])(
    'MetaMask allowlist + %s flags it → red', (name) => {
      expect(siteVerdict(withSource(name, 'flagged', allowlisted)).verdict).toBe('red');
    },
  );

  it('the allowlist alone, with every other source clean → green', () => {
    expect(siteVerdict(allowlisted)).toEqual({ verdict: 'green', limited: false });
  });

  it('a flag outranks an unreachable source and a caution', () => {
    let s = withSource('GoPlus Security', 'error');
    s = withSource('VirusTotal', 'caution', s);
    s = withSource('ScamSniffer', 'flagged', s);
    expect(siteVerdict(s)).toEqual({ verdict: 'red', limited: false });
  });
});

describe('siteVerdict: an unreachable source never reads green', () => {
  it.each(['GoPlus Security', 'URLScan.io', 'Google Safe Browsing', 'VirusTotal'])(
    '%s unreachable → yellow, limited', (name) => {
      expect(siteVerdict(withSource(name, 'error'))).toEqual({ verdict: 'yellow', limited: true });
    },
  );

  it('every live source unreachable → yellow, limited', () => {
    let s = withSource('GoPlus Security', 'error');
    s = withSource('URLScan.io', 'error', s);
    expect(siteVerdict(s)).toEqual({ verdict: 'yellow', limited: true });
  });

  it('the allowlist does not cover for an unreachable source', () => {
    expect(siteVerdict(withSource('GoPlus Security', 'error', allowlisted))).toEqual({ verdict: 'yellow', limited: true });
  });

  it('a switched-off source (skipped) is not counted as unreachable', () => {
    expect(siteVerdict(ALL_CLEAN).verdict).toBe('green');
  });

  it('a caution leads over an unreachable source (yellow, not labeled limited)', () => {
    let s = withSource('GoPlus Security', 'error');
    s = withSource('VirusTotal', 'caution', s);
    expect(siteVerdict(s)).toEqual({ verdict: 'yellow', limited: false });
  });
});

describe('siteVerdict: unscanned', () => {
  it('a list still loading or a site URLScan never scanned → yellow', () => {
    expect(siteVerdict(withSource('ScamSniffer', 'unscanned')).verdict).toBe('yellow');
    expect(siteVerdict(withSource('URLScan.io', 'unscanned')).verdict).toBe('yellow');
  });

  it('VirusTotal having no record of a link stays green', () => {
    expect(siteVerdict(withSource('VirusTotal', 'unscanned')).verdict).toBe('green');
  });
});

describe('siteVerdictText: what the link checker shows', () => {
  it.each([['en', en], ['es', es], ['fr', fr]] as const)('%s: green shows "no flags", never "safe", with the clean-is-not-safe note', (_lang, l) => {
    const shown = siteVerdictText({ verdict: 'green' }, l.js)!;
    expect(shown.tone).toBe('green');
    expect(shown.label).toBe(l.js.verdictSafe);
    expect(shown.label).not.toMatch(/SAFE|SEGUR|SÛR/i);
    expect(shown.cleanNote).toBe(l.js.cleanNotSafe);
    expect(shown.tip).toBe(l.js.tipGreen);
  });

  it('yellow + limited shows the limited-check label and tip, no clean note', () => {
    const shown = siteVerdictText({ verdict: 'yellow', limited: true }, en.js)!;
    expect(shown).toEqual({ tone: 'yellow', label: en.js.verdictLimited, tip: en.js.tipLimited, cleanNote: null });
  });

  it('yellow without limited shows the caution label', () => {
    expect(siteVerdictText({ verdict: 'yellow', limited: false }, en.js)!.label).toBe(en.js.verdictCaution);
  });

  it('red shows the danger label, no clean note', () => {
    expect(siteVerdictText({ verdict: 'red' }, en.js)).toMatchObject({ tone: 'red', label: en.js.verdictDanger, cleanNote: null });
  });

  it.each([undefined, null, {}, { verdict: 'safe' }, { error: true, message: 'Too many checks.' }])(
    'a reply without a known verdict (%j) is a failed check, never a pass', (data) => {
      expect(siteVerdictText(data as any, en.js)).toBeNull();
    },
  );
});
