import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createReceivablesDbFake, type ReceivablesDbFake } from '../helpers/receivablesDbFake';
import { addr } from '../helpers/agentVault';
import { failed, fakeTimers, okBody, settle } from '../helpers/fakeTimers';
import { createFeedPoller } from '../../src/components/agentics/feedPoller';
import type { FeedRow } from '../../src/components/agentics/feedRows';
import type { ApiResult, Send } from '../../src/components/agentics/client';

/**
 * The page's poll joined to the feed's real read side over the in-memory database, under one clock and with faults,
 * for a few hundred random histories (seeded, so a failure repeats). The page's clock, the server's and the stamps
 * on the rows are all this one clock; timers move it. What is written: trickles, bursts (hundreds of rows in the
 * same second), and writes that show LATE (stamped now, visible up to four seconds later, inside the five seconds
 * the server's overlap promises). What goes wrong around it: requests that fail (500, 429, no answer), a tab that
 * is hidden and shown, a backlog read that is cut short and carried on. Every third history runs over a SLOW LINK
 * (a request takes 0.2 to 1 second, so the page learns of a row later than the server read it: where the poll
 * stamps "first seen" matters only then); every second history also writes rows of an agent that has been
 * REMOVED (the server counts them and the page cannot show them); every fifth is a DENSE stream (twenty-five rows a
 * second, a quarter of them showing up to 4.999 seconds late) over a slow link; a history that writes a removed
 * agent's rows ends the writing with a burst of them, newer than anything the page can show.
 *
 * What must hold: every row that became visible is handed to the page exactly once; and a ledger that has gone
 * quiet costs next to nothing (the poll does not read the same burst for as long as the page is open).
 *
 * It was written for two faults the model found in the first version of the poll: a late row behind the cursor of
 * a backlog being read was never returned, and a quiet ledger after a burst was read in full on every poll.
 * FUZZ_SEEDS=300 runs more seeds than the suite does.
 */
const holder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/db', () => ({ db: { execute: async (s: any) => holder.db.execute(s), batch: (s: any, m?: any) => holder.db.batch(s, m) } }));
vi.mock('@/lib/agentKeys', () => ({ listAgentKeys: async () => [] }));

const A = 'tenant-a';
/** The world's time at 0 on the timers' clock. */
const BASE = Date.UTC(2026, 9, 19, 12, 0, 0);
const SEEDS = Math.max(1, Number(process.env.FUZZ_SEEDS) || 24);

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

