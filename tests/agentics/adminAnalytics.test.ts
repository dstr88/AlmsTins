import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { OWNER_TENANT_ID } from '../../src/lib/owner';

/**
 * Agentics analytics for the admin page (src/lib/agenticsAnalytics.ts): the pure summary of the query
 * rows, the loader that never throws, and the page that shows it behind the admin check. Every
 * address and tenant is invented.
 */

const holder = vi.hoisted(() => ({ execute: vi.fn<(s: any) => Promise<any>>() }));
vi.mock('@/lib/db', () => ({ db: { execute: (s: any) => holder.execute(s), batch: async () => [] } }));
vi.mock('@/lib/agenticsSignup', () => ({ ensureAgenticsSignupsTable: async () => undefined }));
vi.mock('@/lib/agentVault/events', () => ({ ensureAgentEventsTable: async () => undefined }));
vi.mock('@/lib/agentVault/store', () => ({ ensureAgentVaultTables: async () => undefined }));

import { loadAgenticsAnalytics, summarizeAgentics, toIso, type RawRows } from '../../src/lib/agenticsAnalytics';

const ROOT = path.resolve(__dirname, '../..');
const NOW = new Date('2026-11-06T15:30:00.000Z');
const A = 'tenant-a';
const B = 'tenant-b';
const C = 'tenant-c';

const empty = (): RawRows => ({ signups: [], emails: [], tins: [], wallets: [], addresses: [], events: [], hours: [] });

const sample = (): RawRows => ({
  signups: [
    { tenant_id: A, source: 'linkedin', created_at: '2026-11-06 09:00:00', country: 'US', last_seen_at: '2026-11-06 14:00:00' },
    { tenant_id: B, source: 'direct', created_at: '2026-11-05 22:10:00', country: null, last_seen_at: null },
    { tenant_id: OWNER_TENANT_ID, source: 'direct', created_at: '2026-10-01 00:00:00', country: 'US', last_seen_at: null },
  ],
  emails: [
    { tenant_id: A, email: 'second@example.test', created_at: '2026-11-06 10:00:00', id: 'm2' },
    { tenant_id: A, email: 'first@example.test', created_at: '2026-11-06 09:00:00', id: 'm1' },
    { tenant_id: B, email: 'not an address', created_at: '2026-11-05 22:10:00', id: 'm3' },
    { tenant_id: 'tenant-elsewhere', email: 'tracker@example.test', created_at: '2026-01-01 00:00:00', id: 'm4' },
  ],
  tins: [{ tenant_id: A, n: '2' }, { tenant_id: C, n: 1 }, { tenant_id: OWNER_TENANT_ID, n: 9 }],
  wallets: [{ tenant_id: A, n: 3 }, { tenant_id: C, n: 1 }],
  addresses: [{ tenant_id: A, n: 7 }],
  events: [
    { tenant_id: A, checks: '40', transactions: '6', sent: '4', usd: '1234.5', first_at: '2026-11-06T09:30:00.000Z', last_at: '2026-11-06T15:00:00.000Z' },
    { tenant_id: OWNER_TENANT_ID, checks: 999, transactions: 999, sent: 999, usd: 999, first_at: null, last_at: null },
  ],
  hours: [
    { tenant_id: A, hour: '2026-11-06T14', n: 30 },
    { tenant_id: A, hour: '2026-11-06T09', n: 16 },
    { tenant_id: C, hour: '2026-10-20T03', n: 5 },
    { tenant_id: C, hour: '2026-09-01T03', n: 50 },
    { tenant_id: OWNER_TENANT_ID, hour: '2026-11-06T14', n: 500 },
    { tenant_id: A, hour: 'garbage', n: 9 },
  ],
});

