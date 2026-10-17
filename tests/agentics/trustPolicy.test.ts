import { describe, it, expect } from 'vitest';
import {
  SECURITY_FLAGS,
  TRUST_STATUSES,
  nextTrustStatus,
  parseReadout,
  statusFromStored,
  summarizeChecks,
  type TrustResult,
  type TrustStatus,
  type VerifyLookup,
} from '../../src/lib/agentVault/trustPolicy';
import { walletResult } from '../helpers/agentVault';

/**
 * What a destination's checks add up to. Pure. The pill means "cleared the checks we ran", never
 * "safe"; a check that did not run is not a check that passed (the fail-safe walletChecker.ts
 * applies to its own all-clear); a flag is a ratchet.
 */

const AT = '2026-10-01T12:00:00.000Z';
const summarize = (wallet: ReturnType<typeof walletResult> | null, verify: VerifyLookup | null = { level: null, domain: null, claimedElsewhere: false }) =>
  summarizeChecks({ wallet, verify, checkedAt: AT });

describe('summarizeChecks: a clean answer', () => {
  it('passes when every source ran and nothing hit', () => {
    const r = summarize(walletResult());
    expect(r).toEqual({
      v: 1, checkedAt: AT, result: 'pass', hits: [], limits: [],
      sanctions: 'clear', screening: 'clear', verify: 'unknown', provenBy: null, communityReports: null,
    });
  });

  it('still passes when Chainalysis was not asked (no key set)', () => {
    expect(summarize(walletResult({ coverage: { chainalysis: 'skipped' } })).result).toBe('pass');
    expect(summarize(walletResult({ coverage: { chainalysis: 'ran' } })).result).toBe('pass');
  });

  it('shows community reports without letting them change the pill, as the public checker does', () => {
    const r = summarize(walletResult({ chainabuseReports: 7 }));
    expect(r.result).toBe('pass');
    expect(r.communityReports).toBe(7);
  });

  it('does not need the honeypot source: it tests tokens, and says nothing about a wallet or a multisig', () => {
    expect(summarize(walletResult({ coverage: { honeypot: 'error' } })).result).toBe('pass');
    expect(summarize(walletResult({ coverage: { honeypot: 'skipped' } })).result).toBe('pass');
  });
});

describe('summarizeChecks: sanctions', () => {
  it('fails on a sanctions hit, and lists it first', () => {
    const r = summarize(walletResult({ flags: { sanctioned: true, phishing: true } }));
    expect(r.result).toBe('fail');
    expect(r.sanctions).toBe('hit');
    expect(r.hits).toEqual(['sanctioned', 'phishing']);
  });

  it('fails on a hit even when the sanctions lookups errored: a hit is never cleared', () => {
    const r = summarize(walletResult({ flags: { sanctioned: true }, coverage: { sanctions: 'error', chainalysis: 'error' } }));
    expect(r.result).toBe('fail');
    expect(r.sanctions).toBe('hit');
  });

  // The fail-safe: a sanctions lookup that failed is a check that did not run.
  describe.each([
    ['the OFAC mirror could not be read', { sanctions: 'error' as const }],
    ['the OFAC mirror has no answer on record', { sanctions: undefined }],
    ['Chainalysis was asked and did not answer', { sanctions: 'ran' as const, chainalysis: 'error' as const }],
    ['both lookups failed', { sanctions: 'error' as const, chainalysis: 'error' as const }],
  ])('when %s', (_why, coverage) => {
    it('is Limited, never a Pass', () => {
      const r = summarize(walletResult({ coverage }));
      expect(r.result).toBe('limited');
      expect(r.sanctions).toBe('unavailable');
      expect(r.limits).toContain('sanctions');
      expect(r.hits).toEqual([]);
      expect(r.result).not.toBe('pass');
    });
  });

  it('is Limited when the public checker could not be reached at all', () => {
    const r = summarize(null);
    expect(r.result).toBe('limited');
    expect(r.limits).toEqual(['sanctions', 'screening']);
    expect(r.sanctions).toBe('unavailable');
    expect(r.screening).toBe('unavailable');
  });

  it('is Limited for an answer in a shape it does not recognize', () => {
    const odd = { flags: undefined, coverage: undefined } as unknown as ReturnType<typeof walletResult>;
    const r = summarize(odd);
    expect(r.result).toBe('limited');
    expect(r.limits).toEqual(['sanctions', 'screening']);
  });
});

describe('summarizeChecks: screening', () => {
  it.each(SECURITY_FLAGS)('fails on the %s flag', (flag) => {
    const r = summarize(walletResult({ flags: { [flag]: true } }));
    expect(r.result).toBe('fail');
    expect(r.screening).toBe('hit');
    expect(r.hits).toEqual([flag]);
  });

  it('lists every flag that fired, in a fixed order', () => {
    const r = summarize(walletResult({ flags: { mixer: true, blacklisted: true, cybercrime: true } }));
    expect(r.hits).toEqual(['blacklisted', 'cybercrime', 'mixer']);
  });

  it('a flag in a partial answer is still a hit: GoPlus errored but said something', () => {
    const r = summarize(walletResult({ flags: { phishing: true }, coverage: { goplus: 'error' } }));
    expect(r.result).toBe('fail');
    expect(r.screening).toBe('hit');
  });

  it.each(['error', 'skipped'] as const)('is Limited, never a Pass, when the screening source is %s', (goplus) => {
    const r = summarize(walletResult({ coverage: { goplus } }));
    expect(r.result).toBe('limited');
    expect(r.screening).toBe('unavailable');
    expect(r.limits).toEqual(['screening']);
  });
});

