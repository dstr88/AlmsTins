import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The runner behind Add + Trust, and the default wiring to the checks the app already has:
 * checkWallet (walletChecker.ts), lookupVerifiedAddress (verifyEntities.ts) and isClaimedElsewhere
 * (verifyRegistry.ts). Those three modules are replaced, so there is no network and no database;
 * every address is an invented filler.
 */
const mocks = vi.hoisted(() => ({
  checkWallet: vi.fn(),
  getCached: vi.fn(),
  setCache: vi.fn(),
  lookupVerifiedAddress: vi.fn(),
  isClaimedElsewhere: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { execute: async () => { throw new Error('the checks must not touch the database directly'); } },
}));
vi.mock('@/lib/walletChecker', () => ({ checkWallet: mocks.checkWallet, getCached: mocks.getCached, setCache: mocks.setCache }));
vi.mock('@/lib/verifyEntities', () => ({ lookupVerifiedAddress: mocks.lookupVerifiedAddress }));
vi.mock('@/lib/verifyRegistry', () => ({ isClaimedElsewhere: mocks.isClaimedElsewhere }));

import { CHECK_CONCURRENCY, defaultTrustDeps, forgetAnswers, forgetAnswersOf, isCompleteAnswer, REMEMBER_MAX, REMEMBER_MS, runTrustChecks } from '../../src/lib/agentVault/trustChecks';
import { defaultCheckBudget } from '../../src/lib/agentVault/checkBudget';
import { addr, fakeDeps, walletResult } from '../helpers/agentVault';

const ROOT = path.resolve(__dirname, '../..');
const TENANT = 'tenant-a';

beforeEach(() => {
  forgetAnswers();
  mocks.checkWallet.mockReset();
  mocks.getCached.mockReset();
  mocks.getCached.mockReturnValue(null);
  mocks.setCache.mockReset();
  mocks.lookupVerifiedAddress.mockReset();
  mocks.isClaimedElsewhere.mockReset();
});

describe('runTrustChecks', () => {
  it('returns one readout per distinct address, keyed by the address, and checks each only once', async () => {
    const deps = fakeDeps();
    const out = await runTrustChecks(TENANT, [addr(1), addr(2), addr(1)], deps);
    expect([...out.keys()].sort()).toEqual([addr(1), addr(2)]);
    expect(deps.calls.wallet.slice().sort()).toEqual([addr(1), addr(2)]);
    expect(out.get(addr(1))?.result).toBe('pass');
  });

  it('asks Verify as this tenant', async () => {
    const deps = fakeDeps();
    await runTrustChecks('tenant-z', [addr(1)], deps);
    expect(deps.calls.verify).toEqual([{ tenantId: 'tenant-z', address: addr(1) }]);
  });

  it('stamps the readout with the clock it was given', async () => {
    const deps = fakeDeps();
    const out = await runTrustChecks(TENANT, [addr(1)], deps);
    expect(out.get(addr(1))?.checkedAt).toBe('2026-10-01T12:00:00.000Z');
  });

  it('checks a few addresses at a time, never more than the bound', async () => {
    const deps = fakeDeps();
    const many = Array.from({ length: 12 }, (_, i) => addr(i + 1));
    const out = await runTrustChecks(TENANT, many, deps);
    expect(out.size).toBe(12);
    expect(deps.inFlight.max).toBeGreaterThan(1);
    expect(deps.inFlight.max).toBeLessThanOrEqual(CHECK_CONCURRENCY);
  });

  it('does nothing for no addresses', async () => {
    const deps = fakeDeps();
    expect((await runTrustChecks(TENANT, [], deps)).size).toBe(0);
    expect(deps.calls.wallet).toEqual([]);
  });

  it('a public checker that throws leaves that address Limited, and the others unharmed', async () => {
    const deps = fakeDeps();
    deps.wallets[addr(1)] = new Error('upstream down');
    const out = await runTrustChecks(TENANT, [addr(1), addr(2)], deps);
    expect(out.get(addr(1))?.result).toBe('limited');
    expect(out.get(addr(1))?.limits).toEqual(['sanctions', 'screening']);
    expect(out.get(addr(2))?.result).toBe('pass');
  });

  it('a Verify lookup that throws leaves the address Limited, never a Pass', async () => {
    const deps = fakeDeps();
    deps.verifies[addr(1)] = new Error('database unavailable');
    const out = await runTrustChecks(TENANT, [addr(1)], deps);
    expect(out.get(addr(1))?.result).toBe('limited');
    expect(out.get(addr(1))?.verify).toBe('unavailable');
  });

  it('an answer it cannot read is a check that did not run', async () => {
    const deps = fakeDeps();
    deps.wallets[addr(1)] = {} as never;
    deps.verifies[addr(1)] = 'nonsense' as never;
    deps.verifies[addr(2)] = { level: null } as never;
    deps.verifies[addr(3)] = { level: 'trusted-by-me', domain: null, claimedElsewhere: false } as never;
    const out = await runTrustChecks(TENANT, [addr(1), addr(2), addr(3)], deps);
    expect(out.get(addr(1))?.result).toBe('limited');
    expect(out.get(addr(1))?.limits).toEqual(['sanctions', 'screening', 'verify']);
    for (const a of [addr(2), addr(3)]) {
      expect(out.get(a)?.result, a).toBe('limited');
      expect(out.get(a)?.limits, a).toEqual(['verify']);
    }
  });

  it('never throws, and never reports an address it logged: it logs nothing', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const deps = fakeDeps();
    deps.wallets[addr(1)] = new Error(`boom ${addr(1)}`);
    await expect(runTrustChecks(TENANT, [addr(1)], deps)).resolves.toBeInstanceOf(Map);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
  });
});

