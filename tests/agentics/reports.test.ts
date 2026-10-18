import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { txHash } from '../helpers/fakeExplorer';

/**
 * Making, storing, listing and reading operator reports, over the real SQL run by the in-memory
 * stand-in for the database (it evaluates WHERE clauses, so a dropped `AND tenant_id = ?` shows up
 * as a wrong answer). The signing key is a seed generated for each test and signs nothing outside
 * it. Every address, label, tenant and amount is invented.
 */
const holder = vi.hoisted(() => ({
  db: null as any,
  /** Runs before each statement; may throw to play a database error, or return a promise to park the statement. */
  intercept: null as null | ((sql: string, args: unknown[]) => void | Promise<void>),
}));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (s: any) => {
      const sql = typeof s === 'string' ? s : s.sql;
      await holder.intercept?.(sql.replace(/\s+/g, ' ').trim(), typeof s === 'string' ? [] : s.args ?? []);
      return holder.db.execute(s);
    },
    batch: (s: any, m?: any) => holder.db.batch(s, m),
  },
}));

const A = 'tenant-a';
const B = 'tenant-b';
const DAY = '2026-10-17';
const NOW = new Date('2026-10-18T09:10:00.000Z'); // the daily job's time: the day after DAY
const at = (h: number, m = 0, s = 0, ms = 0) => new Date(Date.UTC(2026, 9, 17, h, m, s, ms)).toISOString();

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let events: typeof import('../../src/lib/agentVault/events');
let reports: typeof import('../../src/lib/agentVault/reports');
let reportStore: typeof import('../../src/lib/agentVault/reportStore');
let proof: typeof import('../../src/lib/agentVault/reportProof');

const seed = () => randomBytes(32).toString('hex');
const useKey = (s: string | null) => {
  vi.stubEnv('ALMSTINS_SIGNING_KEY', s ?? '');
  vi.stubEnv('ALMSTINS_SIGNING_PUBKEY', '');
  vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', '');
};

