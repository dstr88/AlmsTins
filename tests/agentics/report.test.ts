import { describe, it, expect, vi } from 'vitest';
import { addr } from '../helpers/agentVault';
import { txHash } from '../helpers/fakeExplorer';
import {
  ANSWER_BASES,
  MAX_LISTED_PER_BUCKET,
  REPORT_BUCKETS,
  ReportBuilder,
  addDays,
  attentionCount,
  basisOf,
  buildReport,
  classifyCheck,
  dayBounds,
  headlineOf,
  parseDay,
  utcDay,
  type ReportBucket,
} from '../../src/lib/agentVault/report';
import { addTransfer, emptySums, toSideTotal } from '../../src/lib/agentVault/money';
import type { LedgerEvent, VaultAnswer } from '../../src/lib/agentVault/events';

/**
 * The operator report's rules, as pure functions: which bucket each check falls in (every row of
 * the table), where an address is listed (once, in its most severe bucket), how checks are counted
 * on their own, the bought and sold strip, and that none of it depends on the order the events
 * arrive in. No database: the checkLog import below needs the module mocked only because it
 * imports the store. Every address, label and amount is invented.
 */
vi.mock('@/lib/db', () => ({ db: { execute: async () => { throw new Error('no database in this test'); } } }));

const DAY = '2026-10-17';
const { start: START, end: END } = dayBounds(DAY);
const TIN = { id: 'tin-1', label: 'Treasury agent' };
const PERIOD = { start: START, end: END, partial: false };

let counter = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const at = (h: number, m = 0, s = 0, ms = 0) => new Date(Date.UTC(2026, 9, 17, h, m, s, ms)).toISOString();

type Basis = (typeof ANSWER_BASES)[number];
const ANSWER_OF: Record<Basis, VaultAnswer> = {
  registry_flagged: 'flagged',
  domain_mismatch: 'flagged',
  not_in_registry: 'unknown',
  registry_pending: 'unknown',
  domain_proof: 'proven',
  registered_and_checked_before: 'consistent-with-history',
  registered_first_check: 'unknown',
};

const check = (address: string, basis: Basis | string | null, when: string, over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: nextId(),
  tinId: TIN.id,
  kind: 'checked',
  at: when,
  address,
  chain: null,
  answer: basis && basis in ANSWER_OF ? ANSWER_OF[basis as Basis] : 'unknown',
  registry: 'none',
  status: 'unknown',
  keyId: 'k',
  sourceIp: null,
  tx: null,
  detail: basis === null ? null : { basis },
  ...over,
});

const transfer = (direction: 'in' | 'out', usd: number | null, when: string, over: Partial<LedgerEvent> = {}): LedgerEvent => ({
  id: nextId(),
  tinId: TIN.id,
  kind: 'transaction',
  at: when,
  address: addr(2),
  chain: 'ethereum',
  answer: 'consistent-with-history',
  registry: 'trusted',
  status: null,
  keyId: null,
  sourceIp: null,
  tx: { hash: txHash(counter), direction, wallet: addr(1), amount: '1', asset: 'ETH', assetContract: null, usd, blockNumber: 1 },
  detail: { leg: 'native:0' },
  ...over,
});

const report = (events: LedgerEvent[], labels?: Map<string, string>) => buildReport(events, { tin: TIN, period: PERIOD, labels });

