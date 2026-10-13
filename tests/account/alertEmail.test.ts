import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/account/alert-email — what the dashboard's "Alerts go to X" line reads. Pins
 * that `effective` always matches what verify-monitor's fallback (resolveAlertRecipient)
 * would actually mail: the explicit alert_email when set, else the sign-in email.
 */

type Row = Record<string, any>;
const mem = vi.hoisted(() => ({ user: null as Row | null }));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: { sql: string; args?: unknown[] }) => {
      const sql = stmt.sql.replace(/\s+/g, ' ').trim();
      if (sql === 'SELECT alert_email, email FROM auth_users WHERE id = ? LIMIT 1') {
        return { rows: mem.user ? [mem.user] : [] };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    },
  },
}));
const auth = vi.hoisted(() => ({ getAuthSession: vi.fn() }));
vi.mock('@/lib/authSession', () => auth);

import { GET } from '../../src/pages/api/account/alert-email';

const req = () => new Request('https://almstins.com/api/account/alert-email');

beforeEach(() => {
  mem.user = null;
  auth.getAuthSession.mockReset();
  auth.getAuthSession.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('GET /api/account/alert-email', () => {
  it('401s when signed out', async () => {
    auth.getAuthSession.mockResolvedValue(null);
    const res = await (GET as any)({ request: req() });
    expect(res.status).toBe(401);
  });

  it('effective is the sign-in email when alert_email was never set', async () => {
    mem.user = { alert_email: null, email: 'signin@shop.test' };
    const res = await (GET as any)({ request: req() });
    const body = await res.json();
    expect(body).toEqual({ ok: true, alertEmail: null, signInEmail: 'signin@shop.test', effective: 'signin@shop.test' });
  });

  it('effective is the explicit alert_email when one is set', async () => {
    mem.user = { alert_email: 'alerts@shop.test', email: 'signin@shop.test' };
    const res = await (GET as any)({ request: req() });
    const body = await res.json();
    expect(body).toEqual({ ok: true, alertEmail: 'alerts@shop.test', signInEmail: 'signin@shop.test', effective: 'alerts@shop.test' });
  });
});