let ids = 0;
const deps = (now: Date = NOW) => ({ now: () => now, newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}` });

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  ids = 0;
  useKey(seed());
  store = await import('../../src/lib/agentVault/store');
  events = await import('../../src/lib/agentVault/events');
  reports = await import('../../src/lib/agentVault/reports');
  reportStore = await import('../../src/lib/agentVault/reportStore');
  proof = await import('../../src/lib/agentVault/reportProof');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

const newTin = (tenant = A, label = 'Treasury agent', createdAt = '2026-10-01 00:00:00') =>
  store.insertTin(tenant, { label, agentKeyId: null, at: createdAt });

let n = 0;
const put = (tenant: string, tinId: string, basis: string, answer: 'proven' | 'consistent-with-history' | 'flagged' | 'unknown', address: string, when: string) =>
  events.insertCheckedEvent(tenant, {
    tinId, address, chain: null, answer, registry: 'none', status: 'unknown', keyId: `k${++n}`, sourceIp: null, detail: { basis }, at: when,
  });
const putTransfer = (tenant: string, tinId: string, direction: 'in' | 'out', usd: number | null, when: string, leg = `native:${++n}`) =>
  events.insertTransactionEvent(tenant, {
    tinId, address: addr(2), chain: 'ethereum', leg, answer: 'unknown', status: null,
    tx: { hash: txHash(n), direction, wallet: addr(1), amount: '1', asset: 'ETH', assetContract: null, usd, blockNumber: 1 },
    detail: { reason: 'no_preceding_check' }, at: when,
  });

describe('making a report', () => {
  it('writes version 1 for the tin and the day, from the ledger, and signs it', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(2), at(9));
    await put(A, tin.id, 'domain_proof', 'proven', addr(3), at(10));
    await putTransfer(A, tin.id, 'in', 250.5, at(11));

    const made = await reports.generateReport(A, tin, DAY, deps());
    expect(made.created).toBe(true);
    const r = made.report;
    expect(r).toMatchObject({ tinId: tin.id, version: 1, periodStart: '2026-10-17T00:00:00.000Z', periodEnd: '2026-10-18T00:00:00.000Z', generatedAt: NOW.toISOString() });
    expect(r.content.period.partial).toBe(false);
    expect(r.content.buckets.issues.listed.map((a) => a.address)).toEqual([addr(1)]);
    expect(r.content.buckets.not_confirmed.listed.map((a) => a.address)).toEqual([addr(2)]);
    expect(r.content.buckets.no_issues).toEqual({ addresses: 1, checks: 1 });
    expect(r.content.strip.bought.usd).toBe(250.5);
    expect(r.signature).not.toBeNull();
    expect(r.manifest).toMatchObject({ record_type: 'agent_report', version: 1, prev_root: null, period: DAY });

    const rows = fake.rows('agent_reports');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: r.id, tenant_id: A, tin_id: tin.id, version: 1, content_hash: r.contentHash, signing_key_id: r.signature!.keyId });
    expect(JSON.parse(rows[0].summary_json)).toEqual(JSON.parse(JSON.stringify(r.content)));
  });

  it('reads only the events of that tin and that day', async () => {
    const tin = await newTin();
    const other = await newTin(A, 'Other agent');
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(1), at(8));
    await put(A, other.id, 'not_in_registry', 'unknown', addr(2), at(8)); // another tin
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(3), '2026-10-16T23:59:59.999Z'); // the day before
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(4), '2026-10-18T00:00:00.000Z'); // the day after
    const { report } = await reports.generateReport(A, tin, DAY, deps());
    expect(report.content.buckets.not_confirmed.listed.map((a) => a.address)).toEqual([addr(1)]);
  });

  it('puts the registry\'s label on a listed address', async () => {
    const tin = await newTin();
    await store.insertDestination(A, { tinId: tin.id, chain: 'ethereum', address: addr(1), label: 'Exchange deposit', at: '2026-10-02 00:00:00' });
    await put(A, tin.id, 'registry_pending', 'unknown', addr(1), at(8));
    const { report } = await reports.generateReport(A, tin, DAY, deps());
    expect(report.content.buckets.not_confirmed.listed[0]).toMatchObject({ address: addr(1), label: 'Exchange deposit' });
  });

  it('a day with no activity is a report of zeros (when it is asked for), not a failure', async () => {
    const tin = await newTin();
    const { report, created } = await reports.generateReport(A, tin, DAY, deps());
    expect(created).toBe(true);
    expect(report.content.events).toEqual({ checked: 0, transaction: 0 });
    expect(report.manifest!.leaf_count).toBe(1); // the summary leaf
  });

  it('says a report is partial when it was made before its day ended', async () => {
    const tin = await newTin();
    const during = await reports.generateReport(A, tin, DAY, deps(new Date('2026-10-17T15:00:00.000Z')));
    expect(during.report.content.period.partial).toBe(true);
    const after = await reports.generateReport(A, tin, DAY, deps(new Date('2026-10-18T00:00:00.000Z')));
    expect(after.report.content.period.partial).toBe(false);
    // Same words but no longer partial: that is a new version.
    expect([during.report.version, after.report.version]).toEqual([1, 2]);
  });
});

describe('making it again changes nothing', () => {
  it('when nothing has changed it hands back the version it has and writes nothing', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const first = await reports.generateReport(A, tin, DAY, deps());
    const writes = () => fake.statements(/^INSERT INTO agent_reports/);
    expect(writes()).toHaveLength(1);

    const later = await reports.generateReport(A, tin, DAY, deps(new Date('2026-10-18T10:00:00.000Z')));
    expect(later.created).toBe(false);
    expect(later.report.id).toBe(first.report.id);
    expect(later.report.generatedAt).toBe(first.report.generatedAt); // the older snapshot stands
    expect(writes()).toHaveLength(1);
    expect(fake.rows('agent_reports')).toHaveLength(1);
  });

  it('running the job many times in a row still leaves one version', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(1), at(8));
    for (let i = 0; i < 5; i++) await reports.generateReport(A, tin, DAY, deps());
    expect(fake.rows('agent_reports')).toHaveLength(1);
  });

  it('an event recorded after the report was made gives a NEW version, chained to the one before, and the old one stays as it was', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const v1 = (await reports.generateReport(A, tin, DAY, deps())).report;

    // The watcher records a transfer for that day the next morning, after the report.
    await putTransfer(A, tin.id, 'out', 75, at(23, 58));
    const v2made = await reports.generateReport(A, tin, DAY, deps(new Date('2026-10-18T10:00:00.000Z')));
    expect(v2made.created).toBe(true);
    const v2 = v2made.report;

    expect(v2.version).toBe(2);
    expect(v2.content.strip.sold.usd).toBe(75);
    expect(v2.manifest!.prev_root).toBe(v1.merkleRoot);
    expect(v1.merkleRoot).not.toBe(v2.merkleRoot);

    const rows = fake.rows('agent_reports');
    expect(rows.map((r) => r.version).sort()).toEqual([1, 2]);
    const stored1 = rows.find((r) => r.version === 1)!;
    expect(JSON.parse(stored1.summary_json).strip.transfers).toBe(0); // the first snapshot is still what it was
    expect(stored1.id).toBe(v1.id);
  });

  it('two reports being made at once write exactly one version', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const [x, y] = await Promise.all([reports.generateReport(A, tin, DAY, deps()), reports.generateReport(A, tin, DAY, deps())]);
    expect(fake.rows('agent_reports')).toHaveLength(1);
    expect(fake.statements(/^INSERT INTO agent_reports/)).toHaveLength(2); // both tried; the table kept one
    expect([x.created, y.created].sort()).toEqual([false, true]);
    expect(x.report.id).toBe(y.report.id);
  });

  it('two writers with different content take different version numbers, never the same one', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    // The second writer reads the ledger after a new event has landed, a moment later.
    let releaseSecond!: () => void;
    const gate = new Promise<void>((r) => { releaseSecond = r; });
    const first = reports.generateReport(A, tin, DAY, deps());
    const second = (async () => {
      await gate;
      return reports.generateReport(A, tin, DAY, deps(new Date(NOW.getTime() + 1_000)));
    })();
    await first;
    await putTransfer(A, tin.id, 'in', 10, at(9));
    releaseSecond();
    await second;
    expect(fake.rows('agent_reports').map((r) => r.version).sort()).toEqual([1, 2]);
  });

  it('a version number that is taken is skipped, not overwritten', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const v1 = (await reports.generateReport(A, tin, DAY, deps())).report;
    await putTransfer(A, tin.id, 'in', 10, at(9));
    // Another writer takes version 2 between this writer's read of the newest version and its insert.
    let raced = false;
    holder.intercept = (sql) => {
      if (!raced && /^INSERT INTO agent_reports/.test(sql)) {
        raced = true;
        fake.seed('agent_reports', { ...fake.rows('agent_reports')[0], id: 'other-writer', version: 2, content_hash: 'different', generated_at: NOW.toISOString() });
      }
    };
    const made = await reports.generateReport(A, tin, DAY, deps(new Date('2026-10-18T11:00:00.000Z')));
    expect(made.created).toBe(true);
    expect(made.report.version).toBe(3);
    expect(made.report.manifest!.prev_root).toBe(v1.merkleRoot); // chained to what the writer last saw as newest (version 2's row, which carries v1's root)
    expect(fake.rows('agent_reports').map((r) => r.version).sort()).toEqual([1, 2, 3]);
    expect(fake.rows('agent_reports').find((r) => r.id === 'other-writer')!.content_hash).toBe('different');
  });
});

describe('a snapshot is only a newer version if it is a newer snapshot', () => {
  it('an older snapshot that was slow to write is handed back as the newer one that got there first, and stores nothing', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    // A reads the ledger (one event) at 10:30, then waits at its check of the newest version.
    let release!: () => void;
    const opened = new Promise<void>((r) => { release = r; });
    let parked = false;
    holder.intercept = async (sql) => {
      if (!parked && /FROM agent_reports/.test(sql)) {
        parked = true;
        await opened;
      }
    };
    const slow = reports.generateReport(A, tin, DAY, deps(new Date('2026-10-18T10:30:00.000Z')));
    await vi.waitFor(() => expect(parked).toBe(true));
    // Meanwhile another event lands and a later snapshot (11:00, two events) becomes version 1.
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(2), at(9));
    const fast = await reports.generateReport(A, tin, DAY, deps(new Date('2026-10-18T11:00:00.000Z')));
    expect(fast).toMatchObject({ created: true, report: { version: 1 } });
    expect(fast.report.content.events.checked).toBe(2);

    release();
    const late = await slow;
    expect(late.created).toBe(false);
    expect(late.report.id).toBe(fast.report.id);
    expect(late.report.content.events.checked).toBe(2); // what it hands back is the fuller snapshot
    expect(fake.rows('agent_reports')).toHaveLength(1);
    const listed = ok(await reports.listTinReports(A, tin.id));
    expect(listed.reports.map((r) => [r.version, r.headline.checks, r.generatedAt])).toEqual([[1, 2, '2026-10-18T11:00:00.000Z']]);
  });

  it('a snapshot taken at the very moment of the newest version is the newest version, not a copy after it', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const first = await reports.generateReport(A, tin, DAY, deps());
    await putTransfer(A, tin.id, 'in', 5, at(9));
    const same = await reports.generateReport(A, tin, DAY, deps()); // the same instant, different words
    expect(same).toMatchObject({ created: false });
    expect(same.report.id).toBe(first.report.id);
    expect(fake.rows('agent_reports')).toHaveLength(1);
  });

  it('a later snapshot with different words is still a new version, and its time is never earlier than the version before it', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const times = ['2026-10-18T09:00:00.000Z', '2026-10-18T10:00:00.000Z', '2026-10-18T09:30:00.000Z', '2026-10-18T11:00:00.000Z'];
    for (const [i, t] of times.entries()) {
      await putTransfer(A, tin.id, 'in', i + 1, at(10 + i));
      await reports.generateReport(A, tin, DAY, deps(new Date(t)));
    }
    const stored = fake.rows('agent_reports').sort((x, y) => x.version - y.version).map((r) => r.generated_at);
    expect(stored).toEqual(['2026-10-18T09:00:00.000Z', '2026-10-18T10:00:00.000Z', '2026-10-18T11:00:00.000Z']); // the 09:30 snapshot was older than version 2
    expect([...stored].sort()).toEqual(stored);
  });
});

describe('numbering a version from the newest row, and paging by period', () => {
  it('a newest version whose words cannot be read still has its number taken: the next version is the number after it', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const first = (await reports.generateReport(A, tin, DAY, deps())).report;
    // A later release wrote a format this code does not know, in the newest row.
    fake.rows('agent_reports')[0].summary_json = JSON.stringify({ v: 2, tin: {}, period: {}, buckets: {}, strip: {}, events: {} });
    await putTransfer(A, tin.id, 'in', 5, at(9));
    const made = await reports.generateReport(A, tin, DAY, deps(new Date(NOW.getTime() + 1_000)));
    expect(made.created).toBe(true);
    expect(made.report.version).toBe(2);
    expect(made.report.manifest!.prev_root).toBe(first.merkleRoot); // chained to the root in the unreadable row's own column
    expect(fake.rows('agent_reports').map((r) => r.version).sort()).toEqual([1, 2]);
    expect((await reportStore.getNewestVersion(A, tin.id, made.report.periodStart))).toMatchObject({ version: 2, report: { id: made.report.id } });
  });

  it('knows the newest version of a period without reading its words', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const made = (await reports.generateReport(A, tin, DAY, deps())).report;
    fake.rows('agent_reports')[0].summary_json = '{not json';
    expect(await reportStore.getNewestVersion(A, tin.id, made.periodStart)).toEqual({ version: 1, generatedAt: NOW.toISOString(), merkleRoot: made.merkleRoot, report: null });
    expect(await reportStore.getLatestReport(A, tin.id, made.periodStart)).toBeNull();
    expect(await reportStore.getNewestVersion(A, tin.id, '2026-01-01T00:00:00.000Z')).toBeNull();
    expect(await reportStore.getNewestVersion(B, tin.id, made.periodStart)).toBeNull(); // another account reaches nothing
  });

  it('a page is `limit` days even when the newest days have piled up many versions', async () => {
    const tin = await newTin();
    const days = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
    let t = 0;
    for (const day of days) {
      for (let v = 1; v <= 45; v++) {
        await put(A, tin.id, 'not_in_registry', 'unknown', addr(Number(day.slice(-2)) * 100 + v), `${day}T10:${String(v).padStart(2, '0')}:00.000Z`);
        await reports.generateReport(A, tin, day, deps(new Date(Date.UTC(2026, 9, 18, 0, 0, 0) + (t += 1_000))));
      }
    }
    expect(fake.rows('agent_reports')).toHaveLength(180);
    const first = ok(await reports.listTinReports(A, tin.id, { limit: 2 }));
    expect(first.reports.map((r) => [r.day, r.version])).toEqual([['2026-10-17', 45], ['2026-10-16', 45]]);
    expect(first.next).toBe('2026-10-16');
    const second = ok(await reports.listTinReports(A, tin.id, { limit: 2, before: first.next }));
    expect(second.reports.map((r) => [r.day, r.version])).toEqual([['2026-10-15', 45], ['2026-10-14', 45]]);
    expect(second.next).toBe('2026-10-14');
    const last = ok(await reports.listTinReports(A, tin.id, { limit: 2, before: second.next }));
    expect(last.reports).toEqual([]);
    expect(last.next).toBeNull();
    const all = ok(await reports.listTinReports(A, tin.id, { limit: 90 }));
    expect(all.reports.map((r) => r.day)).toEqual([...days].reverse());
  });

  it('picks the highest version of each day whatever order the rows are in, and does it in one statement', async () => {
    const tin = await newTin();
    const row = (version: number, day: string, id: string) => ({
      id, tenant_id: A, tin_id: tin.id, period_start: `${day}T00:00:00.000Z`, period_end: `${day}T23:59:59.999Z`, version, generated_at: NOW.toISOString(),
      content_hash: `h${id}`, summary_json: JSON.stringify({ v: 1, tin: { id: tin.id, label: 'x' }, period: { start: '', end: '', partial: false }, events: { checked: 0, transaction: 0 }, addresses: 0, buckets: {}, strip: {} }),
      merkle_root: null, leaf_count: null, signing_key_id: null, signature_hex: null, manifest_json: null,
    });
    await reportStore.ensureAgentReportsTable();
    for (const r of [row(2, '2026-10-16', 'b2'), row(1, '2026-10-17', 'a1'), row(3, '2026-10-16', 'b3'), row(1, '2026-10-16', 'b1'), row(2, '2026-10-17', 'a2')]) fake.seed('agent_reports', r);
    const before = fake.log.length;
    const got = await reportStore.listLatestReports(A, tin.id, { limit: 5 });
    expect(got.map((r) => [r.id, r.version])).toEqual([['a2', 2], ['b3', 3]]);
    const mine = fake.log.slice(before).filter((s) => /agent_reports/.test(s.sql));
    expect(mine).toHaveLength(1);
    expect(mine[0].sql).toMatch(/\bNOT EXISTS\b/);
    expect(mine[0].sql).toMatch(/\bLIMIT \?$/);
    expect(mine[0].args).toEqual([A, tin.id, 5]);
    expect(await reportStore.listLatestReports(B, tin.id, { limit: 5 })).toEqual([]);
    expect((await reportStore.listLatestReports(A, tin.id, { limit: 5, beforeStart: '2026-10-17T00:00:00.000Z' })).map((r) => r.id)).toEqual(['b3']);
  });
});

describe('signing', () => {
  it('a report made with no signing key is stored unsigned, and says so; it is never presented as signed', async () => {
    useKey(null);
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const { report } = await reports.generateReport(A, tin, DAY, deps());
    expect(report.signature).toBeNull();
    expect(report.manifest!.signing_key_id).toBeNull();
    expect(fake.rows('agent_reports')[0]).toMatchObject({ signature_hex: null, signing_key_id: null });
    expect(reports.verifyStoredReport(report)).toBe('unsigned');
    expect(reports.listItemOf(report).signed).toBe(false);
  });

  it('once a key is configured, the same words get a signed copy as a new version; after that nothing more is written', async () => {
    useKey(null);
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const unsigned = (await reports.generateReport(A, tin, DAY, deps())).report;
    useKey(seed());
    const signed = await reports.generateReport(A, tin, DAY, deps(new Date(NOW.getTime() + 1_000))); // a newer snapshot of the same words
    expect(signed.created).toBe(true);
    expect(signed.report.version).toBe(2);
    expect(signed.report.contentHash).toBe(unsigned.contentHash);
    expect(signed.report.signature).not.toBeNull();
    expect(reports.verifyStoredReport(signed.report)).toBe('verified');
    const again = await reports.generateReport(A, tin, DAY, deps(new Date(NOW.getTime() + 2_000)));
    expect(again.created).toBe(false);
    expect(again.report.id).toBe(signed.report.id);
  });

  it('a signed report stays as it is when the key goes away: no new version, and it reads as unverifiable until a key is back', async () => {
    const key = seed();
    useKey(key);
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const signed = (await reports.generateReport(A, tin, DAY, deps())).report;
    useKey(null);
    const again = await reports.generateReport(A, tin, DAY, deps());
    expect(again.created).toBe(false);
    expect(reports.verifyStoredReport(again.report)).toBe('unverifiable');
    useKey(key);
    expect(reports.verifyStoredReport(signed)).toBe('verified');
  });

  it('a report signed by a key that has since been retired still verifies while its public key is listed', async () => {
    const oldKey = seed();
    useKey(oldKey);
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const signed = (await reports.generateReport(A, tin, DAY, deps())).report;
    const oldPublic = (await import('../../src/lib/recordProof/signing')).getSigningKey()!;
    useKey(seed());
    expect(reports.verifyStoredReport(signed)).toBe('unverifiable');
    vi.stubEnv('ALMSTINS_SIGNING_RETIRED_PUBKEYS', `${oldPublic.keyId}:${oldPublic.publicKeyHex}`);
    expect(reports.verifyStoredReport(signed)).toBe('verified');
  });
});

describe('a stored report that no longer matches what was signed reads as altered', () => {
  const setup = async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(2), at(9));
    const r = (await reports.generateReport(A, tin, DAY, deps())).report;
    return { tin, r, row: () => fake.rows('agent_reports')[0] };
  };
  const reload = async (id: string) => (await reportStore.getReportById(A, id))!;

  it('is verified as stored', async () => {
    const { r } = await setup();
    expect(reports.verifyStoredReport(await reload(r.id))).toBe('verified');
  });

  it('a count changed in the stored words', async () => {
    const { r, row } = await setup();
    const doc = JSON.parse(row().summary_json);
    doc.buckets.issues.addresses = 0;
    row().summary_json = JSON.stringify(doc);
    expect(reports.verifyStoredReport(await reload(r.id))).toBe('altered');
  });

  it('an address changed in the stored words, with the hash fixed up to match', async () => {
    const { r, row } = await setup();
    const doc = JSON.parse(row().summary_json);
    doc.buckets.issues.listed[0].address = addr(99);
    row().summary_json = JSON.stringify(doc);
    row().content_hash = proof.contentHashOf(doc); // an attacker who also fixes the hash is still caught by the signed root
    expect(reports.verifyStoredReport(await reload(r.id))).toBe('altered');
  });

  it('the signed root replaced', async () => {
    const { r, row } = await setup();
    row().merkle_root = 'f'.repeat(64);
    expect(reports.verifyStoredReport(await reload(r.id))).toBe('altered');
  });

  it('the version number or the time changed in its columns', async () => {
    const { r, row } = await setup();
    row().version = 7;
    expect(reports.verifyStoredReport(await reload(r.id))).toBe('altered');
    row().version = 1;
    row().generated_at = '2026-10-18T09:10:00.001Z';
    expect(reports.verifyStoredReport(await reload(r.id))).toBe('altered');
  });

  it('the signature replaced', async () => {
    const { r, row } = await setup();
    row().signature_hex = '0'.repeat(128);
    expect(reports.verifyStoredReport(await reload(r.id))).toBe('altered');
  });

  it('a row whose words cannot be read is skipped, not half-shown', async () => {
    const { r, row, tin } = await setup();
    row().summary_json = '{not json';
    expect(await reportStore.getReportById(A, r.id)).toBeNull();
    const listed = await reports.listTinReports(A, tin.id);
    expect(listed).toMatchObject({ ok: true, reports: [] });
  });
});

describe('asking for a report', () => {
  it('makes the report for a day, says whether it is new, and returns it with its versions', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const first = ok(await reports.generateReportFor(A, tin.id, DAY, deps()));
    expect(first.created).toBe(true);
    expect(first.report).toMatchObject({ day: DAY, version: 1, partial: false, signed: true, verification: 'verified', headline: { issues: 1 } });
    expect(first.report.versions.map((v) => v.version)).toEqual([1]);
    const second = ok(await reports.generateReportFor(A, tin.id, DAY, deps()));
    expect(second.created).toBe(false);
    expect(second.report.id).toBe(first.report.id);
  });

  it('refuses a day that is not a real date, one in the future, and one before the tin existed', async () => {
    const tin = await newTin(A, 'Agent', '2026-10-10 12:00:00');
    for (const day of ['2026-02-30', '17 Oct 2026', '', null, undefined, 20261017, '2026-10-19', '2027-01-01', '2026-10-09']) {
      expect(await reports.generateReportFor(A, tin.id, day, deps()), String(day)).toEqual({ ok: false, error: 'invalid_period' });
    }
    // The day the tin was made, yesterday and today are fine.
    for (const day of ['2026-10-10', '2026-10-17', '2026-10-18']) expect((await reports.generateReportFor(A, tin.id, day, deps())).ok, day).toBe(true);
    expect(fake.rows('agent_reports')).toHaveLength(3);
  });

  it('today is allowed and says it is partial', async () => {
    const tin = await newTin();
    const r = ok(await reports.generateReportFor(A, tin.id, '2026-10-18', deps(new Date('2026-10-18T14:30:00.000Z'))));
    expect(r.report).toMatchObject({ day: '2026-10-18', partial: true });
  });

  it('answers a code for a missing or unknown tin', async () => {
    expect(await reports.generateReportFor(A, undefined, DAY, deps())).toEqual({ ok: false, error: 'invalid_id' });
    expect(await reports.generateReportFor(A, 'x'.repeat(65), DAY, deps())).toEqual({ ok: false, error: 'invalid_id' });
    expect(await reports.generateReportFor(A, 'no-such-tin', DAY, deps())).toEqual({ ok: false, error: 'tin_not_found' });
  });

  it('lists a tin\'s reports newest day first, one per day, the newest version of each', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    await reports.generateReport(A, tin, DAY, deps());
    await putTransfer(A, tin.id, 'in', 5, at(9));
    await reports.generateReport(A, tin, DAY, deps(new Date(NOW.getTime() + 1_000))); // version 2 of the 17th
    await reports.generateReport(A, tin, '2026-10-16', deps());
    await reports.generateReport(A, tin, '2026-10-15', deps());
    const listed = ok(await reports.listTinReports(A, tin.id));
    expect(listed.reports.map((r) => [r.day, r.version])).toEqual([['2026-10-17', 2], ['2026-10-16', 1], ['2026-10-15', 1]]);
    expect(listed.next).toBeNull();
    expect(JSON.stringify(listed)).not.toContain(addr(1)); // a list carries counts, never an address
  });

  it('pages with limit and before, and refuses a cursor that is not a day', async () => {
    const tin = await newTin();
    for (const day of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) await reports.generateReport(A, tin, day, deps());
    const first = ok(await reports.listTinReports(A, tin.id, { limit: '2' }));
    expect(first.reports.map((r) => r.day)).toEqual(['2026-10-16', '2026-10-15']);
    expect(first.next).toBe('2026-10-15');
    const second = ok(await reports.listTinReports(A, tin.id, { limit: 2, before: first.next }));
    expect(second.reports.map((r) => r.day)).toEqual(['2026-10-14', '2026-10-13']);
    const last = ok(await reports.listTinReports(A, tin.id, { limit: 2, before: '2026-10-13' }));
    expect(last.reports.map((r) => r.day)).toEqual(['2026-10-12']);
    expect(last.next).toBeNull();
    expect(await reports.listTinReports(A, tin.id, { before: 'yesterday' })).toEqual({ ok: false, error: 'invalid_cursor' });
    // A limit that is not a positive integer falls back to the default; a huge one is capped.
    expect(ok(await reports.listTinReports(A, tin.id, { limit: 'abc' })).reports).toHaveLength(5);
    expect(ok(await reports.listTinReports(A, tin.id, { limit: 100000 })).reports).toHaveLength(5);
  });

  it('reads one report with every version of its day, newest first', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const v1 = (await reports.generateReport(A, tin, DAY, deps())).report;
    await putTransfer(A, tin.id, 'in', 5, at(9));
    const v2 = (await reports.generateReport(A, tin, DAY, deps(new Date(NOW.getTime() + 1_000)))).report;
    const detail = ok(await reports.getReportDetail(A, v1.id));
    expect(detail.report.id).toBe(v1.id);
    expect(detail.report.versions.map((v) => [v.id, v.version])).toEqual([[v2.id, 2], [v1.id, 1]]);
    expect(detail.report.content.buckets.issues.listed[0].address).toBe(addr(1));
    expect(detail.report.merkleRoot).toBe(v1.merkleRoot);
    expect(await reports.getReportDetail(A, 'no-such-report')).toEqual({ ok: false, error: 'report_not_found' });
    expect(await reports.getReportDetail(A, '')).toEqual({ ok: false, error: 'invalid_id' });
  });
});

describe('handing out a report as a signed document', () => {
  const made = async (tenant = A) => {
    const tin = await newTin(tenant);
    await put(tenant, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    return (await reports.generateReport(tenant, tin, DAY, deps())).report;
  };

  it('gives the report and its bundle only when it is signed and still matches what was signed', async () => {
    const r = await made();
    const got = await reports.signedBundleFor(A, r.id);
    if (!got.ok) throw new Error(JSON.stringify(got));
    expect(got.stored.id).toBe(r.id);
    expect(got.bundle.manifest.record_id).toBe(r.id);
    expect(got.bundle.signature).not.toBeNull();
    expect(proof.verifyReportBundle(got.bundle).verdict).toBe('verified');
  });

  it('each way a report can fall short is its own code, and no bundle comes with it', async () => {
    const r = await made();
    // altered
    fake.rows('agent_reports')[0].merkle_root = 'f'.repeat(64);
    expect(await reports.signedBundleFor(A, r.id)).toEqual({ ok: false, error: 'report_altered' });
    fake.rows('agent_reports')[0].merkle_root = r.merkleRoot;
    expect((await reports.signedBundleFor(A, r.id)).ok).toBe(true);
    // signed, but no published key can confirm it now
    useKey(null);
    expect(await reports.signedBundleFor(A, r.id)).toEqual({ ok: false, error: 'signing_unavailable' });
  });

  it('a report made with no signing key is not_signed', async () => {
    useKey(null);
    const r = await made();
    expect(await reports.signedBundleFor(A, r.id)).toEqual({ ok: false, error: 'not_signed' });
  });

  it('a missing id, an unknown report and another account\'s report', async () => {
    const r = await made();
    expect(await reports.signedBundleFor(A, undefined)).toEqual({ ok: false, error: 'invalid_id' });
    expect(await reports.signedBundleFor(A, 'no-such-report')).toEqual({ ok: false, error: 'report_not_found' });
    expect(await reports.signedBundleFor(B, r.id)).toEqual({ ok: false, error: 'report_not_found' });
  });
});

describe('one account never sees another\'s reports', () => {
  it('a tin id and a report id of another account answer exactly like ones that do not exist', async () => {
    const tinA = await newTin(A);
    await put(A, tinA.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const made = (await reports.generateReport(A, tinA, DAY, deps())).report;

    expect(await reports.getReportDetail(B, made.id)).toEqual({ ok: false, error: 'report_not_found' });
    expect(await reports.listTinReports(B, tinA.id)).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await reports.generateReportFor(B, tinA.id, DAY, deps())).toEqual({ ok: false, error: 'tin_not_found' });
    expect(await reportStore.getReportById(B, made.id)).toBeNull();
    expect(await reportStore.getLatestReport(B, tinA.id, made.periodStart)).toBeNull();
    expect(await reportStore.listLatestReports(B, tinA.id, { limit: 10 })).toEqual([]);
    expect(await reportStore.listLatestReportsForPeriod(B, made.periodStart)).toEqual([]);
  });

  it('two accounts with the SAME tin id each get only their own events and keep their own versions', async () => {
    // Real tin ids are random; this forces a collision to prove every statement names the account.
    const shared = '11111111-1111-4111-8111-111111111111';
    fake.seed('agent_tins', { id: shared, tenant_id: A, label: 'Agent A', agent_key_id: null, created_at: '2026-10-01 00:00:00', deleted_at: null });
    await store.ensureAgentVaultTables();
    fake.seed('agent_tins', { id: shared, tenant_id: B, label: 'Agent B', agent_key_id: null, created_at: '2026-10-01 00:00:00', deleted_at: null });
    await put(A, shared, 'registry_flagged', 'flagged', addr(1), at(8));
    await put(B, shared, 'not_in_registry', 'unknown', addr(2), at(8));
    await putTransfer(B, shared, 'out', 999, at(9));

    const a = await reports.generateReportFor(A, shared, DAY, deps());
    const b = await reports.generateReportFor(B, shared, DAY, deps());
    if (!a.ok || !b.ok) throw new Error('expected both ok');
    expect(a.report.content.tin.label).toBe('Agent A');
    expect(a.report.content.buckets.issues.listed.map((x) => x.address)).toEqual([addr(1)]);
    expect(a.report.content.strip.transfers).toBe(0);
    expect(b.report.content.tin.label).toBe('Agent B');
    expect(b.report.content.buckets.not_confirmed.listed.map((x) => x.address)).toEqual([addr(2)]);
    expect(b.report.content.strip.sold.usd).toBe(999);
    expect(a.report.id).not.toBe(b.report.id);
    expect(fake.rows('agent_reports').map((r) => [r.tenant_id, r.version]).sort()).toEqual([[A, 1], [B, 1]]);
    // Each account's versions are its own.
    expect(a.report.versions.map((v) => v.id)).toEqual([a.report.id]);
  });

  it('every statement that touches reports or the ledger names the account', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const r = (await reports.generateReport(A, tin, DAY, deps())).report;
    await reports.getReportDetail(A, r.id);
    await reports.listTinReports(A, tin.id);
    await reportStore.listLatestReportsForPeriod(A, r.periodStart);
    const touching = fake.log.map((s) => s.sql).filter((sql) => /^(SELECT|INSERT|UPDATE)\b/i.test(sql) && /\b(agent_reports|agent_events)\b/.test(sql));
    expect(touching.length).toBeGreaterThan(5);
    for (const sql of touching) expect(sql, sql).toMatch(/\btenant_id\b/);
  });
});

describe('reading a period from the ledger', () => {
  it('pages through a day oldest first, even when many events share one instant', async () => {
    const tin = await newTin();
    for (let i = 0; i < 10; i++) await put(A, tin.id, 'not_in_registry', 'unknown', addr(i + 1), at(8)); // ten at the very same time
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(20), at(7));
    const seen: Array<{ at: string; id: string }> = [];
    const total = await events.readEventsInRange(A, tin.id, { fromIso: '2026-10-17T00:00:00.000Z', toIso: '2026-10-18T00:00:00.000Z' }, (e) => seen.push({ at: e.at, id: e.id }), { pageSize: 3 });
    expect(total).toBe(11);
    expect(seen).toHaveLength(11);
    expect(new Set(seen.map((s) => s.id)).size).toBe(11);
    const sorted = [...seen].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
    expect(seen).toEqual(sorted);
    expect(fake.statements(/FROM agent_events/).length).toBeGreaterThanOrEqual(4);
  });

  it('knows cheaply whether a tin had any activity in a period', async () => {
    const tin = await newTin();
    const range = { fromIso: '2026-10-17T00:00:00.000Z', toIso: '2026-10-18T00:00:00.000Z' };
    expect(await events.hasEventsInRange(A, tin.id, range)).toBe(false);
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(1), '2026-10-18T00:00:00.000Z');
    expect(await events.hasEventsInRange(A, tin.id, range)).toBe(false); // the end is exclusive
    await put(A, tin.id, 'not_in_registry', 'unknown', addr(1), '2026-10-17T00:00:00.000Z');
    expect(await events.hasEventsInRange(A, tin.id, range)).toBe(true);
    expect(await events.hasEventsInRange(B, tin.id, range)).toBe(false);
  });
});

describe('the table only grows', () => {
  it('making, listing and reading reports never updates or removes a row', async () => {
    const tin = await newTin();
    await put(A, tin.id, 'registry_flagged', 'flagged', addr(1), at(8));
    const r = (await reports.generateReport(A, tin, DAY, deps())).report;
    await putTransfer(A, tin.id, 'in', 5, at(9));
    await reports.generateReport(A, tin, DAY, deps());
    await reports.listTinReports(A, tin.id);
    await reports.getReportDetail(A, r.id);
    const writes = fake.log.map((s) => s.sql).filter((sql) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql) && /agent_reports/.test(sql));
    expect(writes.length).toBeGreaterThan(0);
    for (const sql of writes) expect(sql, sql).toMatch(/^INSERT INTO agent_reports/);
  });
});
