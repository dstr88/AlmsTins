import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isVerifyFirstRun, isPlatformAccount, proveGuideFor } from '../../src/lib/verifyFirstRun';

/**
 * Verify first run, Part C: the rule that decides who meets the first-run card
 * (src/lib/verifyFirstRun.ts), the facts it is asked with (src/lib/verifyFirstRunFacts.ts), and
 * what the screen says right after the first registration (proveGuideFor).
 *
 * No database: the registry and the platform-list reads are stubbed.
 */

const listDestinations = vi.fn();
const listEntities = vi.fn();
const canPublishEntities = vi.fn();
vi.mock('@/lib/verifyRegistry', () => ({ listDestinations: (...a: unknown[]) => listDestinations(...a) }));
vi.mock('@/lib/verifyEntities', () => ({ listEntities: (...a: unknown[]) => listEntities(...a) }));
vi.mock('@/lib/verifyEntityAccess', () => ({ canPublishEntities: (...a: unknown[]) => canPublishEntities(...a) }));

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const facts = (over: Partial<Parameters<typeof isVerifyFirstRun>[0]> = {}) =>
  ({ isDemo: false, destinationCount: 0, platformAccount: false, ...over });

describe('isVerifyFirstRun: an account with no destination of either kind', () => {
  it('is first-run with no destination', () => {
    expect(isVerifyFirstRun(facts())).toBe(true);
  });

  it.each([1, 2, 3, 50])('is not first-run with %i destinations', (n) => {
    expect(isVerifyFirstRun(facts({ destinationCount: n }))).toBe(false);
  });

  it('the demo is never first-run, even with nothing seeded', () => {
    expect(isVerifyFirstRun(facts({ isDemo: true }))).toBe(false);
    expect(isVerifyFirstRun(facts({ isDemo: true, destinationCount: null }))).toBe(false);
  });

  it('a platform account is never first-run: its list controls stay on the dashboard', () => {
    expect(isVerifyFirstRun(facts({ platformAccount: true }))).toBe(false);
  });

  it('an account whose destinations could not be read gets the dashboard, not the card', () => {
    expect(isVerifyFirstRun(facts({ destinationCount: null }))).toBe(false);
  });
});

describe('isPlatformAccount', () => {
  it('approved for platform lists, or already holding one', () => {
    expect(isPlatformAccount({ approved: false, listCount: 0 })).toBe(false);
    expect(isPlatformAccount({ approved: true, listCount: 0 })).toBe(true);
    expect(isPlatformAccount({ approved: false, listCount: 1 })).toBe(true);
  });
});