describe('which bucket a check falls in', () => {
  const table: Array<[string, { answer: VaultAnswer | null; basis: string | null }, ReportBucket]> = [
    ['flagged by the registry', { answer: 'flagged', basis: 'registry_flagged' }, 'issues'],
    ['flagged for a domain mismatch', { answer: 'flagged', basis: 'domain_mismatch' }, 'issues'],
    ['an address that is not in the registry (where a swap shows up)', { answer: 'unknown', basis: 'not_in_registry' }, 'not_confirmed'],
    ['a registered address whose checks have not finished', { answer: 'unknown', basis: 'registry_pending' }, 'not_confirmed'],
    ['the first check of a registered, trusted address', { answer: 'unknown', basis: 'registered_first_check' }, 'new'],
    ['proven by a domain proof', { answer: 'proven', basis: 'domain_proof' }, 'no_issues'],
    ['consistent with history', { answer: 'consistent-with-history', basis: 'registered_and_checked_before' }, 'no_issues'],
    ['unknown with no basis recorded: when in doubt it asks for a look', { answer: 'unknown', basis: null }, 'not_confirmed'],
    ['unknown with a basis this code does not know', { answer: 'unknown', basis: 'something_new' }, 'not_confirmed'],
    ['no readable answer at all', { answer: null, basis: 'registered_first_check' }, 'not_confirmed'],
  ];
  it.each(table)('%s', (_name, input, bucket) => {
    expect(classifyCheck({ answer: input.answer, detail: input.basis === null ? null : { basis: input.basis } })).toBe(bucket);
  });

  it('a basis that is not a string or not a known one reads as `other`, so a stored string never becomes report text', () => {
    expect(basisOf(null)).toBe('other');
    expect(basisOf({})).toBe('other');
    expect(basisOf({ basis: 7 })).toBe('other');
    expect(basisOf({ basis: '<img src=x onerror=alert(1)>' })).toBe('other');
    for (const b of ANSWER_BASES) expect(basisOf({ basis: b })).toBe(b);
  });

  it('follows deriveAnswer over every combination the tin can answer', async () => {
    const { deriveAnswer } = await import('../../src/lib/agentVault/checkLog');
    const seen = new Set<string>();
    for (const status of ['proven', 'mismatch', 'unanchored', 'unknown'] as const) {
      for (const registry of ['trusted', 'flagged', 'pending', 'none'] as const) {
        for (const checkedBefore of [true, false]) {
          const d = deriveAnswer({ status, registry, checkedBefore });
          seen.add(d.basis);
          const bucket = classifyCheck({ answer: d.answer, detail: { basis: d.basis } });
          const label = `${status}/${registry}/${checkedBefore}`;
          if (d.answer === 'flagged') expect(bucket, label).toBe('issues');
          else if (d.answer === 'unknown' && d.cleared) expect(bucket, label).toBe('new');
          else if (d.answer === 'unknown') expect(bucket, label).toBe('not_confirmed');
          else expect(bucket, label).toBe('no_issues');
          // A cleared check never lands in a bucket that asks for attention.
          if (d.cleared) expect(['new', 'no_issues'], label).toContain(bucket);
        }
      }
    }
    // The report knows every reason the tin can give, and no other.
    expect([...seen].sort()).toEqual([...ANSWER_BASES].sort());
  });
});

