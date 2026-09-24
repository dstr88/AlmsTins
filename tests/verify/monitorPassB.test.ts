import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The watchman's Pass B wiring: once a proven domain's file still validates, the cron hands the
 * anchored addresses and the file's current listing to recheckDomainListing (which releases what
 * was dropped or leans only on a legacy self-send claim, and re-confirms the rest; see
 * claimCanonical.test.ts), alerts on the dropped ones only, and never re-confirms anything
 * itself. If that settle step fails, the domain counts as an error and nothing else is written
 * for it, so its anchors lapse to Claimed at the max-stale TTL.
 * No database: the registry, the proof fetch and the mailer are stand-ins.
 */

const reg = vi.hoisted(() => ({
  proven: [] as Array<{ id: string; value: string; proofMethod: string }>,
  recheck: vi.fn(),
  markDestinationsConfirmed: vi.fn(async () => {}),
  releaseDomainAnchor: vi.fn(async () => {}),
  markDomainProofRechecked: vi.fn(async () => {}),
  markDomainProofFailed: vi.fn(async () => {}),
}));
const sendMail = vi.hoisted(() => vi.fn(async (_m: unknown) => {}));

vi.mock('@/lib/verifyRegistry', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/verifyRegistry')>();
  return {
    ...orig,
    ensureVerifyTables: async () => {},
    listProvenDomainsForMonitor: async () => [{ tenantId: 'merchant', domain: 'merchant.example', challenge: 'c' }],
    getProvenAddressDestinations: async () => reg.proven,
    recheckDomainListing: reg.recheck,
    markDestinationsConfirmed: reg.markDestinationsConfirmed,
    releaseDomainAnchor: reg.releaseDomainAnchor,
    markDomainProofRechecked: reg.markDomainProofRechecked,
    markDomainProofFailed: reg.markDomainProofFailed,
    listMonitoredDestinations: async () => [],
  };
});
vi.mock('@/lib/verifyProof', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/verifyProof')>();
  return { ...orig, verifyDomainProof: async () => ({ ok: true as const, addresses: ['BC1QLISTED'] }) };
});
vi.mock('@/lib/verifyEntities', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/verifyEntities')>();
  return { ...orig, listEntitiesForMonitor: async () => [] };
});
vi.mock('@/lib/email', () => ({ sendMail }));
vi.mock('@/lib/i18n/userLang', () => ({ ensureUserLangColumn: async () => {} }));
vi.mock('@/lib/cronHeartbeat', () => ({ recordCronSuccess: async () => {} }));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string }) => {
      const sql = stmt.sql.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT au.alert_email, au.lang')) return { rows: [{ alert_email: 'owner@shop.test', lang: 'en' }] };
      if (/^(CREATE|ALTER)\b/.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL in test: ${sql}`);
    },
  },
}));

import { GET as MONITOR } from '../../src/pages/api/cron/verify-monitor';

async function run() {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const res = await MONITOR({
      request: new Request('https://almstins.com/api/cron/verify-monitor', { headers: { 'x-cron-secret': 'test-secret' } }),
    } as never);
    expect(res.status).toBe(200);
    return await res.json();
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  reg.proven = [
    { id: 'dropped', value: 'bc1qdropped', proofMethod: 'well_known' },
    { id: 'copy', value: 'bc1qlisted', proofMethod: 'well_known' },
    { id: 'kept', value: '0xabc', proofMethod: 'micro_deposit' },
  ];
});

describe('verify-monitor Pass B', () => {
  it('settles the listing through recheckDomainListing and alerts on dropped addresses only', async () => {
    reg.recheck.mockResolvedValue({
      missing: [reg.proven[0]], legacyHeld: [reg.proven[1]], confirmed: ['kept'],
    });
    const body = await run();
    expect(reg.recheck).toHaveBeenCalledWith('merchant', 'merchant.example', reg.proven, ['BC1QLISTED']);
    // The cron neither re-confirms nor releases anything on its own.
    expect(reg.markDestinationsConfirmed).not.toHaveBeenCalled();
    expect(reg.releaseDomainAnchor).not.toHaveBeenCalled();
    expect(reg.markDomainProofRechecked).toHaveBeenCalledWith('merchant', 'merchant.example');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = sendMail.mock.calls[0][0] as { to: string; text: string };
    expect(mail.to).toBe('owner@shop.test');
    expect(mail.text).toContain('bc1qdropped');
    expect(mail.text).not.toContain('bc1qlisted');
    expect(body.merchant).toMatchObject({ checked: 1, addressDroppedAlerts: 1, errors: 0 });
  }, 10_000);

  it('a settle step that cannot read the legacy claims writes nothing else for the domain', async () => {
    reg.recheck.mockRejectedValue(new Error('connection reset'));
    const body = await run();
    expect(reg.markDestinationsConfirmed).not.toHaveBeenCalled();
    expect(reg.markDomainProofRechecked).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(body.merchant).toMatchObject({ checked: 1, errors: 1 });
  }, 10_000);
});
