import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/cron/sync-wallets, the weekly wallet sync:
 *   - a wallet whose address is not an EVM address (a custom wallet's `custom_…`) is skipped, and
 *     skipping is not a failure;
 *   - the 6-day check reads last_run_at as a time in either format it was ever written in, not as
 *     text (`2026-11-19 18:00:00` sorts below `2026-11-19T12:00…Z` as text, though it is later);
 *   - after the loop, the lifecycle of each account that got new rows is rebuilt, once, with the
 *     rebuild the Sync now button runs; one failing does not stop the next;
 *   - ISO values of last_run_at are rewritten once, across every account.
 *
 * Every id and address here is invented. No database, no network.
 */

const NOW = Date.parse('2026-11-25T12:00:00Z');

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; args: unknown[] }>,
  wallets: [] as Array<Record<string, unknown>>,
  lastRun: {} as Record<string, string | null>,
  inserted: {} as Record<string, number>,
  rebuildFails: new Set<string>(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
      state.calls.push({ sql, args });
      if (/FROM wallets\b/i.test(sql)) return { rows: state.wallets, rowsAffected: 0 };
      if (/FROM wallet_sync_state/i.test(sql)) return { rows: [{ last_run: state.lastRun[String(args[0])] ?? null }], rowsAffected: 0 };
      return { rows: [], rowsAffected: 0 };
    },
  },
}));

const sync = vi.hoisted(() => ({
  syncWalletTransactions: vi.fn(async (_tenantId: string, wallet: { id: string }) => ({
    walletId: wallet.id, totalInserted: state.inserted[wallet.id] ?? 0, totalSkipped: 0, chains: [],
  })),
}));
vi.mock('@/lib/sync/syncTransactions', () => sync);

const rebuild = vi.hoisted(() => ({
  rebuildLifecycleAndCaches: vi.fn(async (tenantId: string) => {
    if (state.rebuildFails.has(tenantId)) throw new Error('lock timeout');
  }),
}));
vi.mock('@/lib/lifecycleRebuild', () => rebuild);

import { GET } from '../../src/pages/api/cron/sync-wallets';
import { resetSyncRunAtForTests, SYNC_RUN_AT_REWRITE } from '../../src/lib/sync/syncRunAt';

const EVM_1 = '0x00000000000000000000000000000000000000b1';
const EVM_2 = '0x00000000000000000000000000000000000000b2';
const EVM_3 = '0x00000000000000000000000000000000000000b3';
const EVM_4 = '0x00000000000000000000000000000000000000b4';
const CUSTOM = 'custom_00000000-0000-4000-8000-000000000002';

const wallet = (id: string, tenant: string, address: string) => ({
  id, tenant_id: tenant, address, label: id, chains: '["ethereum"]', is_default: 0, created_at: '2026-01-01', wallet_type: 'onchain',
});

async function run() {
  const pending = GET({
    request: new Request('https://app.test/api/cron/sync-wallets', { headers: { 'x-cron-secret': 'test-secret' } }),
  } as never) as Promise<Response>;
  await vi.runAllTimersAsync();
  return (await pending).json();
}

beforeEach(() => {
  state.calls = [];
  state.wallets = [];
  state.lastRun = {};
  state.inserted = {};
  state.rebuildFails = new Set();
  sync.syncWalletTransactions.mockClear();
  rebuild.rebuildLifecycleAndCaches.mockClear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the weekly wallet sync', () => {
  it('skips a custom wallet without syncing it, and does not count it as failed', async () => {
    state.wallets = [wallet('w-custom', 't1', CUSTOM), wallet('w-evm', 't1', EVM_1)];
    const body = await run();
    expect(sync.syncWalletTransactions.mock.calls.map((c) => (c[1] as { id: string }).id)).toEqual(['w-evm']);
    expect(body).toMatchObject({ synced: 1, skipped_not_evm: 1, failed: 0 });
    expect(body.results.find((r: { walletId: string }) => r.walletId === 'w-custom')).toMatchObject({ skippedNotEvm: true });
  });

  it('reads the last run as a time in either format', async () => {
    state.wallets = [wallet('w-fresh', 't1', EVM_1), wallet('w-fresh-iso', 't1', EVM_2), wallet('w-stale', 't1', EVM_3), wallet('w-never', 't1', EVM_4)];
    state.lastRun = {
      'w-fresh': '2026-11-19 18:00:00', // 5 days 18 hours ago: fresh, though as text it sorts below the ISO cut-off
      'w-fresh-iso': '2026-11-24T09:30:00.000Z',
      'w-stale': '2026-11-19 06:00:00', // 6 days 6 hours ago
      'w-never': null,
    };
    await run();
    expect(sync.syncWalletTransactions.mock.calls.map((c) => (c[1] as { id: string }).id)).toEqual(['w-stale', 'w-never']);
    const stale = state.calls.find((c) => /FROM wallet_sync_state/i.test(c.sql))!;
    expect(stale.sql).toContain("MAX(replace(substr(CAST(last_run_at AS TEXT), 1, 19), 'T', ' '))");
  });

  it('rebuilds the lifecycle once for each account that got new rows, and goes on after one fails', async () => {
    state.wallets = [
      wallet('w-a1', 't-a', EVM_1), wallet('w-a2', 't-a', EVM_2),
      wallet('w-b', 't-b', EVM_3),
      wallet('w-c', 't-c', EVM_4),
    ];
    state.inserted = { 'w-a1': 2, 'w-a2': 5, 'w-b': 0, 'w-c': 1 };
    state.rebuildFails = new Set(['t-a']);
    const body = await run();
    expect(rebuild.rebuildLifecycleAndCaches.mock.calls.map((c) => c[0])).toEqual(['t-a', 't-c']);
    expect(body).toMatchObject({ lifecycles_rebuilt: 1, lifecycle_rebuilds_failed: 1, synced: 4, failed: 0 });
  });

  it('rebuilds nothing when no account got new rows', async () => {
    state.wallets = [wallet('w-a1', 't-a', EVM_1)];
    const body = await run();
    expect(rebuild.rebuildLifecycleAndCaches).not.toHaveBeenCalled();
    expect(body.lifecycles_rebuilt).toBe(0);
  });

  it('rewrites ISO values of last_run_at before it reads them', async () => {
    state.wallets = [wallet('w-a1', 't-a', EVM_1)];
    resetSyncRunAtForTests();
    await run();
    const rewrite = state.calls.findIndex((c) => c.sql === SYNC_RUN_AT_REWRITE);
    const firstRead = state.calls.findIndex((c) => /FROM wallet_sync_state/i.test(c.sql));
    expect(rewrite).toBeGreaterThan(-1);
    expect(rewrite).toBeLessThan(firstRead);
  });

  it('the Sync now route and the weekly job run the same rebuild', async () => {
    const { readFileSync } = await import('node:fs');
    const route = readFileSync(new URL('../../src/pages/api/lifecycle/rebuild.ts', import.meta.url), 'utf8');
    expect(route).toContain('await rebuildLifecycleAndCaches(tenantId);');
  });
});
