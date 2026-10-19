import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { failed, fakeTimers, okBody } from '../helpers/fakeTimers';
import { CATCH_UP_MS, POLL_MS, createFeedPoller } from '../../src/components/agentics/feedPoller';
import type { FeedRow } from '../../src/components/agentics/feedRows';
import type { ApiResult, Send } from '../../src/components/agentics/client';

/**
 * The page's poll joined to the feed's real read side, with nothing between them but a fake database and a clock
 * that never runs by itself. Each half has its own tests; this is for what only shows when they meet: a burst
 * larger than one turn of the poller carries, events that become visible a moment late, and what a quiet poll costs.
 */
const holder = vi.hoisted(() => ({
  db: null as any,
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
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));

const A = 'tenant-a';
const NOW = new Date('2026-10-19T12:00:00.000Z');

/** The server's clock for the feed's reads; the tests move it, never the real one. */
let clockMs = NOW.getTime();
/** How many events each of the page's requests got back. */
const answered: number[] = [];
/** How many of the page's next requests fail (500) before the server answers again. */
let failNext = 0;

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let events: typeof import('../../src/lib/agentVault/events');
let feed: typeof import('../../src/lib/agentVault/feed');
let tinId = '';

beforeEach(async () => {
  vi.stubGlobal('fetch', () => { throw new Error('the network is off in this test'); });
  vi.resetModules();
  clockMs = NOW.getTime();
  answered.length = 0;
  failNext = 0;
  fake = createReceivablesDbFake();
  holder.db = fake;
  holder.intercept = null;
  store = await import('../../src/lib/agentVault/store');
  events = await import('../../src/lib/agentVault/events');
  feed = await import('../../src/lib/agentVault/feed');
  await events.ensureAgentEventsTable();
  tinId = (await store.insertTin(A, { label: 'Treasury agent', agentKeyId: null, at: '2026-10-01 00:00:00' })).id;
});

let seq = 0;
function put(writtenAt: string, id?: string) {
  seq += 1;
  const eid = id ?? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  fake.seed('agent_events', {
    id: eid, tenant_id: A, tin_id: tinId, kind: 'checked', address: addr(1), chain: null, answer: 'unknown', registry: 'none', status: 'unknown', key_id: null,
    source_ip: 'hash', tx_hash: null, direction: null, wallet: null, amount: null, asset: null, asset_contract: null, usd_value: null, block_number: null,
    detail_json: '{"basis":"not_in_registry"}', occurred_at: `${writtenAt.replace(' ', 'T')}.000Z`, created_at: writtenAt,
  });
  return eid;
}

/** The page's request, answered by the feed's real read side. */
const send: Send = async (_method, url) => {
  if (failNext > 0) {
    failNext -= 1;
    return failed(500);
  }
  const q = new URL(`https://almstins.com${url}`).searchParams;
  const r = await feed.readFeed(A, { since: q.get('since'), after: q.get('after'), limit: q.get('limit'), tinId: q.get('tinId') }, () => new Date(clockMs));
  if (r.ok) {
    answered.push(r.events.length);
    return okBody({ ...r }) as ApiResult;
  }
  return failed(r.error === 'tin_not_found' ? 404 : 400, r.error);
};

async function open() {
  const first = await feed.readFeed(A, {}, () => new Date(clockMs));
  if (!first.ok) throw new Error('could not open');
  const timers = fakeTimers();
  const rows: FeedRow[] = [];
  const poller = createFeedPoller(
    { send, setTimer: timers.setTimer, clearTimer: timers.clearTimer, visible: () => true, onRows: (r) => rows.push(...r), onState: () => {}, now: timers.now },
    { since: first.since, seen: first.events },
  );
  poller.start();
  return { timers, rows, poller };
}

describe('a burst larger than one turn of the poller carries', () => {
  it('delivers all of a burst of 1,500 events written in one second, and the events written after it, each once (a poll that began again from `since` would never get past the first 1,000)', async () => {
    for (let i = 0; i < 5; i += 1) put(`2026-10-19 11:00:0${i}`);
    const page = await open();
    const burst = Array.from({ length: 1500 }, () => put('2026-10-19 11:30:00'));
    const later = [put('2026-10-19 11:30:09'), put('2026-10-19 11:30:12'), put('2026-10-19 11:31:00')];
    for (let turn = 0; turn < 40 && page.rows.length < burst.length + later.length; turn += 1) await page.timers.fire();
    const got = page.rows.map((r) => r.id);
    expect(new Set(got).size).toBe(got.length);
    expect(got.length).toBe(1503);
    for (const id of [...burst, ...later]) expect(got).toContain(id);
  });

  it('delivers a burst of 900 in full and goes back to the usual pace', async () => {
    const page = await open();
    const burst = Array.from({ length: 900 }, () => put('2026-10-19 11:30:00'));
    await page.timers.fire();
    // Every row of the burst, once each.
    expect(new Set(page.rows.flat().map((r) => r.id))).toEqual(new Set(burst));
    expect(page.rows.flat()).toHaveLength(900);
    expect(page.timers.delays()).toEqual([POLL_MS]);
  });
});

describe('events that become visible a moment late', () => {
  it('are delivered: an event stamped two seconds BEFORE the newest one the page has seen is still found, because every poll starts five seconds early', async () => {
    put('2026-10-19 11:00:00');
    const page = await open();
    put('2026-10-19 11:30:10');
    await page.timers.fire();
    expect(page.rows).toHaveLength(1);
    // A write that was slow to commit: stamped at 11:30:08, it becomes visible after the page has seen 11:30:10.
    const late = put('2026-10-19 11:30:08');
    await page.timers.fire();
    expect(page.rows.map((r) => r.id)).toContain(late);
    expect(page.rows).toHaveLength(2);
  });

  it('are found even when stamped well before the newest, if they show before that newest second has settled (six seconds after the page first saw it)', async () => {
    put('2026-10-19 11:00:00');
    const page = await open();
    put('2026-10-19 11:30:30');
    await page.timers.fire(); // three seconds on: the page sees 11:30:30
    const late = put('2026-10-19 11:30:20'); // ten seconds before it, and showing now
    await page.timers.fire();
    expect(page.rows.flat().map((r) => r.id)).toContain(late);
  });

  it('are lost, honestly, only when they show long after their stamp: one that shows after the newest second has settled is not looked for again', async () => {
    put('2026-10-19 11:00:00');
    const page = await open();
    put('2026-10-19 11:30:30');
    // Three seconds, six, nine and twelve on: 11:30:30 is first seen at three and has settled by nine, so from the poll after that the window starts past it.
    for (let i = 0; i < 4; i += 1) await page.timers.fire();
    const tooLate = put('2026-10-19 11:30:20');
    await page.timers.fire();
    expect(page.rows.flat().map((r) => r.id)).not.toContain(tooLate);
  });

  it('are found behind the cursor of a backlog that was interrupted, too: a row that shows while the read waits to carry on, stamped before the cursor, is read by the pass after it', async () => {
    put('2026-10-19 11:00:00');
    const page = await open();
    // A burst of 1,500 in one second needs more than one turn (ten pages of a hundred).
    const burst = Array.from({ length: 1500 }, () => put('2026-10-19 11:30:10'));
    await page.timers.fire(); // the first turn: ten pages, a cursor left
    expect(page.timers.delays()).toEqual([CATCH_UP_MS]);
    failNext = 1;
    await page.timers.fire(); // the carry-on fails: the read waits six seconds, with the cursor kept
    expect(page.timers.delays()).toEqual([6000]);
    // Meanwhile a write that was slow to commit shows, stamped before the cursor's second, and newer rows arrive:
    // when the read carries on it reaches the newer rows, and the cursor never goes back for the late one.
    const late = put('2026-10-19 11:30:08');
    const newer = put('2026-10-19 11:30:20');
    for (let i = 0; i < 8; i += 1) await page.timers.fire();
    const got = page.rows.flat().map((r) => r.id);
    expect(got).toContain(newer);
    expect(got).toContain(late);
    for (const id of burst) expect(got).toContain(id);
    expect(new Set(got).size).toBe(got.length);
  });
});

describe('what a page left open on a quiet ledger costs the database', () => {
  it('is one statement a poll, and none of them reads a row once the newest second has settled: the window moves past it', async () => {
    put('2026-10-19 11:00:00');
    const page = await open();
    const perPoll: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      clockMs += POLL_MS;
      let statements = 0;
      holder.intercept = () => {
        statements += 1;
      };
      await page.timers.fire();
      perPoll.push(statements);
    }
    holder.intercept = null;
    // The opening row (11:00:00) is in the server's window for the first two polls (six seconds after the page opened it has settled);
    // the page dropped it as one it had. From the third poll on the window is past it and the answers are empty.
    expect(answered).toEqual([1, 1, ...Array(18).fill(0)]);
    expect(page.rows).toHaveLength(0);
    // The poll that names the row finds the remembered names out of date (three statements); every poll after that is one cheap question.
    expect(Math.max(...perPoll)).toBeLessThanOrEqual(3);
    expect(perPoll.slice(2)).toEqual(Array(18).fill(1));
  });
});
