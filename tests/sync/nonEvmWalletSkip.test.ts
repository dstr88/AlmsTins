import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syncFailures } from '../../src/lib/sync/syncReport';

/**
 * A wallet whose address is not an EVM address is not sent to the block explorers. A custom wallet
 * (the kind that holds entries added by hand) has an address like `custom_…`; the in-app sync sent
 * it to the Ethereum and Avalanche explorers, which answered "Invalid address format" on every
 * sync, and from Nov 25, 2026 that answer was logged as a failed chain. A Solana address went to
 * Polygon, which every wallet is synced on. Skipping is not a failure.
 *
 * Every address here is invented. No database, no network: the explorer calls are stubbed.
 */

const state = vi.hoisted(() => ({
  wallets: [] as Array<Record<string, unknown>>,
  scanned: [] as string[],
}));

vi.mock('@/lib/db', () => ({ db: { execute: async () => ({ rows: [], rowsAffected: 1 }) } }));
vi.mock('@/lib/wallets', () => ({ getAllActiveWallets: async () => state.wallets }));
vi.mock('@/lib/transactions', () => ({ bulkUpsertTransactions: vi.fn(async () => []) }));
vi.mock('@/lib/sync/syncAaveLiquidations', () => ({ fetchAndStoreAaveLiquidations: vi.fn(async () => ({ fetched: 0, inserted: 0 })) }));
vi.mock('@/lib/scanSync', () => {
  const empty = (params: Record<string, unknown>) => {
    state.scanned.push(String(params.address));
    return { status: '0', message: 'No transactions found', result: [] };
  };
  return {
    fetchEthereumScan: vi.fn(async (params: Record<string, unknown>) => empty(params)),
    fetchAccountData: vi.fn(async (_chain: string, params: Record<string, unknown>) => empty(params)),
    buildScanUrl: vi.fn(() => null),
  };
});

import { syncAllWallets, syncWalletTransactions } from '../../src/lib/sync/syncTransactions';

const EVM = '0x00000000000000000000000000000000000000a1';
const CUSTOM = 'custom_00000000-0000-4000-8000-000000000001';
const SOLANA = 'So1anaWa11et' + 'Q'.repeat(32);
const wallet = (id: string, address: string, chains: string[], walletType = 'onchain') => ({
  id, tenantId: 't1', address, label: id, chains, isDefault: false, createdAt: '2026-01-01', walletType,
});

beforeEach(() => {
  state.scanned = [];
  state.wallets = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

describe('the in-app sync and a wallet that is not an EVM address', () => {
  it('sends a custom wallet and a Solana wallet to no explorer, and reads the EVM wallet as before', async () => {
    state.wallets = [
      wallet('w-custom', CUSTOM, ['ethereum', 'avalanche'], 'custom'),
      wallet('w-sol', SOLANA, ['solana']),
      wallet('w-evm', EVM, ['ethereum']),
    ];
    const result = await settle(syncAllWallets('t1'));
    expect(state.scanned.length).toBeGreaterThan(0);
    expect(new Set(state.scanned)).toEqual(new Set([EVM]));
    const byId = Object.fromEntries(result.perWallet.map((w) => [w.walletId, w]));
    expect(byId['w-custom']).toMatchObject({ skippedReason: 'not_evm_address', chains: [] });
    expect(byId['w-sol']).toMatchObject({ skippedReason: 'not_evm_address', chains: [] });
    expect(byId['w-evm'].chains.every((c) => c.ok)).toBe(true);
  });

  it('is not a failure', async () => {
    state.wallets = [wallet('w-custom', CUSTOM, ['ethereum'], 'custom'), wallet('w-evm', EVM, ['ethereum'])];
    const result = await settle(syncAllWallets('t1'));
    expect(syncFailures(result).failedWallets).toBe(0);
  });

  it('skips the wallet in syncWalletTransactions itself, which the weekly job and the wallet page call too', async () => {
    const stats = await settle(syncWalletTransactions('t1', wallet('w-custom', CUSTOM, ['ethereum'], 'custom') as never));
    expect(stats).toEqual({ walletId: 'w-custom', totalInserted: 0, totalSkipped: 0, chains: [], skippedReason: 'not_evm_address' });
    expect(state.scanned).toEqual([]);
  });
});