describe('the summary', () => {
  it('lists every signup and every account with an agent, and never the owner', () => {
    const s = summarizeAgentics(sample(), NOW);
    expect(s.accounts.map((a) => a.tenantId).sort()).toEqual([A, B, C]);
    expect(s.totals).toEqual({ accounts: 3, withAgents: 2, active: 1, bots: 3, wallets: 4, addresses: 7, checks: 40, transactions: 6, usd: 1234.5 });
  });

  it('gives each account the email of its first sign-in, and only one that looks like an address', () => {
    const s = summarizeAgentics(sample(), NOW);
    const by = Object.fromEntries(s.accounts.map((a) => [a.tenantId, a]));
    expect(by[A].email).toBe('first@example.test');
    expect(by[B].email).toBeNull();
    expect(by[C].email).toBeNull();
    expect(s.accounts.some((a) => a.tenantId === 'tenant-elsewhere')).toBe(false);
  });

  it('splits transfers into sent and received, and reads times as UTC', () => {
    const a = summarizeAgentics(sample(), NOW).accounts.find((x) => x.tenantId === A)!;
    expect(a).toMatchObject({ bots: 2, wallets: 3, addresses: 7, checks: 40, transactions: 6, sent: 4, received: 2, usd: 1234.5, country: 'US', source: 'linkedin' });
    expect(a.signedUpAt).toBe('2026-11-06T09:00:00.000Z');
    expect(a.lastSeenAt).toBe('2026-11-06T14:00:00.000Z');
    expect(a.lastActivityAt).toBe('2026-11-06T15:00:00.000Z');
    expect(a.recentEvents).toBe(46);
  });

  it('puts the most recently active account first', () => {
    expect(summarizeAgentics(sample(), NOW).accounts.map((a) => a.tenantId)).toEqual([A, B, C]);
  });

  it('counts activity by UTC hour, weekday and day, inside the window only', () => {
    const s = summarizeAgentics(sample(), NOW);
    expect(s.byHour[14]).toBe(30);
    expect(s.byHour[9]).toBe(16);
    expect(s.byHour[3]).toBe(5); // the September hour is outside the 30 days
    expect(s.byHour.reduce((x, y) => x + y, 0)).toBe(51);
    expect(s.byWeekday[5]).toBe(46); // Nov 6, 2026 is a Friday
    expect(s.byWeekday[2]).toBe(5); // Oct 20, 2026 is a Tuesday
    expect(s.daily).toHaveLength(14);
    expect(s.daily.at(-1)).toEqual({ day: '2026-11-06', events: 46, accounts: 1 });
    expect(s.daily[0].day).toBe('2026-10-24');
  });

  it('counts countries, with the accounts that have none as Unknown, last', () => {
    expect(summarizeAgentics(sample(), NOW).countries).toEqual([
      { country: 'US', accounts: 1 },
      { country: 'Unknown', accounts: 2 },
    ]);
  });

  it('answers zeros for no rows at all', () => {
    const s = summarizeAgentics(empty(), NOW);
    expect(s.accounts).toEqual([]);
    expect(s.totals.accounts).toBe(0);
    expect(s.byHour).toEqual(Array(24).fill(0));
    expect(s.countries).toEqual([]);
  });

  it('reads both time formats the tables store', () => {
    expect(toIso('2026-11-06 09:00:00')).toBe('2026-11-06T09:00:00.000Z');
    expect(toIso('2026-11-06T09:00:00.123Z')).toBe('2026-11-06T09:00:00.123Z');
    expect(toIso('')).toBeNull();
    expect(toIso('not a time')).toBeNull();
  });
});

describe('the loader', () => {
  beforeEach(() => {
    holder.execute.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('runs one query per part, and only reads', async () => {
    holder.execute.mockResolvedValue({ rows: [] });
    await loadAgenticsAnalytics(NOW);
    const sqls = holder.execute.mock.calls.map(([s]) => String(s.sql));
    expect(sqls).toHaveLength(7);
    for (const sql of sqls) expect(sql.trim()).toMatch(/^SELECT\b/);
    const hours = holder.execute.mock.calls.find(([s]) => /substr\(occurred_at, 1, 13\)/.test(s.sql))!;
    expect(hours[0].args).toEqual(['2026-10-07T00:00:00.000Z']);
  });

  it('never throws: a part that fails is empty and named, by name and code only', async () => {
    holder.execute.mockImplementation(async (s: any) => {
      if (/FROM agent_events/.test(s.sql)) throw Object.assign(new Error('relation "agent_events" does not exist for a@b.test'), { code: '42P01' });
      if (/FROM agentics_signups$/.test(s.sql.trim())) return { rows: [{ tenant_id: A, source: 'direct', created_at: '2026-11-06 09:00:00', country: 'GB', last_seen_at: null }] };
      return { rows: [] };
    });
    const s = await loadAgenticsAnalytics(NOW);
    expect(s.unavailable).toEqual(['events', 'hours']);
    expect(s.totals.accounts).toBe(1);
    expect(s.countries).toEqual([{ country: 'GB', accounts: 1 }]);
    expect(console.error).toHaveBeenCalledWith('[admin] agentics analytics part not read', { part: 'events', name: 'Error', code: '42P01' });
  });
});

describe('the page', () => {
  const page = readFileSync(path.join(ROOT, 'src/pages/admin/agentics.astro'), 'utf8');
  const frontmatter = page.split('---')[1] ?? '';

  it('reads the analytics only after the admin check', () => {
    const guard = frontmatter.indexOf('await requireAdminSession(Astro.request);');
    expect(guard).toBeGreaterThan(0);
    expect(frontmatter.indexOf('await loadAgenticsAnalytics()')).toBeGreaterThan(guard);
  });

  it('shows each account\'s email, country, agents, addresses, transactions and activity', () => {
    for (const heading of ['<th>Email</th>', '<th>Country</th>', '<th>Agents</th>', '<th>Addresses</th>', '<th>Sent</th>', '<th>Received</th>', '<th>Last agent activity</th>']) {
      expect(page).toContain(heading);
    }
    expect(page).toContain('By hour of day (UTC)');
  });
});
