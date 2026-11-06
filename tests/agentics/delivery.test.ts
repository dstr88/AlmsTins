import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';

/**
 * An account's report delivery settings, as the owner reads and sets them. Over the real SQL run by
 * the in-memory stand-in for the database. Everything is off until it is turned on; each account's
 * settings are its own; a field that is not given is left alone; anything that is not a known
 * cadence or a real true/false is refused.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
const recipient = vi.hoisted(() => ({ byTenant: {} as Record<string, string | null> }));
vi.mock('@/lib/verifyAlertRecipient', () => ({ resolveAlertRecipient: async (t: string) => ({ email: recipient.byTenant[t] ?? null, lang: 'en' }) }));

const A = 'tenant-a';
const B = 'tenant-b';
let fake: ReceivablesDbFake;
let delivery: typeof import('../../src/lib/agentVault/delivery');

beforeEach(async () => {
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  recipient.byTenant = { [A]: 'operator-a@example.test', [B]: null };
  delivery = await import('../../src/lib/agentVault/delivery');
});

describe('reading', () => {
  it('everything is off for an account that set nothing, and a row is not made by looking', async () => {
    expect(await delivery.getReportSettings(A)).toEqual({ settings: { cadence: 'off', establishedAlerts: false }, recipientAvailable: true });
    expect(fake.rows('agent_report_settings')).toEqual([]);
  });

  it('says whether there is an address to send to, and never what it is', async () => {
    expect((await delivery.getReportSettings(A)).recipientAvailable).toBe(true);
    expect((await delivery.getReportSettings(B)).recipientAvailable).toBe(false);
    expect(JSON.stringify(await delivery.getReportSettings(A))).not.toContain('@');
  });
});

describe('saving', () => {
  it('saves what is given and leaves the rest', async () => {
    expect(await delivery.saveReportSettings(A, { cadence: 'daily' })).toMatchObject({ ok: true, settings: { cadence: 'daily', establishedAlerts: false } });
    expect(await delivery.saveReportSettings(A, { establishedAlerts: true })).toMatchObject({ ok: true, settings: { cadence: 'daily', establishedAlerts: true } });
    expect(await delivery.saveReportSettings(A, { cadence: 'issues', establishedAlerts: false })).toMatchObject({ ok: true, settings: { cadence: 'issues', establishedAlerts: false } });
    expect((await delivery.getReportSettings(A)).settings).toEqual({ cadence: 'issues', establishedAlerts: false });
    expect(fake.rows('agent_report_settings')).toHaveLength(1);
  });

  it('each cadence is accepted, and each is stored as the word', async () => {
    for (const cadence of ['off', 'daily', 'weekly', 'issues'] as const) {
      expect(await delivery.saveReportSettings(A, { cadence })).toMatchObject({ ok: true, settings: { cadence } });
      expect(fake.rows('agent_report_settings')[0].cadence).toBe(cadence);
    }
  });

  it('stores the Established switch as 1 or 0, and reads it back as true or false', async () => {
    await delivery.saveReportSettings(A, { establishedAlerts: true });
    expect(fake.rows('agent_report_settings')[0].established_alerts).toBe(1);
    await delivery.saveReportSettings(A, { establishedAlerts: false });
    expect(fake.rows('agent_report_settings')[0].established_alerts).toBe(0);
  });

  it('refuses anything that is not a known cadence or a real true/false, and a request that sets nothing, and stores nothing', async () => {
    for (const input of [
      {}, { cadence: undefined }, { cadence: 'hourly' }, { cadence: 'DAILY' }, { cadence: ' daily' }, { cadence: 1 }, { cadence: null }, { cadence: ['daily'] },
      { establishedAlerts: 'true' }, { establishedAlerts: 1 }, { establishedAlerts: 0 }, { establishedAlerts: null }, { establishedAlerts: {} },
      { cadence: 'daily', establishedAlerts: 'yes' }, // one good field does not excuse a bad one
      { cadence: 'constructor' }, { cadence: '__proto__' },
      { alerts: true }, // the old switch: flagged-check emails now always go, so it sets nothing
    ] as Array<{ cadence?: unknown; establishedAlerts?: unknown }>) {
      expect(await delivery.saveReportSettings(A, input), JSON.stringify(input)).toEqual({ ok: false, error: 'invalid_settings' });
    }
    expect(fake.rows('agent_report_settings') ?? []).toEqual([]);
  });

  it('keeps each account\'s settings its own', async () => {
    await delivery.saveReportSettings(A, { cadence: 'daily', establishedAlerts: true });
    expect((await delivery.getReportSettings(B)).settings).toEqual({ cadence: 'off', establishedAlerts: false });
    await delivery.saveReportSettings(B, { cadence: 'weekly' });
    expect((await delivery.getReportSettings(A)).settings).toEqual({ cadence: 'daily', establishedAlerts: true });
    expect(fake.rows('agent_report_settings').map((r) => r.tenant_id).sort()).toEqual([A, B]);
  });

  it('answers whether there is an address to send to, so a form can warn', async () => {
    expect(await delivery.saveReportSettings(B, { cadence: 'daily' })).toMatchObject({ ok: true, recipientAvailable: false });
  });
});
