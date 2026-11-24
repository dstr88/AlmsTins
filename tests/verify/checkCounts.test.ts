import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The free check's daily counts (src/lib/checkCounts.ts): one number per UTC day, caller kind and
 * answer, nothing about the call. The database is faked: these tests read what the module sends.
 */
const calls = vi.hoisted(() => ({ list: [] as Array<{ sql: string; args: unknown[] }>, fail: false }));
vi.mock('@/lib/db', () => ({
  db: {
    execute: async (q: { sql: string; args: unknown[] }) => {
      calls.list.push(q);
      if (calls.fail) throw new Error('db down');
      return { rows: [] };
    },
  },
}));

import { CHECK_COUNTS_DDL, checkDay, countCheck, summarizeCheckCounts } from '../../src/lib/checkCounts';

const ROOT = path.resolve(__dirname, '../..');
const squash = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ,/g, ',').trim();

beforeEach(() => { calls.list.length = 0; calls.fail = false; });

describe('the table', () => {
  it('migrations-pg/0078 holds exactly the statements the code runs', () => {
    const file = squash(readFileSync(path.join(ROOT, 'migrations-pg', '0078_verify_check_counts.sql'), 'utf8'))
      .split(';').map((x) => x.trim()).filter(Boolean);
    expect(file).toEqual(CHECK_COUNTS_DDL.map(squash));
  });

  it('has no column that could hold an address, IP, key or link', () => {
    const ddl = CHECK_COUNTS_DDL.join('\n');
    expect(ddl).not.toMatch(/address|ip|key_id|value|url|tenant/i);
  });
});

describe('countCheck', () => {
  it('adds one to the UTC day, caller and status, and sends nothing else', async () => {
    await countCheck({ caller: 'anonymous', status: 'unknown', now: new Date('2026-11-23T23:59:59Z') });
    const insert = calls.list.find((c) => /INSERT INTO verify_check_counts/.test(c.sql));
    expect(insert?.args).toEqual(['2026-11-23', 'anonymous', 'unknown']);
    expect(insert?.sql).toMatch(/ON CONFLICT \(day, caller, status\) DO UPDATE SET n = verify_check_counts\.n \+ 1/);
  });

  it('ignores a status it does not know', async () => {
    await countCheck({ caller: 'keyed', status: 'maybe' });
    expect(calls.list.some((c) => /INSERT/.test(c.sql))).toBe(false);
  });

  it('never throws when the database fails', async () => {
    calls.fail = true;
    await expect(countCheck({ caller: 'keyed', status: 'proven' })).resolves.toBeUndefined();
  });
});

describe('summarizeCheckCounts', () => {
  const now = new Date('2026-11-23T12:00:00Z');

  it('folds rows into the last N days, oldest first, with totals', () => {
    const s = summarizeCheckCounts([
      { day: '2026-11-23', caller: 'anonymous', status: 'unknown', n: 3 },
      { day: '2026-11-23', caller: 'keyed', status: 'proven', n: 2 },
      { day: '2026-11-22', caller: 'anonymous', status: 'mismatch', n: 1 },
    ], 3, now);
    expect(s.days.map((d) => d.day)).toEqual(['2026-11-21', '2026-11-22', '2026-11-23']);
    expect(s.days[2]).toMatchObject({ anonymous: 3, keyed: 2 });
    expect(s.totals).toEqual({ anonymous: 4, keyed: 2, byStatus: { proven: 2, mismatch: 1, unanchored: 0, unknown: 3 } });
  });

  it('drops rows outside the window or with unknown fields', () => {
    const s = summarizeCheckCounts([
      { day: '2026-10-01', caller: 'anonymous', status: 'unknown', n: 9 },
      { day: '2026-11-23', caller: 'someone', status: 'unknown', n: 9 },
      { day: '2026-11-23', caller: 'anonymous', status: 'odd', n: 9 },
    ], 2, now);
    expect(s.totals.anonymous + s.totals.keyed).toBe(0);
  });

  it('uses UTC days', () => {
    expect(checkDay(new Date('2026-11-24T00:00:01Z'))).toBe('2026-11-24');
  });
});
