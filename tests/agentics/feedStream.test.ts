import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { fakeTimers, failed, okBody } from '../helpers/fakeTimers';
import { createFeedPoller } from '../../src/components/agentics/feedPoller';
import type { FeedRow } from '../../src/components/agentics/feedRows';
import type { ApiResult, Send } from '../../src/components/agentics/client';

/**
 * A steady, dense stream on a link that takes time, the case the random histories of feedFuzz.test.ts reach only by
 * luck: twenty-five rows a second for two and a half minutes, a quarter of them showing 4.999 seconds after their stamp
 * (the latest the server's overlap promises), and every request taking 0.3 to 1 second to be answered, so a turn of
 * several pages lasts a second or two and the page learns of a row well after the server read it.
 *
 * What it pins is WHERE the poll stamps "first seen": the moment the answer reached the page. Stamped when the turn
 * began instead, a value counts as settled up to a turn's length early, a pass moves `since` past a row that has not
 * shown yet, and rows are lost without a sound (the poll made that mistake once in review: 37 rows in every history).
 * The page's clock, the server's and the stamps on the rows are one clock here, moved by the timers.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: async (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));

const A = 'tenant-a';
const BASE = Date.UTC(2026, 9, 19, 12, 0, 0);
const STREAM_MS = 150_000;
const QUIET_MS = 60_000;
const ROWS_PER_SECOND = 25;

let fake: ReceivablesDbFake;
let store: typeof import('../../src/lib/agentVault/store');
let events: typeof import('../../src/lib/agentVault/events');
let feed: typeof import('../../src/lib/agentVault/feed');

beforeEach(async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('the network is off in this test');
  });
  vi.resetModules();
  fake = createReceivablesDbFake();
  holder.db = fake;
  store = await import('../../src/lib/agentVault/store');
  events = await import('../../src/lib/agentVault/events');
  feed = await import('../../src/lib/agentVault/feed');
  await events.ensureAgentEventsTable();
});

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

async function run(seed: number, rtt: [number, number]) {
  const rnd = mulberry32(seed);
  const tin = (await store.insertTin(A, { label: 'Stream', agentKeyId: null, at: '2026-10-01 00:00:00' })).id;
  const timers = fakeTimers();
  const world = () => BASE + timers.now();
  const expected = new Set<string>();
  const pending: Array<{ row: Record<string, unknown>; visibleAt: number }> = [];
  let streamedUntil = BASE;
  let counter = 0;
  /** The rows of every second that has begun, once each: stamped at its start, showing at once or 4.999 seconds later. */
  const stream = () => {
    while (streamedUntil <= world() && streamedUntil < BASE + STREAM_MS) {
      for (let j = 0; j < ROWS_PER_SECOND; j += 1) {
        counter += 1;
        const id = `00000000-0000-4000-8000-${String(Math.floor(rnd() * 1e9)).padStart(9, '0')}${String(counter).padStart(3, '0')}`;
        const row = {
          id, tenant_id: A, tin_id: tin, kind: 'checked', address: addr(1), chain: null, answer: 'unknown', registry: 'none', status: 'unknown', key_id: null,
          source_ip: 'h', tx_hash: null, direction: null, wallet: null, amount: null, asset: null, asset_contract: null, usd_value: null, block_number: null,
          detail_json: '{"basis":"not_in_registry"}', occurred_at: new Date(streamedUntil).toISOString(), created_at: stamp(streamedUntil),
        } as Record<string, unknown>;
        expected.add(id);
        if (rnd() < 0.25) pending.push({ row, visibleAt: streamedUntil + 4999 });
        else fake.seed('agent_events', row);
      }
      streamedUntil += 1000;
    }
  };
  const flush = () => {
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      if (pending[i].visibleAt <= world()) {
        fake.seed('agent_events', pending[i].row);
        pending.splice(i, 1);
      }
    }
  };

  const delivered: string[] = [];
  let requests = 0;
  const send: Send = async (_m, url) => {
    stream();
    flush();
    const q = new URL(`https://almstins.com${url}`).searchParams;
    const r = await feed.readFeed(A, { since: q.get('since'), after: q.get('after'), limit: q.get('limit'), tinId: q.get('tinId') }, () => new Date(world()));
    if (!r.ok) return failed(400, r.error);
    requests += 1;
    // The answer reaches the page after the server has read.
    timers.advance(rtt[0] + Math.floor(rnd() * (rtt[1] - rtt[0])));
    return okBody({ ...r }) as ApiResult;
  };
  const first = await feed.readFeed(A, {}, () => new Date(world()));
  if (!first.ok) throw new Error('could not open');
  const poller = createFeedPoller(
    { send, setTimer: timers.setTimer, clearTimer: timers.clearTimer, visible: () => true, onRows: (r: FeedRow[]) => delivered.push(...r.map((x) => x.id)), onState: () => {}, now: world },
    { since: first.since, seen: first.events },
  );
  poller.start();
  let turns = 0;
  while (world() < BASE + STREAM_MS + QUIET_MS && turns < 3000) {
    turns += 1;
    stream();
    flush();
    await timers.fire();
  }
  stream();
  flush();
  const got = new Map<string, number>();
  for (const id of delivered) got.set(id, (got.get(id) ?? 0) + 1);
  const missing = [...expected].filter((id) => !got.has(id));
  const repeated = [...got.values()].filter((n) => n > 1).length;
  return { expected: expected.size, missing: missing.length, repeated, requests, turns };
}

describe('a dense stream whose rows show up to 4.999 seconds late, over a link that takes time', () => {
  for (const [name, rtt] of [
    ['0.3 to 0.5 seconds', [300, 500]],
    ['0.6 to 1 second', [600, 1000]],
  ] as Array<[string, [number, number]]>) {
    for (const seed of [1, 2, 3]) {
      it(`hands over every row once (seed ${seed}, a request takes ${name})`, async () => {
        const r = await run(seed, rtt);
        expect(r.expected, 'the stream wrote what it should').toBe(STREAM_MS / 1000 * ROWS_PER_SECOND);
        expect(r.missing, `rows that showed and were never handed over (of ${r.expected})`).toBe(0);
        expect(r.repeated, 'rows handed over more than once').toBe(0);
        expect(r.turns, 'the poll did not settle').toBeLessThan(3000);
      }, 120_000);
    }
  }
});
