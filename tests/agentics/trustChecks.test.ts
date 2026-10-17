import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The runner behind Add + Trust, and the default wiring to the checks the app already has:
 * checkWallet (walletChecker.ts), lookupVerifiedAddress (verifyEntities.ts) and isClaimedElsewhere
 * (verifyRegistry.ts). Those three modules are replaced, so there is no network and no database;
 * every address is an invented filler.
 */
const mocks = vi.hoisted(() => ({
  checkWallet: vi.fn(),
  lookupVerifiedAddress: vi.fn(),
  isClaimedElsewhere: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { execute: async () => { throw new Error('the checks must not touch the database directly'); } },
}));
vi.mock('@/lib/walletChecker', () => ({ checkWallet: mocks.checkWallet }));
vi.mock('@/lib/verifyEntities', () => ({ lookupVerifiedAddress: mocks.lookupVerifiedAddress }));
vi.mock('@/lib/verifyRegistry', () => ({ isClaimedElsewhere: mocks.isClaimedElsewhere }));

import { CHECK_CONCURRENCY, defaultTrustDeps, runTrustChecks } from '../../src/lib/agentVault/trustChecks';
import { addr, fakeDeps, walletResult } from '../helpers/agentVault';

const TENANT = 'tenant-a';

beforeEach(() => {
  mocks.checkWallet.mockReset();
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

  it('end to end: when the checks throw, nothing passes', async () => {
    mocks.checkWallet.mockRejectedValue(new Error('network down'));
    mocks.lookupVerifiedAddress.mockRejectedValue(new Error('database down'));
    mocks.isClaimedElsewhere.mockRejectedValue(new Error('database down'));
    const out = await runTrustChecks(TENANT, [addr(1)], defaultTrustDeps);
    expect(out.get(addr(1))?.result).toBe('limited');
    expect(out.get(addr(1))?.limits).toEqual(['sanctions', 'screening', 'verify']);
  });
});
