import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';

/**
 * What the Reports pages load before they render: the account's tins with their newest reports, and
 * one report with its versions. Over the real SQL run by the in-memory stand-in for the database,
 * with another account's rows present, so a dropped `AND tenant_id = ?` shows up as a wrong answer.
 * The signing key is a seed generated for each test. Every address, label and tenant is invented.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));

const A = 'tenant-a';
const B = 'tenant-b';
const NOW = new Date('2026-10-18T09:10:00.000Z');
let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let events: typeof import('../../src/lib/agentVault/events');
let reports: typeof import('../../src/lib/agentVault/reports');
let pages: typeof import('../../src/lib/agentVault/reportPages');

const useKey = (seed: string | null) => {
  vi.stubEnv('ALMSTINS_SIGNING_KEY', seed ?? '');
  vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
  vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
};
let ids = 0;
const deps = (now: Date = NOW) => ({ now: () => now, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });

beforeEach(async () => {
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  ids = 0;
  useKey(randomBytes(32).toString('hex'));
  store = await import('../../src/lib/agentVault/store');
  events = await import('../../src/lib/agentVault/events');
  reports = await import('../../src/lib/agentVault/reports');
  pages = await import('../../src/lib/agentVault/reportPages');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const newTin = (tenant: string, label: string, createdAt = '2026-10-01 00:00:00') => store.insertTin(tenant, { label, agentKeyId: null, at: createdAt });
const flagged = (tenant: string, tinId: string, i: number, when: string) =>
  events.insertCheckedEvent(tenant, { tinId, address: addr(i), chain: null, answer: 'flagged', registry: 'flagged', status: 'unknown', keyId: 'k', sourceIp: null, detail: { basis: 'registry_flagged' }, at: when });

describe('loadReportsPage', () => {
  it('lists each tin of the account with its newest reports, newest day first, and what the form needs', async () => {
    const treasury = await newTin(A, 'Treasury agent', '2026-10-05 08:00:00');
    const payments = await newTin(A, 'Payments agent');
    await flagged(A, treasury.id, 1, '2026-10-16T10:00:00.000Z');
    await flagged(A, treasury.id, 2, '2026-10-17T10:00:00.000Z');
    await reports.generateReport(A, treasury, '2026-10-16', deps());
    await reports.generateReport(A, treasury, '2026-10-17', deps());

    const data = await pages.loadReportsPage(A, NOW);
    expect(data.today).toBe('2026-10-18');
    expect(data.yesterday).toBe('2026-10-17');
    expect(data.signing).toEqual({ available: true });
    // In the order the agents were made.
    expect(data.tins.map((t) => [t.label, t.since, t.reports.map((r) => r.day)])).toEqual([
      ['Payments agent', '2026-10-01', []],
      ['Treasury agent', '2026-10-05', ['2026-10-17', '2026-10-16']],
    ]);
    expect(data.tins[0].id).toBe(payments.id);
    expect(data.tins[1].id).toBe(treasury.id);
    expect(data.tins[1].reports[0].headline.issues).toBe(1);
  });

  it('carries no address and no account id: a page can hand it to a component as it is', async () => {
    const tin = await newTin(A, 'Treasury agent');
    await flagged(A, tin.id, 1, '2026-10-17T10:00:00.000Z');
    await reports.generateReport(A, tin, '2026-10-17', deps());
    const text = JSON.stringify(await pages.loadReportsPage(A, NOW));
    expect(text).not.toContain(addr(1));
    expect(text).not.toContain(A);
  });

  it('shows only this account\'s tins and reports', async () => {
    const mine = await newTin(A, 'Mine');
    const theirs = await newTin(B, 'Theirs');
    await flagged(B, theirs.id, 9, '2026-10-17T10:00:00.000Z');
    await reports.generateReport(B, theirs, '2026-10-17', deps());
    await reports.generateReport(A, mine, '2026-10-17', deps());
    const data = await pages.loadReportsPage(A, NOW);
    expect(data.tins.map((t) => t.label)).toEqual(['Mine']);
    expect(data.tins[0].reports).toHaveLength(1);
    expect(data.tins[0].reports[0].headline.issues).toBe(0);
  });

  it('says whether this server can sign', async () => {
    expect((await pages.loadReportsPage(A, NOW)).signing).toEqual({ available: true });
    useKey(null);
    expect((await pages.loadReportsPage(A, NOW)).signing).toEqual({ available: false });
  });

  it('an account with no tins is an empty page, not an error', async () => {
    expect((await pages.loadReportsPage(A, NOW)).tins).toEqual([]);
  });

  it('carries how the account hears about its agents: everything off until it is turned on, and its own settings after', async () => {
    const delivery = await import('../../src/lib/agentVault/deliveryStore');
    expect((await pages.loadReportsPage(A, NOW)).delivery).toMatchObject({ settings: { cadence: 'off', alerts: false } });
    await delivery.writeSettings(A, { cadence: 'weekly', alerts: true }, '2026-10-01 00:00:00');
    await delivery.writeSettings(B, { cadence: 'daily', alerts: false }, '2026-10-01 00:00:00');
    expect((await pages.loadReportsPage(A, NOW)).delivery.settings).toEqual({ cadence: 'weekly', alerts: true });
    expect((await pages.loadReportsPage(B, NOW)).delivery.settings).toEqual({ cadence: 'daily', alerts: false });
    expect(JSON.stringify((await pages.loadReportsPage(A, NOW)).delivery)).not.toContain('@'); // never an email address
  });
});

describe('loadReportPage', () => {
  it('loads one report with its versions and whether it still matches what was signed', async () => {
    const tin = await newTin(A, 'Treasury agent');
    await flagged(A, tin.id, 1, '2026-10-17T10:00:00.000Z');
    const made = (await reports.generateReport(A, tin, '2026-10-17', deps())).report;
    const page = await pages.loadReportPage(A, made.id);
    expect(page).not.toBeNull();
    expect(page!.report).toMatchObject({ id: made.id, day: '2026-10-17', version: 1, verification: 'verified', signed: true });
    expect(page!.report.content.buckets.issues.listed[0].address).toBe(addr(1));
    expect(page!.signing).toEqual({ available: true });
  });

  it('is null for a report that does not exist, a blank id and another account\'s report', async () => {
    const tin = await newTin(A, 'Treasury agent');
    const made = (await reports.generateReport(A, tin, '2026-10-17', deps())).report;
    expect(await pages.loadReportPage(A, 'no-such-report')).toBeNull();
    expect(await pages.loadReportPage(A, '')).toBeNull();
    expect(await pages.loadReportPage(B, made.id)).toBeNull();
  });
});
