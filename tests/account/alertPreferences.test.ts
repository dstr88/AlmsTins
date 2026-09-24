import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GET/POST /api/account/alert-preferences look up one row by (user_id, wallet_id), where a
 * NULL wallet_id is the user-level preference. The lookup used to be
 * `(wallet_id = ? OR (? IS NULL AND wallet_id IS NULL))`, which Postgres rejects with 42P18
 * (it cannot type a parameter that is only tested for NULL), so every call returned 500.
 * These pin the typed form and the statements each path runs, including the check that a
 * wallet-level POST names a wallet in one of the caller's tenants (the health-alert cron
 * emails that wallet's details to the caller). No database: '@/lib/db' records each
 * statement and answers from a per-test queue.
 */

type Stmt = { sql: string; args: unknown[] };
const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; args: unknown[] }>,
  replies: [] as Array<Array<Record<string, unknown>> | Error>,
}));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => {
      state.calls.push({ sql: stmt.sql, args: stmt.args ?? [] });
      const next = state.replies.shift() ?? [];
      if (next instanceof Error) throw next;
      return { rows: next, rowsAffected: 0 };
    },
  },
}));

const auth = vi.hoisted(() => ({ getAuthSession: vi.fn() }));
vi.mock('@/lib/authSession', () => auth);

import { GET, POST } from '../../src/pages/api/account/alert-preferences';

type Ctx = Parameters<typeof GET>[0];
const ctx = (request: Request) => ({ request }) as unknown as Ctx;
const BASE = 'https://app.test/api/account/alert-preferences';
const post = (body: unknown) =>
  POST(ctx(new Request(BASE, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })));

// Placeholders the shim will number: every `?` outside a single-quoted literal
// (the same rule db.pg.ts toPg() applies).
function placeholders(sql: string): number {
  let n = 0;
  let inStr = false;
  for (const c of sql) {
    if (c === "'") inStr = !inStr;
    else if (c === '?' && !inStr) n++;
  }
  return n;
}
const UNTYPED_NULL_TEST = /\?\s*\)?\s*IS\s+(NOT\s+)?NULL/i;
const oneLine = (s: Stmt) => s.sql.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  state.calls = [];
  state.replies = [];
  auth.getAuthSession.mockReset();
  auth.getAuthSession.mockResolvedValue({ user: { id: 'user-1' } });
});

afterEach(() => {
  // Every statement a test ran must be one Postgres can prepare: no parameter that is only
  // tested for NULL, and exactly one argument per placeholder.
  for (const call of state.calls) {
    expect(call.sql).not.toMatch(UNTYPED_NULL_TEST);
    expect(placeholders(call.sql)).toBe(call.args.length);
  }
});

describe('GET /api/account/alert-preferences', () => {
  it('looks up the user-level row with one typed, null-safe parameter', async () => {
    const res = await GET(ctx(new Request(BASE)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, preference: null });
    expect(state.calls).toHaveLength(1);
    expect(oneLine(state.calls[0])).toContain('WHERE user_id = ? AND wallet_id IS NOT DISTINCT FROM ?');
    expect(state.calls[0].args).toEqual(['user-1', null]);
  });

  it('passes the walletId from the query string', async () => {
    state.replies.push([{ id: 'ap-1', threshold: 1.25, direction: 'above', enabled: 1, last_alerted_at: null }]);
    const res = await GET(ctx(new Request(`${BASE}?walletId=w1`)));
    expect(state.calls[0].args).toEqual(['user-1', 'w1']);
    expect(await res.json()).toEqual({
      ok: true,
      preference: { id: 'ap-1', threshold: 1.25, direction: 'above', enabled: true, lastAlertedAt: null },
    });
  });

  it('returns 401 without a session and never queries', async () => {
    auth.getAuthSession.mockResolvedValue(null);
    const res = await GET(ctx(new Request(BASE)));
    expect(res.status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it('returns 500 when the query fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.replies.push(new Error('boom'));
    const res = await GET(ctx(new Request(BASE)));
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});

describe('POST /api/account/alert-preferences', () => {
  it('inserts a user-level row when none exists (no wallet to check)', async () => {
    state.replies.push([]); // lookup: no row
    const res = await post({ threshold: 1.5, direction: 'below' });
    expect(res.status).toBe(200);
    expect(state.calls).toHaveLength(2);

    const [lookup, insert] = state.calls;
    expect(oneLine(lookup)).toContain('wallet_id IS NOT DISTINCT FROM ?');
    expect(lookup.args).toEqual(['user-1', null]);
    expect(oneLine(insert)).toMatch(/^INSERT INTO alert_preferences/);
    expect(insert.args.slice(1)).toEqual(['user-1', null, 1.5, 'below', 1]);
  });

  it('updates the existing row for a wallet the user can see', async () => {
    state.replies.push([{ '?column?': 1 }]); // ownership: wallet is in one of the user's tenants
    state.replies.push([{ id: 'ap-7' }]); // lookup: row exists
    const res = await post({ walletId: 'w1', threshold: 2, direction: 'above', enabled: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, threshold: 2, direction: 'above', enabled: false });

    const [owned, lookup, update] = state.calls;
    expect(oneLine(owned)).toContain('JOIN tenant_memberships tm ON tm.tenant_id = w.tenant_id WHERE w.id = ? AND tm.user_id = ?');
    expect(owned.args).toEqual(['w1', 'user-1']);
    expect(lookup.args).toEqual(['user-1', 'w1']);
    expect(oneLine(update)).toMatch(/^UPDATE alert_preferences/);
    expect(update.args).toEqual([2, 'above', 0, 'ap-7']);
  });

  it('refuses a wallet outside the user\'s tenants and writes nothing', async () => {
    state.replies.push([]); // ownership: no such wallet in any of the user's tenants
    const res = await post({ walletId: 'other-tenant-wallet', threshold: 1.5 });
    expect(res.status).toBe(404);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].args).toEqual(['other-tenant-wallet', 'user-1']);
  });

  it('returns 401 without a session and never queries', async () => {
    auth.getAuthSession.mockResolvedValue(null);
    const res = await post({ threshold: 1.5 });
    expect(res.status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });

  it.each([0, 101])('rejects threshold %s with 400 and never queries', async (threshold) => {
    const res = await post({ threshold });
    expect(res.status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
});