describe('loadVerifyFirstRunFacts: what the page reads for one session', () => {
  beforeEach(() => {
    listDestinations.mockReset();
    listEntities.mockReset();
    canPublishEntities.mockReset();
    canPublishEntities.mockReturnValue(false);
    listEntities.mockResolvedValue([]);
  });
  const load = async (session: { tenantId: string; isDemo?: boolean }) =>
    (await import('../../src/lib/verifyFirstRunFacts')).loadVerifyFirstRunFacts(session);

  it('an empty account: no destination, not a platform account, so first-run', async () => {
    listDestinations.mockResolvedValue([]);
    const f = await load({ tenantId: 'tenant-empty' });
    expect(f).toEqual({ isDemo: false, destinationCount: 0, platformAccount: false });
    expect(isVerifyFirstRun(f)).toBe(true);
    expect(listDestinations).toHaveBeenCalledWith('tenant-empty');
  });

  it('counts a payment link like an address: one destination of either kind ends first-run', async () => {
    listDestinations.mockResolvedValue([{ id: 'q1', kind: 'qr' }]);
    const f = await load({ tenantId: 'tenant-link' });
    expect(f.destinationCount).toBe(1);
    expect(isVerifyFirstRun(f)).toBe(false);
  });

  it('an account that holds a platform list, or is approved for one, is a platform account', async () => {
    listDestinations.mockResolvedValue([]);
    listEntities.mockResolvedValue([{ id: 'e1' }]);
    expect(isVerifyFirstRun(await load({ tenantId: 'tenant-list' }))).toBe(false);
    listEntities.mockResolvedValue([]);
    canPublishEntities.mockReturnValue(true);
    expect(isVerifyFirstRun(await load({ tenantId: 'tenant-approved' }))).toBe(false);
  });

  it('the demo is answered without reading anything', async () => {
    const f = await load({ tenantId: 'demo-tenant', isDemo: true });
    expect(f.isDemo).toBe(true);
    expect(isVerifyFirstRun(f)).toBe(false);
    expect(listDestinations).not.toHaveBeenCalled();
    expect(listEntities).not.toHaveBeenCalled();
  });

  it('a failed read answers unknown, which is not first-run', async () => {
    listDestinations.mockRejectedValue(new Error('database unavailable'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = await load({ tenantId: 'tenant-broken' });
    quiet.mockRestore();
    expect(f.destinationCount).toBeNull();
    expect(isVerifyFirstRun(f)).toBe(false);
  });
});

describe('proveGuideFor: the two proving steps of a just-registered address', () => {
  it('a registered address: claim it next, and the website file is open from the start', () => {
    expect(proveGuideFor({ kind: 'address', proofStatus: 'unproven', verified: false }))
      .toEqual({ kind: 'address', claim: 'next', list: 'open' });
  });

  it('a claimed address: step 1 is done, the website file is next', () => {
    expect(proveGuideFor({ kind: 'address', proofStatus: 'proven', verified: false }))
      .toEqual({ kind: 'address', claim: 'done', list: 'next' });
  });

  it('a verified address has nothing left to do', () => {
    expect(proveGuideFor({ kind: 'address', proofStatus: 'proven', verified: true })).toBeNull();
  });

  it('a lapsed address starts over at step 1', () => {
    expect(proveGuideFor({ kind: 'address', proofStatus: 'lapsed', verified: false }))
      .toEqual({ kind: 'address', claim: 'next', list: 'open' });
  });

  it('a payment link or QR has no proving step of its own', () => {
    expect(proveGuideFor({ kind: 'qr', proofStatus: 'unproven', verified: false })).toEqual({ kind: 'qr' });
  });
});

describe('the code facts the guide is worded from', () => {
  it('a website file proves an address that never took the satoshi test (so step 2 is open from the start)', async () => {
    const { decideAnchor } = await import('../../src/lib/verifyAnchor');
    const unproven = { kind: 'address', proofStatus: 'unproven', proofMethod: 'none', proofDomain: null, provenAt: null, domainAnchoredAt: null, legacyUnbound: false };
    expect(decideAnchor(unproven, 'shop.example', true)).toBe('flip');
  });

  it('losing the file drops a satoshi-tested address to Claimed, and a file-only one to Lapsed', async () => {
    const { decideAnchorLoss } = await import('../../src/lib/verifyAnchor');
    expect(decideAnchorLoss('micro_deposit')).toBe('unanchor');
    expect(decideAnchorLoss('well_known')).toBe('lapse');
  });
});

describe('one place decides it', () => {
  it('the page and the island both ask src/lib/verifyFirstRun.ts', () => {
    const page = read('src/pages/dashboard/verify.astro');
    const island = read('src/components/verify/VerifyDashboard.tsx');
    expect(page).toContain("import { isVerifyFirstRun } from '@/lib/verifyFirstRun'");
    expect(page).toContain('isVerifyFirstRun(firstRunFacts)');
    expect(page).toContain('{!firstRun && <div class="hero-bleed">');
    expect(island).toContain("import { isVerifyFirstRun, proveGuideFor } from '@/lib/verifyFirstRun'");
    expect(island.match(/isVerifyFirstRun\(/g)).toHaveLength(1);
  });

  it('nothing else compares a destination count to zero to pick the screen', () => {
    const island = read('src/components/verify/VerifyDashboard.tsx');
    expect(island).not.toMatch(/destinations\.length === 0/);
    expect(read('src/pages/dashboard/verify.astro')).not.toMatch(/destinationCount === 0/);
  });
});