describe('summarizeChecks: the Verify registry', () => {
  it('shows a domain-anchored address as proven, with the domain that vouches for it', () => {
    const r = summarize(walletResult(), { level: 'verified', domain: 'example.test', claimedElsewhere: false });
    expect(r.result).toBe('pass');
    expect(r.verify).toBe('proven');
    expect(r.provenBy).toBe('example.test');
  });

  it('does not fail a proven address just because another account holds the proof (that is what proven means)', () => {
    const r = summarize(walletResult(), { level: 'verified', domain: 'example.test', claimedElsewhere: true });
    expect(r.result).toBe('pass');
    expect(r.hits).toEqual([]);
  });

  it('fails an address another account proved control of with no domain behind it (claimed elsewhere)', () => {
    const r = summarize(walletResult(), { level: 'claimed', domain: null, claimedElsewhere: true });
    expect(r.result).toBe('fail');
    expect(r.verify).toBe('claimed');
    expect(r.hits).toEqual(['claimedElsewhere']);
  });

  it('fails when another account holds it even if the public lookup shows no record (the two disagree: assume the claim)', () => {
    const r = summarize(walletResult(), { level: null, domain: null, claimedElsewhere: true });
    expect(r.result).toBe('fail');
    expect(r.hits).toEqual(['claimedElsewhere']);
  });

  it('does not fail the owner own control-only claim (not elsewhere)', () => {
    const r = summarize(walletResult(), { level: 'claimed', domain: null, claimedElsewhere: false });
    expect(r.result).toBe('pass');
    expect(r.verify).toBe('claimed');
  });

  it('says unknown when Verify has no record', () => {
    expect(summarize(walletResult()).verify).toBe('unknown');
  });

  it('is Limited, never a Pass, when the Verify lookup failed', () => {
    const r = summarize(walletResult(), null);
    expect(r.result).toBe('limited');
    expect(r.verify).toBe('unavailable');
    expect(r.limits).toEqual(['verify']);
  });
});

describe('summarizeChecks: putting it together', () => {
  it('a hit outranks a check that could not run', () => {
    const r = summarize(walletResult({ flags: { sanctioned: true } }), null);
    expect(r.result).toBe('fail');
    expect(r.limits).toEqual(['verify']);
  });

  it('lists what could not run in a fixed order', () => {
    const r = summarize(walletResult({ coverage: { sanctions: 'error', goplus: 'error' } }), null);
    expect(r.limits).toEqual(['sanctions', 'screening', 'verify']);
  });

  it('only ever yields one of three pills', () => {
    const results = new Set<TrustResult>();
    for (const flags of [{}, { phishing: true }]) {
      for (const coverage of [{}, { goplus: 'error' as const }]) {
        results.add(summarize(walletResult({ flags, coverage })).result);
      }
    }
    expect([...results].sort()).toEqual(['fail', 'limited', 'pass']);
  });
});

describe('nextTrustStatus: the flag is a ratchet', () => {
  const statuses: Array<TrustStatus | null> = [null, 'pending', 'trusted', 'flagged'];

  it.each(statuses)('a Fail flags it, from %s', (previous) => {
    expect(nextTrustStatus(previous, { result: 'fail' })).toBe('flagged');
  });

  it.each(['pass', 'limited'] as const)('a flagged destination stays flagged on a %s', (result) => {
    expect(nextTrustStatus('flagged', { result })).toBe('flagged');
  });

  it.each([null, 'pending', 'trusted'] as const)('a Pass trusts it, from %s', (previous) => {
    expect(nextTrustStatus(previous, { result: 'pass' })).toBe('trusted');
  });

  it.each([null, 'pending', 'trusted'] as const)('a check that could not run leaves it pending, from %s: nothing is claimed', (previous) => {
    expect(nextTrustStatus(previous, { result: 'limited' })).toBe('pending');
  });
});

describe('statusFromStored', () => {
  it('keeps the three statuses', () => {
    for (const s of TRUST_STATUSES) expect(statusFromStored(s)).toBe(s);
  });

  it('reads anything else as pending: a damaged value is never read as trusted', () => {
    for (const bad of ['TRUSTED', 'trusted ', 'safe', '', null, undefined, 1, {}]) expect(statusFromStored(bad)).toBe('pending');
  });
});

describe('parseReadout', () => {
  const readout = summarize(walletResult({ flags: { phishing: true }, chainabuseReports: 2 }), { level: 'verified', domain: 'example.test', claimedElsewhere: false });

  it('round-trips what summarizeChecks wrote', () => {
    expect(parseReadout(JSON.stringify(readout))).toEqual(readout);
  });

  it('is null for nothing, for text that is not JSON, and for JSON that is not a readout', () => {
    for (const bad of [null, undefined, '', 'not json', '[]', '{}', '"x"', '123', JSON.stringify({ ...readout, v: 2 }), JSON.stringify({ ...readout, result: 'safe' })]) {
      expect(parseReadout(bad), String(bad)).toBeNull();
    }
  });

  it('is null when a code is one this code never writes', () => {
    expect(parseReadout(JSON.stringify({ ...readout, hits: ['trusted-by-me'] }))).toBeNull();
    expect(parseReadout(JSON.stringify({ ...readout, limits: ['everything'] }))).toBeNull();
    expect(parseReadout(JSON.stringify({ ...readout, sanctions: 'ok' }))).toBeNull();
    expect(parseReadout(JSON.stringify({ ...readout, verify: 'yes' }))).toBeNull();
  });

  it('passes on nothing it does not recognize', () => {
    const parsed = parseReadout(JSON.stringify({ ...readout, tenantId: 'secret', extra: true }));
    expect(parsed).toEqual(readout);
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });
});