describe('the default checks are the ones the app already has', () => {
  it('asks checkWallet about the address', async () => {
    mocks.checkWallet.mockResolvedValue(walletResult({ flags: { phishing: true } }));
    const answer = await defaultTrustDeps.wallet(addr(1));
    expect(mocks.checkWallet).toHaveBeenCalledWith(addr(1));
    expect(answer.flags.phishing).toBe(true);
  });

  it('asks the Verify registry the way the pre-send check does, and the claim guard as this tenant', async () => {
    mocks.lookupVerifiedAddress.mockResolvedValue(null);
    mocks.isClaimedElsewhere.mockResolvedValue(false);
    const answer = await defaultTrustDeps.verify(TENANT, addr(1));
    expect(mocks.lookupVerifiedAddress).toHaveBeenCalledWith(addr(1));
    expect(mocks.isClaimedElsewhere).toHaveBeenCalledWith(TENANT, 'address', addr(1));
    expect(answer).toEqual({ level: null, domain: null, claimedElsewhere: false });
  });

  it('reads a domain-anchored address as verified, with the domain that vouches for it', async () => {
    mocks.lookupVerifiedAddress.mockResolvedValue({
      source: 'merchant', level: 'verified', since: '2026-01-01', domain: 'display.example.test', provingDomain: 'proof.example.test', label: null, chain: 'ethereum',
    });
    mocks.isClaimedElsewhere.mockResolvedValue(true);
    expect(await defaultTrustDeps.verify(TENANT, addr(1))).toEqual({ level: 'verified', domain: 'proof.example.test', claimedElsewhere: true });
  });

  it('reads a control-only claim as claimed, with no domain', async () => {
    mocks.lookupVerifiedAddress.mockResolvedValue({
      source: 'merchant', level: 'claimed', since: null, domain: null, provingDomain: null, label: null, chain: 'ethereum',
    });
    mocks.isClaimedElsewhere.mockResolvedValue(true);
    expect(await defaultTrustDeps.verify(TENANT, addr(1))).toEqual({ level: 'claimed', domain: null, claimedElsewhere: true });
  });

  it('end to end: sanctioned is Fail, an address another account claimed without a domain is Fail, a clean one Passes', async () => {
    const byAddress = new Map([
      [addr(1), walletResult({ flags: { sanctioned: true } })],
      [addr(2), walletResult()],
      [addr(3), walletResult()],
    ]);
    mocks.checkWallet.mockImplementation(async (a: string) => byAddress.get(a));
    mocks.lookupVerifiedAddress.mockImplementation(async (a: string) =>
      a === addr(2) ? { source: 'merchant', level: 'claimed', since: null, domain: null, provingDomain: null, label: null, chain: 'ethereum' } : null);
    mocks.isClaimedElsewhere.mockImplementation(async (_t: string, _k: string, a: string) => a === addr(2));
    const out = await runTrustChecks(TENANT, [addr(1), addr(2), addr(3)], defaultTrustDeps);
    expect(out.get(addr(1))?.hits).toEqual(['sanctioned']);
    expect(out.get(addr(2))?.hits).toEqual(['claimedElsewhere']);
    expect(out.get(addr(3))?.result).toBe('pass');
  });

  it('answers from the public checker\'s cache when it holds a complete answer, and does not ask again', async () => {
    const kept = walletResult({ flags: { phishing: true } });
    mocks.getCached.mockReturnValue(kept);
    expect(await defaultTrustDeps.wallet(addr(1))).toBe(kept);
    expect(mocks.getCached).toHaveBeenCalledWith(addr(1));
    expect(mocks.checkWallet).not.toHaveBeenCalled();
    expect(mocks.setCache).not.toHaveBeenCalled();
  });

  it('never reuses a cached answer that is missing a source: it asks again, so "Check again" is a real check', async () => {
    const partial = walletResult({ coverage: { goplus: 'error' } });
    mocks.getCached.mockReturnValue(partial);
    const fresh = walletResult();
    mocks.checkWallet.mockResolvedValue(fresh);
    expect(await defaultTrustDeps.wallet(addr(1))).toBe(fresh);
    expect(mocks.checkWallet).toHaveBeenCalledTimes(1);
  });

  it('remembers a complete answer in the Vault\'s own memory, so the next look does not ask again', async () => {
    mocks.checkWallet.mockResolvedValue(walletResult());
    await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT });
    await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT });
    await defaultTrustDeps.wallet(addr(2), { tenantId: TENANT });
    expect(mocks.checkWallet.mock.calls.map((c) => c[0])).toEqual([addr(1), addr(2)]);
  });

  it('asks again when a person asks to check again: fresh ignores what is remembered and what the public checker holds, and the new answer is remembered', async () => {
    mocks.getCached.mockReturnValue(walletResult({ flags: { phishing: true } }));
    mocks.checkWallet.mockResolvedValue(walletResult());
    await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT }); // an add: the public checker's answer is used
    expect(mocks.checkWallet).not.toHaveBeenCalled();
    const fresh = await defaultTrustDeps.wallet(addr(1), { fresh: true, tenantId: TENANT });
    expect(mocks.checkWallet).toHaveBeenCalledTimes(1);
    expect(fresh.flags.phishing).toBe(false); // the new screening, not the cached one
    // The memory now holds the new answer (made together with the public one, so the account's own is kept).
    const next = await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT });
    expect(next).toBe(fresh);
    expect(mocks.checkWallet).toHaveBeenCalledTimes(1);
    // A second fresh look asks again, however recent the last was.
    await defaultTrustDeps.wallet(addr(1), { fresh: true, tenantId: TENANT });
    expect(mocks.checkWallet).toHaveBeenCalledTimes(2);
  });

  it('hands `fresh` to the checks only when it was asked for, and always says whose check it is', async () => {
    const asked = fakeDeps();
    await runTrustChecks(TENANT, [addr(1), addr(2)], asked, { fresh: true });
    expect(asked.calls.fresh.sort()).toEqual([addr(1), addr(2)]);
    expect(asked.calls.tenants).toEqual([TENANT, TENANT]);
    const added = fakeDeps();
    await runTrustChecks(TENANT, [addr(1), addr(2)], added);
    expect(added.calls.fresh).toEqual([]);
    expect(added.calls.tenants).toEqual([TENANT, TENANT]);
  });

  it('never writes the public checker\'s cache: anyone can read it through /api/wallet-check, and it says when an address was checked', async () => {
    mocks.checkWallet.mockResolvedValue(walletResult());
    await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT });
    await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT });
    expect(mocks.setCache).not.toHaveBeenCalled();
    // And the module does not even reach for the writer.
    expect(readFileSync(path.join(ROOT, 'src/lib/agentVault/trustChecks.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\bsetCache\b/);
  });

  it('never remembers a limited answer: it is asked for again each time', async () => {
    for (const coverage of [{ sanctions: 'error' as const }, { chainalysis: 'error' as const }, { goplus: 'skipped' as const }]) {
      forgetAnswers();
      mocks.checkWallet.mockReset();
      mocks.checkWallet.mockResolvedValue(walletResult({ coverage }));
      await defaultTrustDeps.wallet(addr(3), { tenantId: TENANT });
      await defaultTrustDeps.wallet(addr(3), { tenantId: TENANT });
      expect(mocks.checkWallet, JSON.stringify(coverage)).toHaveBeenCalledTimes(2);
    }
  });

  it('forgets an answer after five minutes, and not before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
      mocks.checkWallet.mockResolvedValue(walletResult());
      await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT });
      vi.setSystemTime(new Date(Date.parse('2026-10-18T12:00:00.000Z') + REMEMBER_MS - 1));
      await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT });
      expect(mocks.checkWallet).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date(Date.parse('2026-10-18T12:00:00.000Z') + REMEMBER_MS));
      await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT });
      expect(mocks.checkWallet).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remembers at most 500 answers, dropping the oldest, so rotating addresses cannot grow it without limit', async () => {
    expect(REMEMBER_MAX).toBe(500);
    mocks.checkWallet.mockResolvedValue(walletResult());
    for (let i = 0; i < REMEMBER_MAX + 5; i += 1) await defaultTrustDeps.wallet(addr(i), { tenantId: TENANT });
    mocks.checkWallet.mockClear();
    await defaultTrustDeps.wallet(addr(REMEMBER_MAX + 4), { tenantId: TENANT }); // the newest is still remembered
    expect(mocks.checkWallet).not.toHaveBeenCalled();
    await defaultTrustDeps.wallet(addr(0), { tenantId: TENANT }); // the oldest was dropped
    expect(mocks.checkWallet).toHaveBeenCalledTimes(1);
  });

  it('remembers for each account: another account asking for the same address gets a screening of its own, never the time of the first', async () => {
    const first = walletResult({ checkedAt: '2026-10-18T10:00:00.000Z' });
    const second = walletResult({ checkedAt: '2026-10-18T10:03:30.000Z' });
    mocks.checkWallet.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    expect(await defaultTrustDeps.wallet(addr(1), { tenantId: 'tenant-a' })).toBe(first);
    // Account B does not see that A looked, or when: its own screening is made, with its own time.
    expect(await defaultTrustDeps.wallet(addr(1), { tenantId: 'tenant-b' })).toBe(second);
    expect(mocks.checkWallet).toHaveBeenCalledTimes(2);
    // Each account's own answer is still its own.
    expect(await defaultTrustDeps.wallet(addr(1), { tenantId: 'tenant-a' })).toBe(first);
    expect(await defaultTrustDeps.wallet(addr(1), { tenantId: 'tenant-b' })).toBe(second);
    expect(mocks.checkWallet).toHaveBeenCalledTimes(2);
  });

  it('remembers nothing for a check that does not say whose it is, and reads nothing from memory for it', async () => {
    mocks.checkWallet.mockResolvedValue(walletResult());
    await defaultTrustDeps.wallet(addr(1));
    await defaultTrustDeps.wallet(addr(1));
    expect(mocks.checkWallet).toHaveBeenCalledTimes(2);
    await defaultTrustDeps.wallet(addr(2), { tenantId: TENANT }); // remembered for an account...
    await defaultTrustDeps.wallet(addr(2)); // ...and not for a check with none
    expect(mocks.checkWallet).toHaveBeenCalledTimes(4);
  });

  it('forgets what one account was told on request, and only that account\'s', async () => {
    mocks.checkWallet.mockResolvedValue(walletResult());
    await defaultTrustDeps.wallet(addr(1), { tenantId: 'tenant-a' });
    await defaultTrustDeps.wallet(addr(2), { tenantId: 'tenant-a' });
    await defaultTrustDeps.wallet(addr(1), { tenantId: 'tenant-b' });
    expect(mocks.checkWallet).toHaveBeenCalledTimes(3);
    forgetAnswersOf('tenant-a');
    await defaultTrustDeps.wallet(addr(1), { tenantId: 'tenant-b' }); // B's is kept
    expect(mocks.checkWallet).toHaveBeenCalledTimes(3);
    await defaultTrustDeps.wallet(addr(1), { tenantId: 'tenant-a' }); // A's is gone: a new screening
    await defaultTrustDeps.wallet(addr(2), { tenantId: 'tenant-a' });
    expect(mocks.checkWallet).toHaveBeenCalledTimes(5);
    // An account whose id begins the same way is not forgotten with it.
    await defaultTrustDeps.wallet(addr(3), { tenantId: 'tenant-ab' });
    forgetAnswersOf('tenant-a');
    await defaultTrustDeps.wallet(addr(3), { tenantId: 'tenant-ab' });
    expect(mocks.checkWallet).toHaveBeenCalledTimes(6);
  });

  it('uses the newer of the account\'s own answer and the public checker\'s, and the account\'s own when they were made together', async () => {
    const own = walletResult({ checkedAt: '2026-10-18T12:00:00.000Z' });
    mocks.checkWallet.mockResolvedValue(own);
    await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT }); // remembered
    mocks.checkWallet.mockClear();
    const newerPublic = walletResult({ checkedAt: '2026-10-18T12:02:00.000Z', flags: { phishing: true } });
    mocks.getCached.mockReturnValue(newerPublic);
    expect(await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT })).toBe(newerPublic);
    const olderPublic = walletResult({ checkedAt: '2026-10-18T11:58:00.000Z', flags: { phishing: true } });
    mocks.getCached.mockReturnValue(olderPublic);
    expect(await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT })).toBe(own);
    mocks.getCached.mockReturnValue(walletResult({ checkedAt: '2026-10-18T12:00:00.000Z', flags: { phishing: true } }));
    expect(await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT })).toBe(own);
    // A public answer that is missing a source, or that does not say when it was made, never beats a complete one of the account's.
    mocks.getCached.mockReturnValue(walletResult({ checkedAt: '2026-10-18T12:04:00.000Z', coverage: { goplus: 'error' } }));
    expect(await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT })).toBe(own);
    mocks.getCached.mockReturnValue(walletResult({ checkedAt: 'last Tuesday' }));
    expect(await defaultTrustDeps.wallet(addr(1), { tenantId: TENANT })).toBe(own);
    expect(mocks.checkWallet).not.toHaveBeenCalled();
  });

  it('puts the time the screening was made on a readout, so an answer from memory says how old it is', async () => {
    const deps = fakeDeps(); // answers at 2026-10-01T12:00:00Z
    deps.wallets[addr(1)] = walletResult({ checkedAt: '2026-10-01T11:57:30.250Z' }); // screened two and a half minutes ago
    deps.wallets[addr(2)] = walletResult({ checkedAt: '2026-10-01T12:00:00.000Z' }); // screened just now
    deps.wallets[addr(3)] = walletResult({ checkedAt: '2026-10-01T12:05:00.000Z' }); // from the future: not believed
    deps.wallets[addr(4)] = walletResult({ checkedAt: 'last Tuesday' }); // not a time
    const out = await runTrustChecks(TENANT, [addr(1), addr(2), addr(3), addr(4)], deps);
    expect(out.get(addr(1))?.checkedAt).toBe('2026-10-01T11:57:30.250Z');
    expect(out.get(addr(2))?.checkedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(out.get(addr(3))?.checkedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(out.get(addr(4))?.checkedAt).toBe('2026-10-01T12:00:00.000Z');
  });

  it('says now when the screening could not be reached, because there is no screening time to say', async () => {
    const deps = fakeDeps();
    deps.wallets[addr(1)] = new Error('upstream down');
    expect((await runTrustChecks(TENANT, [addr(1)], deps)).get(addr(1))?.checkedAt).toBe('2026-10-01T12:00:00.000Z');
  });

  it('carries the one budget of checks the running server shares', () => {
    expect(defaultTrustDeps.budget).toBe(defaultCheckBudget);
  });

  it('end to end: when the checks throw, nothing passes', async () => {
    mocks.checkWallet.mockRejectedValue(new Error('network down'));
    mocks.lookupVerifiedAddress.mockRejectedValue(new Error('database down'));
    mocks.isClaimedElsewhere.mockRejectedValue(new Error('database down'));
    const out = await runTrustChecks(TENANT, [addr(1)], defaultTrustDeps);
    expect(out.get(addr(1))?.result).toBe('limited');
    expect(out.get(addr(1))?.limits).toEqual(['sanctions', 'screening', 'verify']);
  });
});

describe('isCompleteAnswer: what the Vault may remember for five minutes', () => {
  it('is an answer in which both the sanctions lists and the security screening ran', () => {
    expect(isCompleteAnswer(walletResult())).toBe(true);
    expect(isCompleteAnswer(walletResult({ coverage: { chainalysis: 'ran' } }))).toBe(true);
    expect(isCompleteAnswer(walletResult({ coverage: { chainalysis: 'skipped' } }))).toBe(true);
  });

  it('is not one in which a source failed or did not run', () => {
    for (const coverage of [
      { sanctions: 'error' as const },
      { goplus: 'error' as const },
      { goplus: 'skipped' as const },
      { chainalysis: 'error' as const },
    ]) expect(isCompleteAnswer(walletResult({ coverage })), JSON.stringify(coverage)).toBe(false);
  });

  it('is not an answer that says nothing about coverage, or no answer at all', () => {
    expect(isCompleteAnswer(null)).toBe(false);
    expect(isCompleteAnswer(undefined)).toBe(false);
    expect(isCompleteAnswer({ coverage: undefined } as never)).toBe(false);
    expect(isCompleteAnswer({ coverage: {} } as never)).toBe(false);
  });
});
