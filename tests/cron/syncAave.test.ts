import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GET /api/cron/sync-aave (and /api/cron/sync-defi, which runs the same handler) decides per
 * wallet whether it can hold Aave positions from the wallet's `chains`. The wallet query once
 * left `chains` out of its SELECT, so every wallet read as having no EVM chain and was skipped
 * before the position refresh and the liquidation import. No database and no network: the
 * '@/lib/db' stub answers the wallet SELECT with only the columns it names (as Postgres would),
 * and fetch returns an empty Aave answer.
 */

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; args: unknown[] }>,
  wallets: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/db', () => ({
  db: {
    execute: async (stmt: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      const args = typeof stmt === 'string' ? [] : stmt.args ?? [];
      state.calls.push({ sql, args });
      const select = sql.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\s+wallets\b/i);
      if (!select) return { rows: [], rowsAffected: 1 };
      const columns = select[1].split(',').map((c) => c.trim());
      const rows = state.wallets.map((w) => Object.fromEntries(columns.map((c) => [c, w[c]])));
      return { rows, rowsAffected: 0 };
    },
  },
}));

const liquidations = vi.hoisted(() => ({ syncLiquidationsToImportTransactions: vi.fn() }));
vi.mock('@/lib/aave/syncAaveLiquidations', () => liquidations);

import { GET } from '../../src/pages/api/cron/sync-aave';
import { GET as syncDefiGET } from '../../src/pages/api/cron/sync-defi';

const EVM = '0x00000000000000000000000000000000000000e1';
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

const wallet = (id: string, address: string, chains: unknown) => ({
  id, tenant_id: 't1', address, label: id, chains, wallet_type: 'onchain', created_at: '2026-01-01',
});

async function run() {
  const pending = GET({
    request: new Request('https://app.test/api/cron/sync-aave', { headers: { 'x-cron-secret': 'test-secret' } }),
  } as never) as Promise<Response>;
  await vi.runAllTimersAsync();
  const body = await (await pending).json();
  return Object.fromEntries(body.results.map((r: { walletId: string; status: string }) => [r.walletId, r.status]));
}

const defiWrites = () => state.calls.filter((c) => /INSERT INTO wallet_defi_sync/.test(c.sql));
const fetchBodies = () => vi.mocked(fetch).mock.calls.map(([, init]) => String(init?.body ?? ''));

beforeEach(() => {
  state.calls = [];
  state.wallets = [];
  liquidations.syncLiquidationsToImportTransactions.mockReset();
  liquidations.syncLiquidationsToImportTransactions.mockResolvedValue(0);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 })));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sync-aave wallet selection', () => {
  it('the GitHub Actions backup, sync-defi, runs this same handler', () => {
    expect(syncDefiGET).toBe(GET);
  });

  it('selects the chains column', async () => {
    await run();
    const [walletQuery] = state.calls;
    expect(walletQuery.sql).toMatch(/SELECT[\s\S]*\bchains\b[\s\S]*FROM wallets/);
  });

  it('syncs an EVM wallet and imports its liquidations; skips a bitcoin-only wallet', async () => {
    state.wallets = [wallet('evm', EVM, '["ethereum","polygon"]'), wallet('btc', BTC, '["bitcoin"]')];
    const status = await run();

    expect(status).toEqual({ evm: 'synced', btc: 'skipped' });
    expect(defiWrites().map((c) => c.args[1])).toEqual(['evm']);
    expect(liquidations.syncLiquidationsToImportTransactions).toHaveBeenCalledTimes(1);
    expect(liquidations.syncLiquidationsToImportTransactions).toHaveBeenCalledWith('t1', EVM);
    expect(fetchBodies().length).toBeGreaterThan(0);
    expect(fetchBodies().some((b) => b.includes(BTC))).toBe(false);
  });

  it('reads chains returned as an array as well as JSON text', async () => {
    state.wallets = [wallet('evm', EVM, ['avalanche']), wallet('btc', BTC, ['bitcoin', 'litecoin'])];
    expect(await run()).toEqual({ evm: 'synced', btc: 'skipped' });
  });

  it('treats empty, missing or unreadable chains as the default EVM chains, for EVM addresses only', async () => {
    state.wallets = [
      wallet('empty', EVM, '[]'),
      wallet('null', EVM, null),
      wallet('badjson', EVM, '["ethereum"'),
      wallet('btc-null', BTC, null),
      wallet('btc-empty', BTC, '[]'),
    ];
    expect(await run()).toEqual({
      empty: 'synced', null: 'synced', badjson: 'synced', 'btc-null': 'skipped', 'btc-empty': 'skipped',
    });
    expect(fetchBodies().some((b) => b.includes(BTC))).toBe(false);
  });
});
