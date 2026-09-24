import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GET /api/cron/health-alerts emails a wallet's address, label and Aave health factor to the
 * user who saved the alert preference. It must only do that while the user is a member of
 * the wallet's tenant: a preference saved for another tenant's wallet, or kept after the user
 * left the tenant, must not select any row. No database: '@/lib/db' records the statement.
 */

const state = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: string | { sql: string }) => {
      state.calls.push(typeof stmt === 'string' ? stmt : stmt.sql);
      return { rows: [], rowsAffected: 0 };
    },
  },
}));
vi.mock('@/lib/email', () => ({ sendMail: vi.fn() }));
vi.mock('@/lib/i18n/userLang', () => ({ ensureUserLangColumn: async () => {} }));

import { GET } from '../../src/pages/api/cron/health-alerts';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  state.calls = [];
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('health-alerts cron', () => {
  it('selects a preference only while its user is a member of the wallet\'s tenant', async () => {
    const res = await GET({
      request: new Request('https://app.test/api/cron/health-alerts', { headers: { 'x-cron-secret': 'test-secret' } }),
    } as never);
    expect(res.status).toBe(200);

    const select = oneLine(state.calls.find((s) => /FROM alert_preferences ap/.test(s))!);
    expect(select).toContain('JOIN wallets w ON w.id = ap.wallet_id');
    expect(select).toContain(
      'AND EXISTS ( SELECT 1 FROM tenant_memberships tm WHERE tm.tenant_id = w.tenant_id AND tm.user_id = ap.user_id )',
    );
  });

  it('rejects a request without the cron secret and never queries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await GET({ request: new Request('https://app.test/api/cron/health-alerts') } as never);
    expect(res.status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });
});