describe('one place per address', () => {
  it('lists an address once, in the most severe bucket any of its checks fell in; its other checks still count where they fell', () => {
    const a = addr(1);
    const events = [
      check(a, 'domain_proof', at(8)),
      check(a, 'registry_flagged', at(9)),
      ...Array.from({ length: 8 }, (_, i) => check(a, 'domain_proof', at(10, i))),
    ];
    const r = report(events);
    expect(r.addresses).toBe(1);
    expect(r.buckets.issues.addresses).toBe(1);
    expect(r.buckets.issues.checks).toBe(1);
    expect(r.buckets.issues.listed).toHaveLength(1);
    expect(r.buckets.issues.listed[0]).toMatchObject({ address: a, checks: 1, checksInPeriod: 10, reasons: ['registry_flagged'], firstAt: at(9), lastAt: at(9) });
    // The address is not also counted as an address with no issues, but its nine clear checks are clear checks.
    expect(r.buckets.no_issues.addresses).toBe(0);
    expect(r.buckets.no_issues.checks).toBe(9);
    expect(r.events.checked).toBe(10);
  });

  it('not confirmed outranks new, and new outranks clear', () => {
    const swapped = addr(1);
    const fresh = addr(2);
    const r = report([
      check(swapped, 'registry_first_check_typo', at(8)), // an unknown reason: asks for a look
      check(swapped, 'registered_first_check', at(9)),
      check(swapped, 'registered_and_checked_before', at(10)),
      check(fresh, 'registered_first_check', at(11)),
      check(fresh, 'registered_and_checked_before', at(12)),
    ]);
    expect(r.buckets.not_confirmed.listed.map((a) => a.address)).toEqual([swapped]);
    expect(r.buckets.new.listed.map((a) => a.address)).toEqual([fresh]);
    expect(r.buckets.no_issues.addresses).toBe(0);
    expect(r.buckets.no_issues.checks).toBe(2);
    expect(r.buckets.new.checks).toBe(2);
    expect(r.buckets.not_confirmed.checks).toBe(1);
  });

  it('an address whose every check was clear is a count only, and is never listed', () => {
    const r = report([check(addr(1), 'domain_proof', at(8)), check(addr(1), 'registered_and_checked_before', at(9)), check(addr(2), 'domain_proof', at(10))]);
    expect(r.buckets.no_issues).toEqual({ addresses: 2, checks: 3 });
    expect(r.buckets.issues.listed).toEqual([]);
    expect(r.buckets.not_confirmed.listed).toEqual([]);
    expect(r.buckets.new.listed).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(addr(1));
  });

  it('every address is in exactly one bucket, and every check in exactly one: the parts add up to the whole', () => {
    const events: LedgerEvent[] = [];
    let t = 0;
    for (let i = 1; i <= 40; i++) {
      const bases = [...ANSWER_BASES];
      for (let k = 0; k < 1 + (i % 5); k++) events.push(check(addr(i), bases[(i * 3 + k * 5) % bases.length], at(0, 0, t++)));
    }
    const r = report(events);
    const parts = REPORT_BUCKETS.map((b) => r.buckets[b]);
    expect(parts.reduce((n, b) => n + b.addresses, 0)).toBe(r.addresses);
    expect(parts.reduce((n, b) => n + b.checks, 0)).toBe(r.events.checked);
    expect(r.addresses).toBe(40);
    expect(r.events.checked).toBe(events.length);
    // Listed addresses are distinct across the three lists.
    const listed = [...r.buckets.issues.listed, ...r.buckets.not_confirmed.listed, ...r.buckets.new.listed].map((a) => a.address);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('what needs a person is had issues plus not confirmed: new and clear do not', () => {
    const r = report([
      check(addr(1), 'registry_flagged', at(8)),
      check(addr(2), 'domain_mismatch', at(8)),
      check(addr(3), 'not_in_registry', at(9)),
      check(addr(4), 'registered_first_check', at(10)),
      check(addr(5), 'domain_proof', at(10)),
    ]);
    expect(attentionCount(r)).toBe(3);
    expect(headlineOf(r)).toMatchObject({ issues: 2, notConfirmed: 1, new: 1, noIssues: 1, checks: 5, noIssuesChecks: 1 });
  });
});

describe('what each listed address carries', () => {
  it('names the reasons (sorted), the first and last check, the first check\'s event, and the chain and registry of the last', () => {
    const a = addr(1);
    const first = check(a, 'registry_pending', at(9), { registry: 'pending', chain: 'ethereum' });
    const later = check(a, 'not_in_registry', at(15), { registry: 'none', chain: null });
    const r = report([later, first]);
    expect(r.buckets.not_confirmed.listed).toEqual([
      { address: a, chain: null, label: null, registry: 'none', reasons: ['not_in_registry', 'registry_pending'], checks: 2, checksInPeriod: 2, firstAt: at(9), lastAt: at(15), eventId: first.id },
    ]);
  });

  it('puts the registry\'s label on a listed address, verbatim, and on no other', () => {
    const labels = new Map([[addr(1), '<b>Exchange</b> & co'], [addr(9), 'unused']]);
    const r = report([check(addr(1), 'registry_pending', at(9)), check(addr(2), 'registry_pending', at(10))], labels);
    expect(r.buckets.not_confirmed.listed.map((a) => [a.address, a.label])).toEqual([[addr(1), '<b>Exchange</b> & co'], [addr(2), null]]);
    expect(JSON.stringify(r)).not.toContain('unused');
  });

  it('lists in the order the addresses first appeared, with the address as the tiebreak', () => {
    const r = report([check(addr(3), 'registry_pending', at(9)), check(addr(2), 'registry_pending', at(9)), check(addr(1), 'registry_pending', at(8))]);
    expect(r.buckets.not_confirmed.listed.map((a) => a.address)).toEqual([addr(1), addr(2), addr(3)]);
  });

  it('lists at most MAX_LISTED_PER_BUCKET addresses, and says how many it left out; the counts stay whole', () => {
    const events = Array.from({ length: MAX_LISTED_PER_BUCKET + 5 }, (_, i) => check(addr(i + 1), 'not_in_registry', at(0, 0, 0, i)));
    const r = report(events);
    expect(r.buckets.not_confirmed.addresses).toBe(MAX_LISTED_PER_BUCKET + 5);
    expect(r.buckets.not_confirmed.checks).toBe(MAX_LISTED_PER_BUCKET + 5);
    expect(r.buckets.not_confirmed.listed).toHaveLength(MAX_LISTED_PER_BUCKET);
    expect(r.buckets.not_confirmed.omitted).toBe(5);
    expect(r.addresses).toBe(MAX_LISTED_PER_BUCKET + 5);
  });
});

describe('the period', () => {
  it('starts at the first moment of the day and ends before the first moment of the next', () => {
    const r = report([
      check(addr(1), 'not_in_registry', at(0, 0, 0, 0)), // the stroke of midnight belongs to this day
      check(addr(2), 'not_in_registry', at(23, 59, 59, 999)),
      check(addr(3), 'not_in_registry', new Date(Date.parse(START) - 1).toISOString()), // just before
      check(addr(4), 'not_in_registry', END), // the next day's first moment
      transfer('in', 5, new Date(Date.parse(START) - 1).toISOString()),
      transfer('in', 7, END),
    ]);
    expect(r.buckets.not_confirmed.listed.map((a) => a.address)).toEqual([addr(1), addr(2)]);
    expect(r.events).toEqual({ checked: 2, transaction: 0 });
    expect(r.strip.transfers).toBe(0);
  });

  it('carries the period it was asked for, and whether it is partial', () => {
    const r = buildReport([], { tin: TIN, period: { ...PERIOD, partial: true } });
    expect(r.period).toEqual({ start: START, end: END, partial: true });
    expect(r.tin).toEqual(TIN);
    expect(r.v).toBe(1);
  });

  it('an empty day is a report of zeros, not an error', () => {
    const r = report([]);
    expect(r.addresses).toBe(0);
    expect(r.events).toEqual({ checked: 0, transaction: 0 });
    for (const b of REPORT_BUCKETS) expect(r.buckets[b].addresses).toBe(0);
    expect(r.strip.bought).toEqual({ count: 0, pricedCount: 0, unpricedCount: 0, usd: 0 });
    expect(r.strip.sold).toEqual({ count: 0, pricedCount: 0, unpricedCount: 0, usd: 0 });
  });

  describe('days', () => {
    it('parseDay accepts a real calendar date and nothing else', () => {
      expect(parseDay('2026-10-17')).toBe('2026-10-17');
      expect(parseDay('2024-02-29')).toBe('2024-02-29');
      for (const bad of ['2026-02-30', '2026-13-01', '2026-10-32', '2025-02-29', '2026-1-1', '20261017', '2026-10-17T00:00:00Z', ' 2026-10-17', '', null, undefined, 20261017, {}]) {
        expect(parseDay(bad), String(bad)).toBeNull();
      }
    });

    it('dayBounds is the UTC day, end exclusive, in the form the ledger stores times in', () => {
      expect(dayBounds('2026-10-17')).toEqual({ start: '2026-10-17T00:00:00.000Z', end: '2026-10-18T00:00:00.000Z' });
      expect(dayBounds('2026-12-31')).toEqual({ start: '2026-12-31T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' });
      expect(dayBounds('2028-02-29')).toEqual({ start: '2028-02-29T00:00:00.000Z', end: '2028-03-01T00:00:00.000Z' });
    });

    it('addDays and utcDay step across month and year ends, and read a moment in UTC', () => {
      expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
      expect(utcDay(new Date('2026-10-17T23:59:59.999Z'))).toBe('2026-10-17');
      expect(utcDay(new Date('2026-10-18T00:00:00.000Z'))).toBe('2026-10-18');
      expect(utcDay('2026-10-17T20:00:00-05:00')).toBe('2026-10-18');
    });
  });
});

describe('the bought and sold strip', () => {
  it('bought is value in and sold is value out, in USD at the time, with the cent rounding the totals use', () => {
    const r = report([transfer('in', 0.1, at(9)), transfer('in', 0.2, at(10)), transfer('out', 1250.555, at(11)), transfer('out', 20, at(12))]);
    expect(r.strip.bought).toEqual({ count: 2, pricedCount: 2, unpricedCount: 0, usd: 0.3 });
    expect(r.strip.sold).toEqual({ count: 2, pricedCount: 2, unpricedCount: 0, usd: 1270.56 });
    expect(r.strip.transfers).toBe(4);
    expect(r.events.transaction).toBe(4);
  });

  it('a transfer with no USD value is counted on its own and never added in as zero', () => {
    const r = report([transfer('in', 100, at(9)), transfer('in', null, at(10)), transfer('out', null, at(11))]);
    expect(r.strip.bought).toEqual({ count: 2, pricedCount: 1, unpricedCount: 1, usd: 100 });
    expect(r.strip.sold).toEqual({ count: 1, pricedCount: 0, unpricedCount: 1, usd: 0 });
  });

  it('counts the transfers by the verify-status they inherited, and those with no check before them', () => {
    const r = report([
      transfer('out', 1, at(9), { answer: 'proven' }),
      transfer('out', 1, at(10), { answer: 'consistent-with-history' }),
      transfer('out', 1, at(11), { answer: 'unknown', detail: { reason: 'no_preceding_check' } }),
      transfer('out', 1, at(12), { answer: 'unknown', detail: { reason: 'ambiguous_checks' } }),
      transfer('in', 1, at(13), { answer: 'unknown', detail: { reason: 'no_preceding_check' } }),
      transfer('in', 1, at(14), { answer: 'flagged' }),
    ]);
    expect(r.strip.byStatus).toEqual({ proven: 1, 'consistent-with-history': 1, flagged: 1, unknown: 3 });
    expect(r.strip.noPrecedingCheck).toBe(2);
  });

  it('transfers never add to the check buckets, and checks never add to the strip', () => {
    const r = report([transfer('in', 5, at(9)), check(addr(1), 'not_in_registry', at(9))]);
    expect(r.events).toEqual({ checked: 1, transaction: 1 });
    expect(r.addresses).toBe(1);
    expect(r.strip.transfers).toBe(1);
  });

  it('has no profit, loss, cost basis or net figure anywhere in the report', () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
    };
    walk(report([check(addr(1), 'registry_flagged', at(8)), transfer('in', 5, at(9)), transfer('out', 6, at(10))]));
    for (const k of keys) expect(k, k).not.toMatch(/net|profit|loss|gain|cost|basis|pnl|p_l|realized|equity|balance/i);
  });
});

