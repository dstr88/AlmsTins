import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The watchman's Pass A after the cross-account guard (spec 3g) and its sweep (spec 3i). When a
 * pull newly marks entries as conflicts, the platform's recipient gets one email with the count,
 * and each merchant whose proof an entry collides with gets one email, once per run, that carries
 * no address, no label, no amount and no platform. No conflicts added: no email. The sweep runs
 * once per run and its count is in the body.
 * No database: the entities module, the registry and the mailer are stand-ins.
 */

const ent = vi.hoisted(() => ({
  targets: [] as Array<{ id: string; tenantId: string; domain: string; lastPullStatus: string | null }>,
  results: {} as Record<string, any>,
}));
const reg = vi.hoisted(() => ({
  holders: {} as Record<string, string[]>,
  swept: 0,
  sweepThrows: false,
}));
const sendMail = vi.hoisted(() => vi.fn(async (_m: unknown) => {}));
const recipients = vi.hoisted(() => ({} as Record<string, { email: string; lang: string }>));

vi.mock('@/lib/verifyEntities', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/verifyEntities')>();
  return {
    ...orig,
    listEntitiesForMonitor: async () => ent.targets,
    monitorEntity: async (_tenant: string, id: string) => ent.results[id],
  };
});
vi.mock('@/lib/verifyRegistry', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/lib/verifyRegistry')>();
  return {
    ...orig,
    ensureVerifyTables: async () => {},
    listProvenDomainsForMonitor: async () => [],
    listMonitoredDestinations: async () => [],
    provenHoldersOf: async (address: string) => reg.holders[address.toLowerCase()] ?? [],
    clearStalePlatformListed: async () => { if (reg.sweepThrows) throw new Error('db down'); return reg.swept; },
  };
});
vi.mock('@/lib/email', () => ({ sendMail }));
vi.mock('@/lib/i18n/userLang', () => ({ ensureUserLangColumn: async () => {} }));
vi.mock('@/lib/cronHeartbeat', () => ({ recordCronSuccess: async () => {} }));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => {
      const sql = stmt.sql.replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT COALESCE(au.alert_email, au.email)')) {
        const r = recipients[String(stmt.args?.[0])];
        return { rows: r ? [r] : [] };
      }
      if (/^(CREATE|ALTER)\b/.test(sql)) return { rows: [] };
      throw new Error(`unexpected SQL in test: ${sql}`);
    },
  },
}));

import { GET as MONITOR } from '../../src/pages/api/cron/verify-monitor';

const PLATFORM = 'tenant-platform';
const MERCHANT = 'tenant-merchant';
const MERCHANT_FR = 'tenant-merchant-fr';
const SHARED = '0x' + 'ab'.repeat(20);
const SECOND = '0x' + 'cd'.repeat(20);

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

const mails = () => sendMail.mock.calls.map((c) => c[0] as { to: string; subject: string; text: string });
const okPull = (over: Partial<{ removed: string[]; added: string[]; conflicts: { added: string[]; cleared: string[] } }> = {}) => ({
  pull: { ok: true, count: 2, conflicts: over.conflicts?.added.length ?? 0 },
  removed: [], added: [], conflicts: { added: [], cleared: [] }, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  ent.targets = [{ id: 'e1', tenantId: PLATFORM, domain: 'platform.example', lastPullStatus: 'ok' }];
  ent.results = {};
  reg.holders = {};
  reg.swept = 0;
  reg.sweepThrows = false;
  for (const k of Object.keys(recipients)) delete recipients[k];
  recipients[PLATFORM] = { email: 'ops@platform.test', lang: 'en' };
  recipients[MERCHANT] = { email: 'owner@shop.test', lang: 'en' };
  recipients[MERCHANT_FR] = { email: 'proprio@boutique.test', lang: 'fr' };
});

describe('verify-monitor Pass A, the guard', () => {
  it('conflicts added: the platform gets the count, each merchant gets one email with no address in it', async () => {
    ent.results.e1 = okPull({ conflicts: { added: [SHARED, SECOND], cleared: [] } });
    reg.holders[SHARED] = [MERCHANT];
    reg.holders[SECOND] = [MERCHANT, MERCHANT_FR];
    const body = await run();
    const m = mails();
    expect(m).toHaveLength(3);

    const platform = m.find((x) => x.to === 'ops@platform.test')!;
    expect(platform.subject).toContain('2 entries');
    expect(platform.text).toContain('platform.example');
    expect(platform.text).toContain('2 entries');
    for (const secret of [MERCHANT, MERCHANT_FR, 'shop.test', 'boutique.test']) expect(platform.text).not.toContain(secret);

    const merchant = m.find((x) => x.to === 'owner@shop.test')!;
    expect(merchant.subject).toContain("platform's published list");
    for (const secret of [SHARED, SECOND, 'platform.example', PLATFORM, '0x']) expect(merchant.text).not.toContain(secret);
    expect(merchant.text).not.toMatch(/\d+\.\d+|\$|USD/); // no amount
    expect(merchant.text).toContain('Your proof stands');

    const merchantFr = m.find((x) => x.to === 'proprio@boutique.test')!;
    expect(merchantFr.text).toContain('Votre preuve reste valable');
    expect(merchantFr.text).not.toContain(SHARED);

    expect(body.entity).toMatchObject({ checked: 1, conflictAlerts: 1, listedAlerts: 2, errors: 0 });
  }, 10_000);

  it('no conflicts added: no email, even when conflicts were cleared or old ones remain', async () => {
    ent.results.e1 = okPull({ conflicts: { added: [], cleared: [SHARED] } });
    reg.holders[SHARED] = [MERCHANT];
    const body = await run();
    expect(sendMail).not.toHaveBeenCalled();
    expect(body.entity).toMatchObject({ conflictAlerts: 0, listedAlerts: 0 });
  }, 10_000);

  it('the platform\'s own account proving its own address is not a merchant to tell', async () => {
    ent.results.e1 = okPull({ conflicts: { added: [SHARED], cleared: [] } });
    reg.holders[SHARED] = [PLATFORM];
    const body = await run();
    expect(mails().map((x) => x.to)).toEqual(['ops@platform.test']);
    expect(body.entity).toMatchObject({ conflictAlerts: 1, listedAlerts: 0 });
  }, 10_000);

  it('a revocation and a conflict in one pull: both emails to the platform, each its own kind', async () => {
    ent.results.e1 = okPull({ removed: [SECOND], conflicts: { added: [SHARED], cleared: [] } });
    const body = await run();
    const subjects = mails().map((x) => x.subject);
    expect(subjects.some((s) => s.includes('removed'))).toBe(true);
    expect(subjects.some((s) => s.includes('1 entry'))).toBe(true);
    expect(body.entity).toMatchObject({ revokedAlerts: 1, conflictAlerts: 1 });
  }, 10_000);
});

describe('verify-monitor Pass D, the sweep', () => {
  it('runs once per run and reports what it cleared', async () => {
    ent.results.e1 = okPull();
    reg.swept = 3;
    const body = await run();
    expect(body.sweep).toEqual({ listedCleared: 3, errors: 0 });
  }, 10_000);

  it('a sweep that fails is an error in the body and never fails the run', async () => {
    ent.results.e1 = okPull();
    reg.sweepThrows = true;
    const body = await run();
    expect(body.ok).toBe(true);
    expect(body.sweep).toEqual({ listedCleared: 0, errors: 1 });
  }, 10_000);
});
