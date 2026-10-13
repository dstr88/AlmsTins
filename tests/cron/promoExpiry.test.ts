import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GET /api/cron/promo-expiry sends one 30-day and one 7-day warning per expiring promo. A
 * promo that enters the 7-day window before any 30-day warning went out (the backlog after
 * the cron was dead on Postgres, or a code with duration_days <= 7) must get only the 7-day
 * email: the next run must not follow it with a 30-day one. No database: '@/lib/db' records
 * each statement and answers the SELECT from `state.rows`.
 */

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; args: unknown[] }>,
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
      state.calls.push({ sql, args });
      return { rows: /^\s*SELECT/.test(sql) ? state.rows : [], rowsAffected: 1 };
    },
  },
}));

const mail = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@/lib/email', () => mail);
vi.mock('@/lib/i18n/userLang', () => ({ ensureUserLangColumn: async () => {} }));

import { GET } from '../../src/pages/api/cron/promo-expiry';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY - 60_000).toISOString();
const run = () =>
  GET({ request: new Request('https://app.test/api/cron/promo-expiry', { headers: { 'x-cron-secret': 'test-secret' } }) } as never);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const updates = () => state.calls.filter((c) => /^\s*UPDATE/.test(c.sql));

beforeEach(() => {
  state.calls = [];
  state.rows = [];
  mail.sendMail.mockReset();
  mail.sendMail.mockResolvedValue(undefined);
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('promo-expiry warnings', () => {
  it('a 7-day warning also stamps an empty 30-day column, so no 30-day email follows it', async () => {
    state.rows = [{
      redemption_id: 'r1', tenant_id: 't1', code: 'PROMO', access_expires_at: inDays(5),
      warning_30d_sent_at: null, warning_7d_sent_at: null, email: 'a@example.test', lang: 'en',
    }];
    await run();

    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    const [update] = updates();
    expect(oneLine(update.sql)).toContain('SET warning_7d_sent_at = to_char(');
    expect(oneLine(update.sql)).toContain('warning_30d_sent_at = COALESCE(warning_30d_sent_at, to_char(');
    expect(update.args).toEqual(['r1']);
  });

  it('a 30-day warning stamps only the 30-day column', async () => {
    state.rows = [{
      redemption_id: 'r2', tenant_id: 't1', code: 'PROMO', access_expires_at: inDays(20),
      warning_30d_sent_at: null, warning_7d_sent_at: null, email: 'b@example.test', lang: 'en',
    }];
    await run();

    expect(mail.sendMail).toHaveBeenCalledTimes(1);
    const [update] = updates();
    expect(oneLine(update.sql)).toMatch(/^UPDATE promo_redemptions SET warning_30d_sent_at = to_char\(.*\) WHERE id = \?$/);
    expect(update.sql).not.toContain('warning_7d_sent_at');
  });

  it('sends nothing for a promo whose 7-day warning already went out', async () => {
    // A row stamped before this fix: 7d sent, 30d never stamped.
    state.rows = [{
      redemption_id: 'r3', tenant_id: 't1', code: 'PROMO', access_expires_at: inDays(4),
      warning_30d_sent_at: null, warning_7d_sent_at: '2026-01-01T00:00:00Z', email: 'c@example.test', lang: 'en',
    }];
    await run();

    expect(mail.sendMail).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
  });

  it('the SELECT leaves a promo with a sent 7-day warning out of the 30-day branch', async () => {
    await run();
    const select = oneLine(state.calls.find((c) => /^\s*SELECT/.test(c.sql))!.sql);
    expect(select).toContain('AND pr.warning_30d_sent_at IS NULL AND pr.warning_7d_sent_at IS NULL)');
    expect(select).not.toMatch(/julianday|strftime/);
  });
});
