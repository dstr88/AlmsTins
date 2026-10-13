import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

/**
 * SD1 — resolveAlertRecipient(), the fallback a lapse/swap alert actually goes to when a
 * tenant never set alert_email (true for every account before this: signup never asks).
 * Pins: falls back to the sign-in email; prefers an explicit alert_email over it; prefers
 * the owner-role member over any other; is stable (earliest-added) with no owner-role
 * member; resolves nothing for a tenant with no members; fails closed on a DB error.
 */

type Row = Record<string, any>;
const mem = vi.hoisted(() => ({ memberships: [] as Row[], users: [] as Row[], throws: false }));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => {
      if (mem.throws) throw new Error('connection reset');
      const sql = stmt.sql.replace(/\s+/g, ' ').trim();
      const [tenantId] = (stmt.args ?? []) as string[];
      if (sql !== `SELECT COALESCE(au.alert_email, au.email) AS email, au.lang FROM tenant_memberships tm JOIN auth_users au ON au.id = tm.user_id WHERE tm.tenant_id = ? ORDER BY (tm.role = 'owner') DESC, tm.created_at ASC LIMIT 1`) {
        throw new Error(`unexpected SQL in test: ${sql}`);
      }
      const rows = mem.memberships
        .filter((m) => m.tenant_id === tenantId)
        .map((m) => ({ m, u: mem.users.find((u) => u.id === m.user_id)! }))
        .sort((a, b) => (Number(b.m.role === 'owner') - Number(a.m.role === 'owner')) || String(a.m.created_at).localeCompare(String(b.m.created_at)));
      const hit = rows[0];
      return { rows: hit ? [{ email: hit.u.alert_email ?? hit.u.email, lang: hit.u.lang ?? 'en' }] : [] };
    },
  },
}));

import { resolveAlertRecipient } from '../../src/lib/verifyAlertRecipient';

const user = (id: string, email: string, alertEmail: string | null = null, lang = 'en') =>
  ({ id, email, alert_email: alertEmail, lang });
const member = (tenantId: string, userId: string, role: string, createdAt: string) =>
  ({ tenant_id: tenantId, user_id: userId, role, created_at: createdAt });

beforeEach(() => { mem.memberships = []; mem.users = []; mem.throws = false; });

describe('resolveAlertRecipient', () => {
  it('falls back to the sign-in email when alert_email was never set', async () => {
    mem.users = [user('u1', 'signin@shop.test')];
    mem.memberships = [member('t1', 'u1', 'owner', '2026-01-01 00:00:00')];
    expect(await resolveAlertRecipient('t1')).toEqual({ email: 'signin@shop.test', lang: 'en' });
  });

  it('prefers an explicit alert_email over the sign-in email', async () => {
    mem.users = [user('u1', 'signin@shop.test', 'alerts@shop.test', 'es')];
    mem.memberships = [member('t1', 'u1', 'owner', '2026-01-01 00:00:00')];
    expect(await resolveAlertRecipient('t1')).toEqual({ email: 'alerts@shop.test', lang: 'es' });
  });

  it('prefers the owner-role member over a member added earlier', async () => {
    mem.users = [user('u1', 'staff@shop.test'), user('u2', 'boss@shop.test')];
    mem.memberships = [
      member('t1', 'u1', 'member', '2026-01-01 00:00:00'),
      member('t1', 'u2', 'owner', '2026-01-02 00:00:00'),
    ];
    expect((await resolveAlertRecipient('t1')).email).toBe('boss@shop.test');
  });

  it('falls back to the earliest-added member when no one holds the owner role', async () => {
    mem.users = [user('u1', 'first@shop.test'), user('u2', 'second@shop.test')];
    mem.memberships = [
      member('t1', 'u1', 'member', '2026-01-02 00:00:00'),
      member('t1', 'u2', 'member', '2026-01-01 00:00:00'),
    ];
    expect((await resolveAlertRecipient('t1')).email).toBe('second@shop.test');
  });

  it('resolves nothing for a tenant with no members', async () => {
    expect(await resolveAlertRecipient('nobody')).toEqual({ email: null, lang: 'en' });
  });

  it('fails closed (no email, no throw) on a database error', async () => {
    mem.throws = true;
    await expect(resolveAlertRecipient('t1')).resolves.toEqual({ email: null, lang: 'en' });
  });

  it('falls back to en for an unrecognized lang value', async () => {
    mem.users = [user('u1', 'x@shop.test', null, 'xx')];
    mem.memberships = [member('t1', 'u1', 'owner', '2026-01-01 00:00:00')];
    expect((await resolveAlertRecipient('t1')).lang).toBe('en');
  });
});