describe('the poll and the read side together, under faults and a clock', () => {
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    it(`history ${seed}: every visible row once, and quiet when the ledger is quiet`, async () => {
      const rnd = mulberry32(seed);
      const tins = [
        (await store.insertTin(A, { label: 'One', agentKeyId: null, at: '2026-10-01 00:00:00' })).id,
        (await store.insertTin(A, { label: 'Two', agentKeyId: null, at: '2026-10-01 00:00:01' })).id,
      ];
      const removedTin = (await store.insertTin(A, { label: 'Removed', agentKeyId: null, at: '2026-10-01 00:00:02' })).id;
      await store.softDeleteTin(A, removedTin, '2026-10-01 00:00:03');
      const withRemoved = seed % 2 === 0;
      const dense = seed % 5 === 0;
      const slowLink = seed % 3 === 0 || dense;
      const rtt = () => (dense ? 600 + Math.floor(rnd() * 400) : slowLink ? 200 + Math.floor(rnd() * 800) : 0);
      const timers = fakeTimers();
      const world = () => BASE + timers.now();
      let counter = 0;
      const rows = new Map<string, { visibleAt: number }>();
      const pending: Array<{ id: string; row: Record<string, unknown>; visibleAt: number }> = [];
      const makeRow = (stampMs: number, onlyRemoved = false) => {
        counter += 1;
        const id = `00000000-0000-4000-8000-${String(Math.floor(rnd() * 1e9)).padStart(9, '0')}${String(counter).padStart(3, '0')}`;
        const ofRemoved = onlyRemoved || (withRemoved && rnd() < 0.2);
        return {
          id,
          ofRemoved,
          row: {
            id, tenant_id: A, tin_id: ofRemoved ? removedTin : tins[Math.floor(rnd() * 2)], kind: 'checked', address: addr(1), chain: null, answer: 'unknown', registry: 'none', status: 'unknown', key_id: null,
            source_ip: 'h', tx_hash: null, direction: null, wallet: null, amount: null, asset: null, asset_contract: null, usd_value: null, block_number: null,
            detail_json: '{"basis":"not_in_registry"}', occurred_at: new Date(stampMs).toISOString(), created_at: stamp(stampMs),
          } as Record<string, unknown>,
        };
      };
      /** A row written now, stamped now, visible at once or up to four seconds later. */
      const write = (lateMs = 0, onlyRemoved = false) => {
        const { id, row, ofRemoved } = makeRow(world(), onlyRemoved);
        const visibleAt = world() + lateMs;
        // A removed agent's rows are never owed to the page.
        if (!ofRemoved) rows.set(id, { visibleAt });
        if (lateMs === 0) fake.seed('agent_events', row);
        else pending.push({ id, row, visibleAt });
      };
      const flush = () => {
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          if (pending[i].visibleAt <= world()) {
            fake.seed('agent_events', pending[i].row);
            pending.splice(i, 1);
          }
        }
      };

      for (let i = 0; i < 3; i += 1) {
        write();
        timers.advance(1000);
      }
      const first = await feed.readFeed(A, {}, () => new Date(world()));
      if (!first.ok) throw new Error('could not open');
      const opened = new Set(first.events.map((e) => e.id));

      const delivered: string[] = [];
      let faults = true;
      let visible = true;
      /** [world time, events the server answered with] for each request that reached it. */
      const served: Array<[number, number]> = [];
      const trace: string[] = [];
      const send: Send = async (_m, url) => {
        if (faults) {
          const x = rnd();
          if (x < 0.04) { trace.push(`${Math.round((world() - BASE) / 1000)}s FAULT 500`); return failed(500); }
          if (x < 0.06) { trace.push(`${Math.round((world() - BASE) / 1000)}s FAULT 429`); return failed(429, 'rate_limited'); }
          if (x < 0.08) { trace.push(`${Math.round((world() - BASE) / 1000)}s FAULT network`); return { status: 0, ok: false, body: null } as ApiResult; }
        }
        flush();
        const q = new URL(`https://almstins.com${url}`).searchParams;
        trace.push(`${Math.round((world() - BASE) / 1000)}s SEND ${url.replace('/api/agentics/feed?', '').slice(0, 50)}`);
        let r: Awaited<ReturnType<typeof feed.readFeed>>;
        try {
          r = await feed.readFeed(A, { since: q.get('since'), after: q.get('after'), limit: q.get('limit'), tinId: q.get('tinId') }, () => new Date(world()));
        } catch (e) {
          trace.push(`THREW ${String((e as Error).message).slice(0, 100)}`);
          throw e;
        }
        if (!r.ok) { trace.push(`${Math.round((world() - BASE) / 1000)}s ERROR ${r.error} ${url.slice(0, 80)}`); return failed(400, r.error); }
        served.push([world(), r.events.length]);
        trace.push(`${Math.round((world() - BASE) / 1000)}s ${url.replace('/api/agentics/feed?', '').slice(0, 60)} -> ${r.events.length} (more ${r.more})`);
        // The answer reaches the page after the server has read: on a slow link a row is seen by the page later than it was read.
        timers.advance(rtt());
        return okBody({ ...r }) as ApiResult;
      };
      const poller = createFeedPoller(
        { send, setTimer: timers.setTimer, clearTimer: timers.clearTimer, visible: () => visible, onRows: (r: FeedRow[]) => delivered.push(...r.map((x) => x.id)), onState: () => {}, now: world },
        { since: first.since, seen: first.events },
      );
      poller.start();

      for (let step = 0; step < (dense ? 110 : 70); step += 1) {
        const x = rnd();
        if (dense) {
          // Twenty-five rows every second, a quarter of them showing up to 4.999 seconds late (most of those very nearly that late).
          for (let j = 0; j < 25; j += 1) write(rnd() < 0.25 ? (rnd() < 0.6 ? 4999 : 4000 + Math.floor(rnd() * 999)) : 0);
          timers.advance(1000);
        } else if (x < 0.34) {
          // A burst (a first read of a busy wallet) or a trickle, and sometimes a late row.
          // Most steps write a few rows; one in ten a burst of hundreds; one in thirty a burst past what one turn of the poll carries (ten pages of a hundred).
          const big = rnd();
          const k = big < 0.033 ? 1050 + Math.floor(rnd() * 600) : big < 0.13 ? 150 + Math.floor(rnd() * 450) : Math.floor(rnd() * 12);
          for (let j = 0; j < k; j += 1) write(rnd() < 0.05 ? 1000 * (1 + Math.floor(rnd() * 4)) : 0);
          if (rnd() < 0.3) write(1000 * (1 + Math.floor(rnd() * 4)));
        } else if (x < 0.56) {
          timers.advance(1000 * Math.floor(rnd() * 5));
        } else if (x < 0.63) {
          visible = !visible;
          trace.push(`${Math.round((world() - BASE) / 1000)}s visible=${visible}`);
          poller.visibilityChanged();
          await settle();
        } else if (x < 0.67) {
          poller.pollNow();
          await settle();
        }
        if (timers.count() > 0 && rnd() < 0.8) await timers.fire();
      }

      // The last writing, in a history that has a removed agent: a burst of its rows, newer than any row the page can show.
      if (withRemoved) for (let j = 0; j < 150 + Math.floor(rnd() * 250); j += 1) write(0, true);
      // Quiet: nothing more is written, nothing fails, the tab is showing, and a minute goes by on the page's own timers.
      faults = false;
      visible = true;
      poller.visibilityChanged();
      await settle();
      const quietFrom = world();
      const end = quietFrom + 70_000;
      let turns = 0;
      while (world() < end && turns < 4000) {
        turns += 1;
        if (timers.count() === 0) {
          poller.pollNow();
          await settle();
          if (timers.count() === 0) break;
        }
        await timers.fire();
      }

      const got = new Map<string, number>();
      for (const id of delivered) got.set(id, (got.get(id) ?? 0) + 1);
      const duplicated = [...got.entries()].filter(([, n]) => n > 1).length;
      const missing = [...rows.keys()].filter((id) => !got.has(id) && !opened.has(id));
      expect(duplicated, `rows handed to the page more than once (seed ${seed})`).toBe(0);
      expect(missing.length, `rows that became visible and were never handed over, of ${rows.size} (seed ${seed})`).toBe(0);

      // A quiet ledger costs next to nothing: in the last twenty seconds the server was asked a handful of times
      // and sent no row at all (the burst had left the window).
      if (process.env.FUZZ_TRACE === String(seed)) console.log(`quiet from ${Math.round((quietFrom - BASE) / 1000)}s\n` + trace.slice(-90).join('\n'));
      const lastTwenty = served.filter(([at]) => at > end - 20_000);
      expect(lastTwenty.reduce((sum, [, n]) => sum + n, 0), `rows still being read in the last twenty quiet seconds (seed ${seed})`).toBe(0);
      expect(lastTwenty.length, `requests in the last twenty quiet seconds (seed ${seed})`).toBeLessThanOrEqual(10);
      expect(turns, 'the poll did not settle').toBeLessThan(4000);
    }, 120_000);
  }
});