describe('the money helpers', () => {
  it('add a transfer to a side exactly, in whole micro-dollars', () => {
    const s = emptySums();
    for (let i = 0; i < 10; i++) addTransfer(s, 0.1);
    expect(s.micros).toBe(1_000_000);
    expect(toSideTotal(s)).toEqual({ count: 10, pricedCount: 10, unpricedCount: 0, usd: 1 });
  });

  it('count a null on its own', () => {
    const s = emptySums();
    addTransfer(s, null);
    addTransfer(s, 2.005);
    expect(toSideTotal(s)).toEqual({ count: 2, pricedCount: 1, unpricedCount: 1, usd: 2.01 });
  });
});

describe('the same ledger always gives the same report', () => {
  // A small deterministic generator: the test never depends on luck.
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  it('whatever order the events arrive in, the report is identical byte for byte', () => {
    const random = rng(7);
    const bases = [...ANSWER_BASES];
    const events: LedgerEvent[] = [];
    for (let i = 0; i < 160; i++) {
      const basis = bases[Math.floor(random() * bases.length)];
      events.push(check(addr(1 + Math.floor(random() * 12)), basis, at(Math.floor(random() * 24), Math.floor(random() * 60), 0, Math.floor(random() * 3)), {
        registry: (['trusted', 'flagged', 'pending', 'none'] as const)[Math.floor(random() * 4)],
        chain: random() < 0.5 ? 'ethereum' : null,
      }));
    }
    for (let i = 0; i < 30; i++) events.push(transfer(random() < 0.5 ? 'in' : 'out', random() < 0.2 ? null : Math.round(random() * 100000) / 100, at(Math.floor(random() * 24), Math.floor(random() * 60))));
    const labels = new Map([[addr(1), 'One'], [addr(2), 'Two']]);
    const expected = JSON.stringify(report(events, labels));
    for (let n = 0; n < 25; n++) {
      const shuffled = [...events];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(JSON.stringify(report(shuffled, labels))).toBe(expected);
    }
  });

  it('two checks at the same instant still give one answer, ordered by id', () => {
    const a = check(addr(1), 'registry_pending', at(9), { id: '00000000-0000-4000-8000-0000000000ff' });
    const b = check(addr(1), 'not_in_registry', at(9), { id: '00000000-0000-4000-8000-000000000001' });
    const r1 = JSON.stringify(report([a, b]));
    const r2 = JSON.stringify(report([b, a]));
    expect(r1).toBe(r2);
    expect(JSON.parse(r1).buckets.not_confirmed.listed[0].eventId).toBe(b.id);
  });

  it('adding events one at a time gives the same report as building from the list, and a report so far does not disturb the rest', () => {
    const events = [check(addr(1), 'registry_flagged', at(8)), check(addr(2), 'not_in_registry', at(9)), transfer('in', 3, at(10)), check(addr(1), 'domain_proof', at(11))];
    const builder = new ReportBuilder({ tin: TIN, period: PERIOD });
    builder.add(events[0]);
    const soFar = builder.finish();
    expect(soFar.addresses).toBe(1);
    for (const e of events.slice(1)) builder.add(e);
    expect(JSON.stringify(builder.finish())).toBe(JSON.stringify(report(events)));
    expect(soFar.addresses).toBe(1); // the earlier answer is its own object
  });
});
