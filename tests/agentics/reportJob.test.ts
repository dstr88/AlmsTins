import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { txHash } from '../helpers/fakeExplorer';

/**
 * The daily report job: yesterday's report for every agent that did anything, then the digest for
 * each account that asked for one, over the real SQL run by the in-memory stand-in for the database.
 * Nothing real is called: the clock, the recipient lookup and the mail are replaced, and the
 * signing key is a seed generated for each test. Every address, label, tenant and email is invented.
 */
const holder = vi.hoisted(() => ({
  db: null as any,
  /** Runs before each statement; may throw to play a database error. */
  intercept: null as null | ((sql: string, args: unknown[]) => void),
}));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (s: any) => {
      const sql = typeof s === 'string' ? s : s.sql;
      holder.intercept?.(sql.replace(/\s+/g, ' ').trim(), typeof s === 'string' ? [] : s.args ?? []);
      return holder.db.execute(s);
    },
    batch: (s: any, m?: any) => holder.db.batch(s, m),
  },
}));
// The shared mailer, for the tests that run the job with the Vault's own default sender.
const sharedMail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@/lib/email', () => sharedMail);

const A = 'tenant-a';
const B = 'tenant-b';
const C = 'tenant-c';
const TUESDAY = new Date('2026-10-20T09:10:00.000Z'); // the day before is Monday the 19th
const SUNDAY = new Date('2026-10-18T09:10:00.000Z'); // the day before is Saturday the 17th
const MONDAY = new Date('2026-10-19T09:10:00.000Z'); // the week before is the 12th to the 18th
const APP = 'https://almstins.test';

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let events: typeof import('../../src/lib/agentVault/events');
let delivery: typeof import('../../src/lib/agentVault/deliveryStore');
let job: typeof import('../../src/lib/agentVault/reportJob');
let sent: Array<{ to: string; subject: string; text: string }>;
let inboxes: Record<string, string | null>;
let sendFails: boolean;
let recipientCalls: string[];

