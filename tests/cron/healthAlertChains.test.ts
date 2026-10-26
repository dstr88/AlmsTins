import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A wallet with Aave positions on two chains has two health factors, and the alert must look at
 * both. The cron used to read the first chain with a health factor and stop, so a safe Ethereum
 * position hid a Polygon position close to liquidation. Now every chain is checked and the email
 * names the chain most past the threshold. No database, no network: '@/lib/db', the mailer and
 * fetch are stubs.
 */

const state = vi.hoisted(() => ({ prefRows: [] as Record<string, unknown>[], calls: [] as string[] }));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: string | { sql: string }) => {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      state.calls.push(sql);
      if (/FROM alert_preferences ap/.test(sql)) return { rows: state.prefRows, rowsAffected: 0 };
      return { rows: [], rowsAffected: 1 };
    },
  },
}));
vi.mock('@/lib/email', () => ({ sendMail: vi.fn(async () => {}) }));
vi.mock('@/lib/i18n/userLang', () => ({ ensureUserLangColumn: async () => {} }));

import { chainHealths, pickAlertChain } from '../../src/lib/aave/healthAlertChain';
import { GET } from '../../src/pages/api/cron/health-alerts';
import { sendMail } from '@/lib/email';

describe('pickAlertChain', () => {
  const two = [
    { chain: 'ethereum', healthFactor: 3.0 },
    { chain: 'polygon', healthFactor: 1.05 },
  ];

  it('below: finds a risky second chain behind a safe first one', () => {
    expect(pickAlertChain(two, 1.2, 'below')).toEqual({
      status: 'triggered',
      chain: { chain: 'polygon', healthFactor: 1.05 },
      others: [],
    });
  });

  it('below: with two chains past the threshold, names the lowest and lists the other', () => {
    const pick = pickAlertChain(
      [{ chain: 'ethereum', healthFactor: 1.15 }, { chain: 'polygon', healthFactor: 1.05 }, { chain: 'avalanche', healthFactor: 4 }],
      1.2,
      'below',
    );
    expect(pick).toEqual({
      status: 'triggered',
      chain: { chain: 'polygon', healthFactor: 1.05 },
      others: [{ chain: 'ethereum', healthFactor: 1.15 }],
    });
  });

  it('below: every chain safe is ok, reporting the closest one', () => {
    expect(pickAlertChain(two, 1.0, 'below')).toEqual({ status: 'ok', lowest: { chain: 'polygon', healthFactor: 1.05 } });
  });

  it('above: names the highest chain over the threshold', () => {
    expect(pickAlertChain(two, 2, 'above')).toEqual({
      status: 'triggered',
      chain: { chain: 'ethereum', healthFactor: 3.0 },
      others: [],
    });
  });

  it('no chain with a health factor means no positions; an unknown direction never triggers', () => {
    expect(pickAlertChain([], 1.2, 'below')).toEqual({ status: 'no-positions' });
    expect(pickAlertChain(two, 1.2, 'sideways' as never).status).toBe('ok');
  });

  it('chainHealths keeps only finite, positive health factors', () => {
    expect(chainHealths({
      ethereum: { healthFactor: '2.5' },
      polygon: { healthFactor: null },
      avalanche: { healthFactor: 0 },
      ethereum_v4: { healthFactor: 'x' },
      base: undefined,
    })).toEqual([{ chain: 'ethereum', healthFactor: 2.5 }]);
    expect(chainHealths(undefined)).toEqual([]);
  });
});

describe('health-alerts cron with two chains', () => {
  beforeEach(() => {
    state.calls = [];
    state.prefRows = [{
      pref_id: 'p1', wallet_id: 'w1', wallet_address: '0x' + 'a'.repeat(40), wallet_label: 'Main',
      alert_email: 'owner@example.test', threshold: 1.2, direction: 'below', last_alerted_at: null, lang: 'en',
    }];
    vi.mocked(sendMail).mockClear();
    vi.stubEnv('CRON_SECRET', 'test-secret');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      chains: { ethereum: { healthFactor: 3.0 }, polygon: { healthFactor: 1.05 } },
    }), { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('emails about Polygon when Ethereum is safe and Polygon is past the threshold', async () => {
    const res = await GET({
      request: new Request('https://app.test/api/cron/health-alerts', { headers: { 'x-cron-secret': 'test-secret' } }),
    } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerted).toBe(1);
    expect(body.results[0]).toMatchObject({ walletId: 'w1', status: 'alerted', hf: 1.05 });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(sendMail).mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(mail.to).toBe('owner@example.test');
    expect(`${mail.subject}\n${mail.text}`).toContain('Polygon');
    expect(`${mail.subject}\n${mail.text}`).toContain('1.05');
    expect(state.calls.some((s) => /UPDATE alert_preferences SET last_alerted_at/.test(s))).toBe(true);
  });

  it('sends nothing when every chain is above the threshold', async () => {
    state.prefRows[0].threshold = 1.0;
    const res = await GET({
      request: new Request('https://app.test/api/cron/health-alerts', { headers: { 'x-cron-secret': 'test-secret' } }),
    } as never);
    const body = await res.json();
    expect(body.alerted).toBe(0);
    expect(body.results[0]).toMatchObject({ status: 'ok', hf: 1.05 });
    expect(sendMail).not.toHaveBeenCalled();
  });
});