let ids = 0;
const deps = (now: Date) => ({
  reports: { now: () => now, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` },
  recipient: async (tenantId: string) => {
    recipientCalls.push(tenantId);
    return inboxes[tenantId] ?? null;
  },
  send: async (mail: { to: string; subject: string; text: string }) => {
    if (sendFails) throw Object.assign(new Error(`smtp refused ${mail.to}`), { name: 'SmtpError', code: 'ECONNRESET' });
    sent.push(mail);
  },
  appBase: APP,
});

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  ids = 0;
  sent = [];
  sendFails = false;
  recipientCalls = [];
  inboxes = { [A]: 'operator-a@example.test', [B]: 'operator-b@example.test', [C]: 'operator-c@example.test' };
  sharedMail.sendMail.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('ALMSTINS_SIGNING_KEY', randomBytes(32).toString('hex'));
  vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
  vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
  store = await import('../../src/lib/agentVault/store');
  events = await import('../../src/lib/agentVault/events');
  delivery = await import('../../src/lib/agentVault/deliveryStore');
  job = await import('../../src/lib/agentVault/reportJob');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const newTin = (tenant: string, label = 'Treasury agent') => store.insertTin(tenant, { label, agentKeyId: null, at: '2026-10-01 00:00:00' });
let k = 0;
const put = (tenant: string, tinId: string, basis: string, answer: 'proven' | 'consistent-with-history' | 'flagged' | 'unknown', address: string, when: string) =>
  events.insertCheckedEvent(tenant, { tinId, address, chain: null, answer, registry: 'none', status: 'unknown', keyId: `k${++k}`, sourceIp: null, detail: { basis }, at: when });
const putTransfer = (tenant: string, tinId: string, usd: number, when: string) =>
  events.insertTransactionEvent(tenant, {
    tinId, address: addr(2), chain: 'ethereum', leg: `native:${++k}`, answer: 'unknown', status: null,
    tx: { hash: txHash(k), direction: 'out', wallet: addr(1), amount: '1', asset: 'ETH', assetContract: null, usd, blockNumber: 1 }, detail: { reason: 'no_preceding_check' }, at: when,
  });
const opt = (tenant: string, cadence: 'off' | 'daily' | 'weekly' | 'issues', alerts = false) => delivery.writeSettings(tenant, { cadence, alerts }, '2026-10-01 00:00:00');
const reportRows = () => fake.rows('agent_reports');

describe('the reports', () => {
  it('makes yesterday\'s report for every agent that did anything, for every account, whatever its email settings', async () => {
    const a = await newTin(A);
    const b = await newTin(B);
    const quiet = await newTin(A, 'Quiet agent');
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await put(B, b.id, 'not_in_registry', 'unknown', addr(3), '2026-10-17T11:00:00.000Z');
    await put(A, quiet.id, 'not_in_registry', 'unknown', addr(4), '2026-10-14T11:00:00.000Z'); // older than the three days the job looks back over

    const summary = await job.runAgentReports(deps(SUNDAY));
    expect(summary).toMatchObject({ tins: 3, active: 2, created: 2, unchanged: 0, failedReports: 0, truncated: false });
    expect(reportRows().map((r) => [r.tenant_id, r.period_start]).sort()).toEqual([[A, '2026-10-17T00:00:00.000Z'], [B, '2026-10-17T00:00:00.000Z']]);
    expect(sent).toEqual([]); // nobody asked for email
  });

  it('a second run leaves the same reports and writes nothing', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await job.runAgentReports(deps(SUNDAY));
    const again = await job.runAgentReports(deps(new Date('2026-10-18T09:20:00.000Z')));
    expect(again).toMatchObject({ active: 1, created: 0, unchanged: 1 });
    expect(reportRows()).toHaveLength(1);
  });

  it('a transfer the watcher records after the first run gives the second run a new version', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await job.runAgentReports(deps(SUNDAY));
    await putTransfer(A, a.id, 75, '2026-10-17T23:58:00.000Z');
    const later = await job.runAgentReports(deps(new Date('2026-10-18T10:00:00.000Z')));
    expect(later).toMatchObject({ created: 1, unchanged: 0 });
    expect(reportRows().map((r) => r.version).sort()).toEqual([1, 2]);
  });

  it('skips a removed tin, and a failure on one agent never stops the rest', async () => {
    const gone = await newTin(A, 'Removed');
    const a = await newTin(A, 'Treasury agent');
    const b = await newTin(B);
    await put(A, gone.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await put(A, a.id, 'registry_flagged', 'flagged', addr(2), '2026-10-17T10:00:00.000Z');
    await put(B, b.id, 'registry_flagged', 'flagged', addr(3), '2026-10-17T10:00:00.000Z');
    await store.softDeleteTin(A, gone.id, '2026-10-17 12:00:00');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    holder.intercept = (sql, args) => {
      if (/FROM agent_events/.test(sql) && args.includes(a.id) && /occurred_at >= \? AND occurred_at < \? AND \(/.test(sql)) throw Object.assign(new Error(`disk full for ${addr(2)}`), { name: 'DatabaseError', code: '53100' });
    };
    const summary = await job.runAgentReports(deps(SUNDAY));
    expect(summary).toMatchObject({ tins: 2, active: 2, created: 1, failedReports: 1 });
    expect(reportRows().map((r) => r.tenant_id)).toEqual([B]);
    // The failure is logged by name and code, never with the text of the database error.
    const logged = JSON.stringify((console.error as any).mock.calls);
    expect(logged).toContain('DatabaseError');
    expect(logged).toContain('53100');
    expect(logged).not.toContain(addr(2));
  });

  it('stops starting new work when its deadline has passed, and says so', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await opt(A, 'daily');
    const summary = await job.runAgentReports(deps(SUNDAY), { deadlineAt: SUNDAY.getTime() });
    expect(summary).toMatchObject({ tins: 0, created: 0, optedIn: 0, sent: 0, truncated: true });
    expect(reportRows()).toEqual([]);
  });
});

describe('the last three days', () => {
  const WEDNESDAY = new Date('2026-10-21T09:10:00.000Z'); // yesterday is Tuesday the 20th; the window is the 18th to the 20th
  const periods = () => reportRows().map((r) => `${r.tenant_id}:${String(r.period_start).slice(0, 10)}:v${r.version}`).sort();

  it('makes the report of yesterday and of the two days before it, each for the agents that did anything that day', async () => {
    const a = await newTin(A);
    for (const day of ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']) await put(A, a.id, 'registry_flagged', 'flagged', addr(1), `${day}T10:00:00.000Z`);
    const summary = await job.runAgentReports(deps(WEDNESDAY));
    expect(periods()).toEqual([`${A}:2026-10-18:v1`, `${A}:2026-10-19:v1`, `${A}:2026-10-20:v1`]); // the 17th is a fourth day back
    expect(summary).toMatchObject({ tins: 1, active: 3, created: 3, unchanged: 0, failedReports: 0, truncated: false });
  });

  it('a run that never happened does not lose its day: the next run makes it', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-19T10:00:00.000Z');
    await put(A, a.id, 'registry_flagged', 'flagged', addr(2), '2026-10-20T10:00:00.000Z');
    // The run that should have made the 19th's report did not run. Two days later this one does.
    const summary = await job.runAgentReports(deps(WEDNESDAY));
    expect(periods()).toEqual([`${A}:2026-10-19:v1`, `${A}:2026-10-20:v1`]);
    expect(summary).toMatchObject({ active: 2, created: 2 });
  });

  it('a second run changes nothing: a day that already says the same writes nothing', async () => {
    const a = await newTin(A);
    for (const day of ['2026-10-18', '2026-10-19', '2026-10-20']) await put(A, a.id, 'registry_flagged', 'flagged', addr(1), `${day}T10:00:00.000Z`);
    await job.runAgentReports(deps(WEDNESDAY));
    const before = fake.statements(/^INSERT INTO agent_reports/).length;
    const again = await job.runAgentReports(deps(new Date('2026-10-21T09:40:00.000Z')));
    expect(again).toMatchObject({ active: 3, created: 0, unchanged: 3, failedReports: 0 });
    expect(fake.statements(/^INSERT INTO agent_reports/)).toHaveLength(before);
    expect(periods()).toHaveLength(3);
  });

  it('a transfer the watcher records late for the day before yesterday gives that day a new version', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-19T10:00:00.000Z');
    await job.runAgentReports(deps(new Date('2026-10-20T09:10:00.000Z')));
    expect(periods()).toEqual([`${A}:2026-10-19:v1`]);
    await putTransfer(A, a.id, 75, '2026-10-19T23:58:00.000Z'); // recorded after the first run, for a day that is now two days back
    const next = await job.runAgentReports(deps(WEDNESDAY));
    expect(next).toMatchObject({ created: 1, unchanged: 0 });
    expect(periods()).toEqual([`${A}:2026-10-19:v1`, `${A}:2026-10-19:v2`]);
  });

  it('the digest is still for yesterday only, with its own key, whatever the other days hold', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-19T10:00:00.000Z'); // two days back, flagged
    await opt(A, 'daily');
    const quietYesterday = await job.runAgentReports(deps(WEDNESDAY));
    expect(periods()).toEqual([`${A}:2026-10-19:v1`]); // the report was made
    expect(quietYesterday).toMatchObject({ optedIn: 1, sent: 0, notNeeded: 1 }); // but yesterday had nothing to say
    expect(sent).toEqual([]);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(2), '2026-10-20T10:00:00.000Z');
    const withYesterday = await job.runAgentReports(deps(new Date('2026-10-21T09:30:00.000Z')));
    expect(withYesterday).toMatchObject({ sent: 1 });
    expect(sent[0].subject).toBe('1 needs your attention · Agent report, Oct 20, 2026'); // yesterday's address only
    expect(fake.rows('agent_report_settings')[0].last_digest_key).toBe('daily:2026-10-20');
  });

  it('a failure on one day never skips the tin\'s other days, and each failure is counted', async () => {
    const a = await newTin(A);
    for (const day of ['2026-10-18', '2026-10-19', '2026-10-20']) await put(A, a.id, 'registry_flagged', 'flagged', addr(1), `${day}T10:00:00.000Z`);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    holder.intercept = (sql, args) => {
      // The read of the 19th (its first moment is the third argument); the 18th's read only ends there.
      if (/FROM agent_events/.test(sql) && args[1] === a.id && args[2] === '2026-10-19T00:00:00.000Z' && /AND \(/.test(sql)) throw Object.assign(new Error('disk full'), { name: 'DatabaseError', code: '53100' });
    };
    const summary = await job.runAgentReports(deps(WEDNESDAY));
    expect(summary).toMatchObject({ tins: 1, active: 3, created: 2, failedReports: 1 });
    expect(periods()).toEqual([`${A}:2026-10-18:v1`, `${A}:2026-10-20:v1`]);
  });

  it('stops between a tin\'s days when the deadline passes, and says so', async () => {
    const a = await newTin(A);
    for (const day of ['2026-10-18', '2026-10-19', '2026-10-20']) await put(A, a.id, 'registry_flagged', 'flagged', addr(1), `${day}T10:00:00.000Z`);
    const base = deps(WEDNESDAY);
    let elapsed = 0;
    // Ten milliseconds pass each time the job asks whether a tin had anything on a day.
    holder.intercept = (sql) => { if (/^SELECT id FROM agent_events WHERE tenant_id = \? AND tin_id = \?/.test(sql)) elapsed += 10; };
    const summary = await job.runAgentReports(
      { ...base, reports: { ...base.reports, now: () => new Date(WEDNESDAY.getTime() + elapsed) } },
      { deadlineAt: WEDNESDAY.getTime() + 15 },
    );
    expect(summary).toMatchObject({ tins: 1, active: 2, created: 2, truncated: true }); // two of the three days, then out of time
    expect(periods()).toEqual([`${A}:2026-10-19:v1`, `${A}:2026-10-20:v1`]);
  });
});

describe('the tins are taken in an order that changes every day', () => {
  const TENANTS = Array.from({ length: 12 }, (_, i) => `tenant-${String.fromCharCode(97 + i)}`);
  const rank = (day: string, tenant: string) => createHash('sha256').update(day + tenant).digest('hex');
  const expectedOrder = (day: string, tenants: readonly string[]) => [...tenants].sort((x, y) => (rank(day, x) < rank(day, y) ? -1 : 1));

  /** The tenants in the order the job first read each one's events. */
  const visitOrder = () => {
    const seen: string[] = [];
    holder.intercept = (sql, args) => {
      if (/^SELECT id FROM agent_events WHERE tenant_id = \? AND tin_id = \?/.test(sql) && !seen.includes(String(args[0]))) seen.push(String(args[0]));
    };
    return seen;
  };

  it('orderForDay puts the accounts by the sha256 of the day and the account id, keeps one account\'s tins together in their order, and is the same every time', () => {
    const targets = TENANTS.flatMap((tenantId) => [{ tenantId, tinId: `${tenantId}-1` }, { tenantId, tinId: `${tenantId}-2` }]);
    const day1 = job.orderForDay(targets, '2026-10-18');
    expect([...new Set(day1.map((t) => t.tenantId))]).toEqual(expectedOrder('2026-10-18', TENANTS));
    expect(day1).toHaveLength(targets.length);
    for (const tenantId of TENANTS) {
      const mine = day1.filter((t) => t.tenantId === tenantId).map((t) => t.tinId);
      expect(mine).toEqual([`${tenantId}-1`, `${tenantId}-2`]); // in the order they came
      const at = day1.findIndex((t) => t.tenantId === tenantId);
      expect(day1[at + 1].tenantId).toBe(tenantId); // and together
    }
    expect(job.orderForDay(targets, '2026-10-18')).toEqual(day1);
    expect(job.orderForDay(targets, '2026-10-19').map((t) => t.tenantId)).not.toEqual(day1.map((t) => t.tenantId));
    expect(targets.map((t) => t.tinId)).toEqual(TENANTS.flatMap((t) => [`${t}-1`, `${t}-2`])); // the input is left as it was
  });

  it('the job visits the accounts in that order, and a different one the next day', async () => {
    for (const tenant of TENANTS) {
      const tin = await newTin(tenant);
      await put(tenant, tin.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
      await put(tenant, tin.id, 'registry_flagged', 'flagged', addr(1), '2026-10-18T10:00:00.000Z');
    }
    const first = visitOrder();
    await job.runAgentReports(deps(SUNDAY)); // today is the 18th
    expect(first).toEqual(expectedOrder('2026-10-18', TENANTS));
    const second = visitOrder();
    await job.runAgentReports(deps(MONDAY)); // today is the 19th
    expect(second).toEqual(expectedOrder('2026-10-19', TENANTS));
    expect(second).not.toEqual(first);
    const again = visitOrder();
    await job.runAgentReports(deps(new Date('2026-10-19T09:40:00.000Z'))); // a second run on the same day
    expect(again).toEqual(second);
  });

  it('a deadline that cuts a run short leaves a different tail unvisited on a different day', async () => {
    for (const tenant of TENANTS) await put(tenant, (await newTin(tenant)).id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    const reached = async (now: Date) => {
      fake.rows('agent_reports').splice(0);
      const base = deps(now);
      let elapsed = 0;
      holder.intercept = (sql) => { if (/^SELECT id FROM agent_events WHERE tenant_id = \? AND tin_id = \?/.test(sql)) elapsed += 10; };
      // Each tin is asked about three days, so a tin costs thirty milliseconds: about five tins fit in the budget.
      const summary = await job.runAgentReports({ ...base, reports: { ...base.reports, now: () => new Date(now.getTime() + elapsed) } }, { deadlineAt: now.getTime() + 150 });
      expect(summary.truncated).toBe(true);
      return new Set(reportRows().map((r) => r.tenant_id));
    };
    const onSunday = await reached(SUNDAY);
    const onMonday = await reached(new Date('2026-10-19T09:10:00.000Z'));
    expect(onSunday.size).toBeGreaterThan(0);
    expect(onSunday.size).toBeLessThan(TENANTS.length);
    expect([...onSunday].sort()).not.toEqual([...onMonday].sort());
  });
});

describe('the digest goes only to an account that asked for it', () => {
  const setup = async () => {
    const a = await newTin(A);
    const b = await newTin(B);
    const c = await newTin(C);
    for (const [tenant, tin] of [[A, a], [B, b], [C, c]] as const) {
      await put(tenant, tin.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
      await put(tenant, tin.id, 'domain_proof', 'proven', addr(5), '2026-10-17T11:00:00.000Z');
    }
    return { a, b, c };
  };

  it('sends A (daily) its digest, and nobody else: B never turned anything on, C turned the digest off', async () => {
    await setup();
    await opt(A, 'daily');
    await opt(C, 'off', true); // alerts on, digest off: no digest
    const summary = await job.runAgentReports(deps(SUNDAY));
    expect(summary).toMatchObject({ optedIn: 1, sent: 1, notNeeded: 0, noRecipient: 0, alreadySent: 0, failedSends: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('operator-a@example.test');
    expect(sent[0].subject).toBe('1 needs your attention · Agent report, Oct 17, 2026');
    expect(recipientCalls).toEqual([A]); // the other inboxes were never even looked up
    expect(reportRows()).toHaveLength(3); // but every account still has its report
  });

  it('the digest is that account\'s numbers only, whatever the others did', async () => {
    const { b } = await setup();
    for (let i = 0; i < 4; i++) await put(B, b.id, 'registry_flagged', 'flagged', addr(100 + i), '2026-10-17T12:00:00.000Z'); // B alone has four more
    await opt(A, 'daily');
    await opt(B, 'daily');
    await job.runAgentReports(deps(SUNDAY));
    const byTo = Object.fromEntries(sent.map((m) => [m.to, m.subject]));
    expect(byTo['operator-a@example.test']).toMatch(/^1 needs your attention/);
    expect(byTo['operator-b@example.test']).toMatch(/^5 need your attention/);
  });

  it('a second run the same day sends nothing: the digest for that day has gone out', async () => {
    await setup();
    await opt(A, 'daily');
    await job.runAgentReports(deps(SUNDAY));
    const again = await job.runAgentReports(deps(new Date('2026-10-18T09:40:00.000Z')));
    expect(again).toMatchObject({ optedIn: 1, sent: 0, alreadySent: 1 });
    expect(sent).toHaveLength(1);
    expect(fake.rows('agent_report_settings')[0].last_digest_key).toBe('daily:2026-10-17');
    // The next day is a new digest.
    await put(A, (await store.listTins(A))[0].id, 'registry_flagged', 'flagged', addr(7), '2026-10-18T10:00:00.000Z');
    const next = await job.runAgentReports(deps(new Date('2026-10-19T09:10:00.000Z')));
    expect(next).toMatchObject({ sent: 1 });
    expect(sent[1].subject).toMatch(/Oct 18, 2026$/);
  });

  it('two runs at once send it once', async () => {
    await setup();
    await opt(A, 'daily');
    const [x, y] = await Promise.all([job.runAgentReports(deps(SUNDAY)), job.runAgentReports(deps(SUNDAY))]);
    expect(x.sent + y.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('a failed send gives its claim back, so a re-run the same day tries again', async () => {
    await setup();
    await opt(A, 'daily');
    sendFails = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await job.runAgentReports(deps(SUNDAY));
    expect(failed).toMatchObject({ sent: 0, failedSends: 1 });
    expect(fake.rows('agent_report_settings')[0].last_digest_key).toBeNull();
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('operator-a@example.test'); // the address is not logged
    sendFails = false;
    const retry = await job.runAgentReports(deps(SUNDAY));
    expect(retry).toMatchObject({ sent: 1, failedSends: 0 });
    expect(sent).toHaveLength(1);
  });

  it('an account with no email address on file is counted, claims nothing and is sent nothing', async () => {
    await setup();
    await opt(A, 'daily');
    inboxes[A] = null;
    const summary = await job.runAgentReports(deps(SUNDAY));
    expect(summary).toMatchObject({ optedIn: 1, sent: 0, noRecipient: 1 });
    expect(fake.rows('agent_report_settings')[0].last_digest_key ?? null).toBeNull();
    inboxes[A] = 'operator-a@example.test';
    expect((await job.runAgentReports(deps(SUNDAY))).sent).toBe(1);
  });

  it('a day with no activity sends no digest, however the account asked', async () => {
    await newTin(A);
    for (const cadence of ['daily', 'issues'] as const) {
      await opt(A, cadence);
      const summary = await job.runAgentReports(deps(SUNDAY));
      expect(summary, cadence).toMatchObject({ optedIn: 1, sent: 0, notNeeded: 1 });
    }
    expect(sent).toEqual([]);
  });

  it('only-when-needed sends only when something needs a look', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'domain_proof', 'proven', addr(5), '2026-10-17T10:00:00.000Z');
    await put(A, a.id, 'registered_first_check', 'unknown', addr(6), '2026-10-17T10:30:00.000Z');
    await opt(A, 'issues');
    const quiet = await job.runAgentReports(deps(SUNDAY));
    expect(quiet).toMatchObject({ sent: 0, notNeeded: 1 });
    await put(A, a.id, 'not_in_registry', 'unknown', addr(8), '2026-10-17T12:00:00.000Z');
    const needed = await job.runAgentReports(deps(new Date('2026-10-18T09:30:00.000Z')));
    expect(needed).toMatchObject({ sent: 1, notNeeded: 0 });
    expect(sent[0].subject).toBe('1 needs your attention · Agent report, Oct 17, 2026');
  });

  it('a quiet day with checks is a quiet all-clear subject', async () => {
    const a = await newTin(A);
    for (let i = 0; i < 12; i++) await put(A, a.id, 'domain_proof', 'proven', addr(5), `2026-10-17T10:${String(i).padStart(2, '0')}:00.000Z`);
    await opt(A, 'daily');
    await job.runAgentReports(deps(SUNDAY));
    expect(sent[0].subject).toBe('All clear, 12 verified · Agent report, Oct 17, 2026');
  });

  it('no email carries an address, a label, an agent\'s name or an amount', async () => {
    const a = await newTin(A, 'Treasury agent');
    await store.insertDestination(A, { tinId: a.id, chain: 'ethereum', address: addr(1), label: 'Ops wallet', at: '2026-10-02 00:00:00' });
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await put(A, a.id, 'not_in_registry', 'unknown', addr(3), '2026-10-17T10:30:00.000Z');
    await putTransfer(A, a.id, 1270.56, '2026-10-17T12:00:00.000Z');
    await opt(A, 'daily');
    await job.runAgentReports(deps(SUNDAY));
    expect(sent).toHaveLength(1);
    const all = `${sent[0].subject}\n${sent[0].text}`;
    for (const secret of [addr(1), addr(3), 'Ops wallet', 'Treasury agent', '1270', '1,270', '$', '0x']) expect(all, secret).not.toContain(secret);
  });

  it('the answer is numbers and true/false only, and names no one', async () => {
    await setup();
    await opt(A, 'daily');
    const summary = await job.runAgentReports(deps(SUNDAY));
    for (const [key, value] of Object.entries(summary)) expect(['number', 'boolean'], key).toContain(typeof value);
    expect(JSON.stringify(summary)).not.toMatch(/tenant|operator|@|0x/);
  });
});

describe('the email is really sent, or the digest is not counted as sent', () => {
  const setup = async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await opt(A, 'daily');
    return a;
  };
  /** The job's own default sender and mail lookup, with the clock and the recipient replaced. */
  const withDefaultSender = (now: Date, recipient: (tenantId: string) => Promise<string | null> = async (t) => inboxes[t] ?? null) => ({
    ...job.defaultJobDeps(),
    reports: deps(now).reports,
    recipient,
  });

  it('with no mail transport it is a failed send, the claim is given back, and nothing is stored as sent', async () => {
    await setup();
    vi.stubEnv('EMAIL_SERVER', '');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const summary = await job.runAgentReports(withDefaultSender(SUNDAY));
    expect(summary).toMatchObject({ optedIn: 1, sent: 0, failedSends: 1 });
    expect(sharedMail.sendMail).not.toHaveBeenCalled();
    expect(fake.rows('agent_report_settings')[0].last_digest_key ?? null).toBeNull();
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('MailUnavailableError');
    expect(logged).toContain('E_NO_MAIL_TRANSPORT');
    expect(logged).not.toContain('operator-a@example.test');
    // The mail comes back: the same day's re-run sends the digest the failed run could not.
    vi.stubEnv('EMAIL_SERVER', 'smtp://mail.example.test:587');
    const retry = await job.runAgentReports(withDefaultSender(SUNDAY));
    expect(retry).toMatchObject({ sent: 1, failedSends: 0 });
    expect(sharedMail.sendMail).toHaveBeenCalledTimes(1);
    expect(fake.rows('agent_report_settings')[0].last_digest_key).toBe('daily:2026-10-17');
  });

  it('with a mail transport it goes through the shared mailer and counts as sent', async () => {
    await setup();
    vi.stubEnv('EMAIL_SERVER', 'smtp://mail.example.test:587');
    const summary = await job.runAgentReports(withDefaultSender(SUNDAY));
    expect(summary).toMatchObject({ sent: 1, failedSends: 0 });
    expect(sharedMail.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'operator-a@example.test', subject: '1 needs your attention · Agent report, Oct 17, 2026' }));
  });

  it('a send that hangs is failed after twenty seconds, gives its claim back, and does not hold up the next account', async () => {
    const a = await newTin(A);
    const b = await newTin(B);
    for (const [tenant, tin] of [[A, a], [B, b]] as const) {
      await put(tenant, tin.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
      await opt(tenant, 'daily');
    }
    vi.stubEnv('EMAIL_SERVER', 'smtp://mail.example.test:587');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sharedMail.sendMail.mockImplementation((mail: { to: string }) => (mail.to === 'operator-a@example.test' ? new Promise(() => {}) : Promise.resolve()));
    vi.useFakeTimers();
    try {
      const running = job.runAgentReports(withDefaultSender(SUNDAY));
      await vi.advanceTimersByTimeAsync(19_999);
      expect(sharedMail.sendMail).toHaveBeenCalledTimes(1); // still waiting on the first account's mail server
      await vi.advanceTimersByTimeAsync(1);
      const summary = await running;
      expect(summary).toMatchObject({ optedIn: 2, sent: 1, failedSends: 1 });
    } finally {
      vi.useRealTimers();
    }
    const keys = Object.fromEntries(fake.rows('agent_report_settings').map((r) => [r.tenant_id, r.last_digest_key ?? null]));
    expect(keys).toEqual({ [A]: null, [B]: 'daily:2026-10-17' });
  });
});

describe('the claim is for the settings the job read', () => {
  const flaggedYesterday = async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    return a;
  };

  it('an owner who turns the digest off while a run is under way is sent nothing', async () => {
    await flaggedYesterday();
    await opt(A, 'daily');
    const base = deps(SUNDAY);
    const summary = await job.runAgentReports({
      ...base,
      // The lookup comes after the account was chosen and before the claim: the owner switches it off in between.
      recipient: async (tenantId) => { await opt(A, 'off'); return inboxes[tenantId] ?? null; },
    });
    expect(sent).toEqual([]);
    expect(summary).toMatchObject({ optedIn: 1, sent: 0, failedSends: 0 });
    expect(fake.rows('agent_report_settings')[0]).toMatchObject({ cadence: 'off' });
    expect(fake.rows('agent_report_settings')[0].last_digest_key ?? null).toBeNull();
  });

  it('an owner who picks another cadence while a run is under way is sent nothing under the old one', async () => {
    await flaggedYesterday();
    await opt(A, 'daily');
    const base = deps(SUNDAY);
    await job.runAgentReports({ ...base, recipient: async (tenantId) => { await opt(A, 'weekly'); return inboxes[tenantId] ?? null; } });
    expect(sent).toEqual([]);
    expect(fake.rows('agent_report_settings')[0].last_digest_key ?? null).toBeNull();
    // The new cadence is the one the next run goes by: Monday's run sends the week before.
    await job.runAgentReports(deps(MONDAY));
    expect(sent).toHaveLength(1);
    expect(fake.rows('agent_report_settings')[0].last_digest_key).toBe('weekly:2026-10-12');
  });

  it('a digest that stays on is claimed and sent as before', async () => {
    await flaggedYesterday();
    await opt(A, 'daily');
    const summary = await job.runAgentReports(deps(SUNDAY));
    expect(summary).toMatchObject({ sent: 1, alreadySent: 0 });
    expect(fake.rows('agent_report_settings')[0].last_digest_key).toBe('daily:2026-10-17');
  });

  it('the claim statement names the cadence', async () => {
    await flaggedYesterday();
    await opt(A, 'daily');
    await job.runAgentReports(deps(SUNDAY));
    const claim = fake.log.find((s) => /^UPDATE agent_report_settings SET last_digest_key = \? WHERE/.test(s.sql) && /last_digest_key IS NULL OR/.test(s.sql));
    expect(claim?.sql).toMatch(/WHERE tenant_id = \? AND cadence = \? AND \(/);
    expect(claim?.args).toEqual(['daily:2026-10-17', A, 'daily', 'daily:2026-10-17']);
  });
});

describe('an agent that was removed is no longer told about, in the daily digest either', () => {
  const twoAgents = async () => {
    const kept = await newTin(A, 'Kept agent');
    const gone = await newTin(A, 'Removed agent');
    await put(A, kept.id, 'domain_proof', 'proven', addr(5), '2026-10-17T10:00:00.000Z'); // quiet
    await put(A, gone.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await put(A, gone.id, 'not_in_registry', 'unknown', addr(2), '2026-10-17T11:00:00.000Z');
    await job.runAgentReports(deps(SUNDAY)); // both reports are made while both agents are live
    await store.softDeleteTin(A, gone.id, '2026-10-17 12:00:00');
    return { kept, gone };
  };

  it('the daily digest counts only the agents the account still has', async () => {
    await twoAgents();
    await opt(A, 'daily');
    await job.runAgentReports(deps(new Date('2026-10-18T09:30:00.000Z')));
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).not.toMatch(/^\d/); // it does not lead with "2 need your attention": the removed agent's two addresses are not counted
    expect(sent[0].text).toContain('Agents with activity: 1');
    expect(sent[0].text).toContain('Checks that came back proven or consistent with history: 1');
    expect(sent[0].text).not.toContain('Had issues');
  });

  it('only-when-needed sends nothing when the only trouble was a removed agent\'s', async () => {
    await twoAgents();
    await opt(A, 'issues');
    const summary = await job.runAgentReports(deps(new Date('2026-10-18T09:30:00.000Z')));
    expect(summary).toMatchObject({ sent: 0, notNeeded: 1 });
    expect(sent).toEqual([]);
  });

  it('agrees with the weekly digest, which already read only the live agents', async () => {
    await twoAgents();
    await opt(A, 'weekly');
    await job.runAgentReports(deps(MONDAY));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Agents with activity: 1');
    expect(sent[0].text).not.toContain('Had issues');
  });
});

describe('the weekly digest', () => {
  it('on Monday covers the week before, counting each address once across the seven days', async () => {
    const a = await newTin(A);
    // The same flagged address on three days counts once; a second address with issues once; one not confirmed.
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-12T10:00:00.000Z');
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-14T10:00:00.000Z');
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-18T23:59:59.999Z');
    await put(A, a.id, 'domain_mismatch', 'flagged', addr(2), '2026-10-15T10:00:00.000Z');
    await put(A, a.id, 'not_in_registry', 'unknown', addr(3), '2026-10-16T10:00:00.000Z');
    await put(A, a.id, 'domain_proof', 'proven', addr(5), '2026-10-13T10:00:00.000Z');
    await put(A, a.id, 'registry_flagged', 'flagged', addr(9), '2026-10-11T23:59:59.999Z'); // the Sunday before the window
    await put(A, a.id, 'registry_flagged', 'flagged', addr(10), '2026-10-19T00:00:00.000Z'); // the Monday after it
    await opt(A, 'weekly');
    const summary = await job.runAgentReports(deps(MONDAY));
    expect(summary).toMatchObject({ optedIn: 1, sent: 1 });
    expect(sent[0].subject).toBe('3 need your attention · Agent report, Oct 12 to Oct 18, 2026');
    expect(sent[0].text).toContain('  Had issues: 2');
    expect(sent[0].text).toContain('  Not confirmed: 1');
    expect(sent[0].text).toContain('Checks that came back proven or consistent with history: 1');
    expect(sent[0].text.split('\n')[0]).toBe('Agent report for October 12, 2026 to October 18, 2026 (UTC)');
  });

  it('is sent once for that week, however many days it is run that week', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-14T10:00:00.000Z');
    await opt(A, 'weekly');
    expect((await job.runAgentReports(deps(MONDAY))).sent).toBe(1);
    const tuesday = await job.runAgentReports(deps(TUESDAY));
    expect(tuesday).toMatchObject({ sent: 0, alreadySent: 1 });
    expect(sent).toHaveLength(1);
    expect(fake.rows('agent_report_settings')[0].last_digest_key).toBe('weekly:2026-10-12');
  });

  it('is sent on the first run after Monday if Monday\'s was missed', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-14T10:00:00.000Z');
    await opt(A, 'weekly');
    expect((await job.runAgentReports(deps(TUESDAY))).sent).toBe(1);
  });

  it('a week with no activity sends nothing', async () => {
    await newTin(A);
    await opt(A, 'weekly');
    expect(await job.runAgentReports(deps(MONDAY))).toMatchObject({ sent: 0, notNeeded: 1 });
  });

  it('is that account\'s numbers only', async () => {
    const a = await newTin(A);
    const b = await newTin(B);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-14T10:00:00.000Z');
    for (let i = 0; i < 6; i++) await put(B, b.id, 'registry_flagged', 'flagged', addr(50 + i), '2026-10-14T10:00:00.000Z');
    await opt(A, 'weekly');
    await job.runAgentReports(deps(MONDAY));
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/^1 needs your attention/);
  });

  it('changing cadence never suppresses the first digest of the new one', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-14T10:00:00.000Z');
    await opt(A, 'daily');
    await job.runAgentReports(deps(SUNDAY));
    expect(sent).toHaveLength(1);
    await opt(A, 'weekly');
    await job.runAgentReports(deps(MONDAY));
    expect(sent).toHaveLength(2);
  });
});

describe('the job reads only what it needs', () => {
  it('every statement names the account it is about, except the two reads that have to visit every account', async () => {
    const a = await newTin(A);
    await put(A, a.id, 'registry_flagged', 'flagged', addr(1), '2026-10-17T10:00:00.000Z');
    await opt(A, 'daily');
    await job.runAgentReports(deps(SUNDAY));
    const sqls = fake.log.map((s) => s.sql).filter((sql) => /^(SELECT|INSERT|UPDATE)\b/i.test(sql) && /\b(agent_\w+)\b/.test(sql));
    const unscoped = sqls.filter((sql) => !/\btenant_id\b/.test(sql));
    expect(unscoped).toEqual([]);
    const crossAccount = sqls.filter((sql) => /^(SELECT|UPDATE)\b/i.test(sql) && !/tenant_id = \?/.test(sql));
    expect(crossAccount.map((s) => s.replace(/\s+/g, ' ').slice(0, 60))).toEqual([
      'SELECT tenant_id, id FROM agent_tins WHERE deleted_at IS NUL',
      "SELECT tenant_id, cadence, last_digest_key FROM agent_report_settings WHERE cadence <> 'off' ORDER BY tenant_id ASC LIMIT ?".slice(0, 60),
    ]);
  });
});
