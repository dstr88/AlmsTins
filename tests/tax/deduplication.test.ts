/**
 * tests/tax/deduplication.test.ts
 *
 * Unit tests for runDuplicateSweep and setDuplicateOverride.
 *
 * The module is DB-heavy (three read queries + one atomic batch write).
 * We mock db.execute and db.batch at the module level so all tests run
 * in-process without a real database connection.
 *
 * Strategy for mock routing:
 *   db.execute calls are routed by SQL content substring since the three
 *   strategies each issue distinct queries (hash match, cross-table pool,
 *   within-import batch). The routing matches the order classify.ts calls them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db ───────────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the file by Vitest, before any const
// declarations.  Use vi.hoisted so the mock functions are available at hoist
// time and can be referenced inside the factory.
const { mockExecute, mockBatch } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockBatch:   vi.fn(),
}));

vi.mock('../../src/lib/db', () => ({
  db: { execute: mockExecute, batch: mockBatch },
}));

import { runDuplicateSweep, setDuplicateOverride } from '../../src/lib/yearEnd/deduplication';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock import_transactions row for strategy 1 (hash match). */
function hashRow(importId: string, onchainId: string) {
  return { import_id: importId, onchain_id: onchainId };
}

/** Build a mock import_transactions row for strategy 2/3 pool queries. */
function importPoolRow(overrides: {
  id: string;
  asset_symbol?: string;
  qty?: number;
  timestamp_utc?: string;
}) {
  return {
    id:            overrides.id,
    asset_symbol:  overrides.asset_symbol ?? 'BTC',
    qty:           overrides.qty          ?? 1,
    timestamp_utc: overrides.timestamp_utc ?? '2024-06-01T12:00:00Z',
  };
}

/** Build a mock transactions row for strategy 2 pool query. */
function onchainPoolRow(overrides: {
  id: string;
  token_symbol?: string;
  qty?: number;
  timestamp?: string;
}) {
  return {
    id:           overrides.id,
    token_symbol: overrides.token_symbol ?? 'BTC',
    qty:          overrides.qty          ?? 1,
    timestamp:    overrides.timestamp    ?? '2024-06-01T12:00:00Z',
  };
}

/** Build a mock within-import batch row for strategy 3. */
function batchRow(overrides: {
  id: string;
  source?: string;
  asset_symbol?: string;
  direction?: string;
  qty?: number;
  import_batch_id?: string;
  timestamp_utc?: string;
}) {
  return {
    id:               overrides.id,
    source:           overrides.source           ?? 'coinbase',
    asset_symbol:     overrides.asset_symbol     ?? 'ETH',
    direction:        overrides.direction        ?? 'in',
    qty:              overrides.qty              ?? 0.5,
    import_batch_id:  overrides.import_batch_id  ?? 'batch-A',
    timestamp_utc:    overrides.timestamp_utc    ?? '2024-03-15T10:00:00Z',
  };
}

/**
 * Set up the three mock execute calls that runDuplicateSweep issues.
 * Routes by SQL content substring.
 */
function setupMock(opts: {
  hashRows?:        ReturnType<typeof hashRow>[];
  importPoolRows?:  ReturnType<typeof importPoolRow>[];
  onchainPoolRows?: ReturnType<typeof onchainPoolRow>[];
  batchRows?:       ReturnType<typeof batchRow>[];
} = {}) {
  mockExecute.mockImplementation(({ sql }: { sql: string }) => {
    // Strategy 1: JOIN transactions t (hash match cross-table join)
    if (sql.includes('JOIN transactions t')) {
      return Promise.resolve({ rows: opts.hashRows ?? [] });
    }
    // Strategy 2 — onchain pool: CAST(value AS REAL) is unique to the onchain query
    if (sql.includes('CAST(value AS REAL)')) {
      return Promise.resolve({ rows: opts.onchainPoolRows ?? [] });
    }
    // Strategy 3 — batch rows: import_batch_id is present only in the strategy 3 query.
    // Must be checked BEFORE the strategy 2 import-pool check because strategy 3's
    // query also selects ABS(amount) AS qty and timestamp_utc.
    if (sql.includes('import_batch_id')) {
      return Promise.resolve({ rows: opts.batchRows ?? [] });
    }
    // Strategy 2 — import pool: ABS(amount) AS qty from import_transactions (no batch_id)
    if (sql.includes('ABS(amount) AS qty') && sql.includes('timestamp_utc')) {
      return Promise.resolve({ rows: opts.importPoolRows ?? [] });
    }
    // setDuplicateOverride UPDATE call
    if (sql.includes('SET is_duplicate = ?')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });

  mockBatch.mockResolvedValue([]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runDuplicateSweep — strategy 1: tx_hash exact match', () => {
  it('returns strategy1TxHash count equal to number of hash matches', async () => {
    setupMock({ hashRows: [hashRow('imp-1', 'onc-1'), hashRow('imp-2', 'onc-2')] });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy1TxHash).toBe(2);
    expect(stats.totalMarked).toBe(2);
  });

  it('includes one UPDATE statement per hash match in the batch', async () => {
    setupMock({ hashRows: [hashRow('imp-A', 'onc-A')] });
    await runDuplicateSweep('tenant-1');
    const stmts = mockBatch.mock.calls[0][0] as { sql: string; args: unknown[] }[];
    // First two stmts are the clear statements; next should be strategy 1
    const s1Stmts = stmts.filter((s) => s.sql.includes('SET is_duplicate = 1') && s.args?.includes('onc-A'));
    expect(s1Stmts).toHaveLength(1);
    expect(s1Stmts[0].args).toEqual(['onc-A', 'imp-A', 'tenant-1']);
  });

  it('returns zero strategy1 when no hash matches', async () => {
    setupMock({});
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy1TxHash).toBe(0);
  });

  it('passes tenant_id to the hash match query', async () => {
    setupMock({});
    await runDuplicateSweep('my-tenant');
    const hashCall = mockExecute.mock.calls.find(
      ([{ sql }]: [{ sql: string }]) => sql.includes('JOIN transactions t'),
    );
    expect(hashCall?.[0].args).toContain('my-tenant');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runDuplicateSweep — strategy 2: cross-table amount+symbol+timestamp', () => {
  it('matches import and onchain rows with same symbol, qty within 1%, and timestamp within 5 min', async () => {
    setupMock({
      importPoolRows:  [importPoolRow({ id: 'imp-1', asset_symbol: 'BTC', qty: 1.0,  timestamp_utc: '2024-06-01T12:00:00Z' })],
      onchainPoolRows: [onchainPoolRow({ id: 'onc-1', token_symbol: 'BTC', qty: 1.005, timestamp: '2024-06-01T12:02:00Z' })],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy2CrossTable).toBe(1);
    expect(stats.totalMarked).toBe(1);
  });

  it('does NOT match when amounts differ by more than 1%', async () => {
    setupMock({
      importPoolRows:  [importPoolRow({ id: 'imp-1', qty: 1.0 })],
      onchainPoolRows: [onchainPoolRow({ id: 'onc-1', qty: 1.02 })], // 2% diff
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy2CrossTable).toBe(0);
  });

  it('does NOT match when timestamps differ by more than 5 minutes', async () => {
    setupMock({
      importPoolRows:  [importPoolRow({ id: 'imp-1', timestamp_utc: '2024-06-01T12:00:00Z' })],
      onchainPoolRows: [onchainPoolRow({ id: 'onc-1', timestamp: '2024-06-01T12:06:00Z' })], // 6 min diff
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy2CrossTable).toBe(0);
  });

  it('does NOT match on different asset symbols', async () => {
    setupMock({
      importPoolRows:  [importPoolRow({ id: 'imp-1', asset_symbol: 'BTC' })],
      onchainPoolRows: [onchainPoolRow({ id: 'onc-1', token_symbol: 'ETH' })],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy2CrossTable).toBe(0);
  });

  it('matches case-insensitively (btc vs BTC)', async () => {
    setupMock({
      importPoolRows:  [importPoolRow({ id: 'imp-1', asset_symbol: 'btc', qty: 1 })],
      onchainPoolRows: [onchainPoolRow({ id: 'onc-1', token_symbol: 'BTC', qty: 1 })],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy2CrossTable).toBe(1);
  });

  it('skips import rows that were already matched by strategy 1', async () => {
    // imp-1 is matched by strategy 1 (hash match), so strategy 2 should ignore it
    setupMock({
      hashRows:        [hashRow('imp-1', 'onc-A')],
      importPoolRows:  [importPoolRow({ id: 'imp-1', asset_symbol: 'BTC', qty: 1.0 })],
      onchainPoolRows: [onchainPoolRow({ id: 'onc-1', token_symbol: 'BTC', qty: 1.0 })],
    });
    const stats = await runDuplicateSweep('tenant-1');
    // strategy1 = 1, strategy2 = 0 (imp-1 already consumed)
    expect(stats.strategy1TxHash).toBe(1);
    expect(stats.strategy2CrossTable).toBe(0);
  });

  it('does not match the same onchain row to two different import rows', async () => {
    setupMock({
      importPoolRows: [
        importPoolRow({ id: 'imp-1', asset_symbol: 'ETH', qty: 2.0, timestamp_utc: '2024-06-01T12:00:00Z' }),
        importPoolRow({ id: 'imp-2', asset_symbol: 'ETH', qty: 2.0, timestamp_utc: '2024-06-01T12:01:00Z' }),
      ],
      onchainPoolRows: [
        onchainPoolRow({ id: 'onc-1', token_symbol: 'ETH', qty: 2.0, timestamp: '2024-06-01T12:00:30Z' }),
      ],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy2CrossTable).toBe(1); // only one match, not two
  });

  it('matches when amounts are within 1% (0.5% diff)', async () => {
    setupMock({
      importPoolRows:  [importPoolRow({ id: 'imp-1', qty: 1.0 })],
      onchainPoolRows: [onchainPoolRow({ id: 'onc-1', qty: 1.005 })], // 0.5% — clearly within 1%
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy2CrossTable).toBe(1);
  });

  it('does NOT match when amounts differ by more than 1% (1.1% diff)', async () => {
    setupMock({
      importPoolRows:  [importPoolRow({ id: 'imp-1', qty: 1.0 })],
      onchainPoolRows: [onchainPoolRow({ id: 'onc-1', qty: 1.011 })], // 1.1% — outside tolerance
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy2CrossTable).toBe(0);
  });

  it('matches exactly at the 5-minute timestamp boundary (inclusive)', async () => {
    setupMock({
      importPoolRows:  [importPoolRow({ id: 'imp-1', timestamp_utc: '2024-06-01T12:00:00Z' })],
      onchainPoolRows: [onchainPoolRow({ id: 'onc-1', timestamp: '2024-06-01T12:05:00Z' })], // exactly 300 s — should match
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy2CrossTable).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runDuplicateSweep — strategy 3: within-import near-duplicate', () => {
  it('marks the newer-batch row as duplicate when source/symbol/direction/amount/timestamp match', async () => {
    setupMock({
      batchRows: [
        batchRow({ id: 'imp-1', import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:00Z' }),
        batchRow({ id: 'imp-2', import_batch_id: 'batch-B', timestamp_utc: '2024-03-15T10:00:10Z' }),
      ],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy3WithinImport).toBe(1);
    expect(stats.totalMarked).toBe(1);
  });

  it('does NOT match when rows are from the same batch', async () => {
    setupMock({
      batchRows: [
        batchRow({ id: 'imp-1', import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:00Z' }),
        batchRow({ id: 'imp-2', import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:05Z' }), // same batch
      ],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy3WithinImport).toBe(0);
  });

  it('does NOT match when timestamps differ by more than 30 seconds', async () => {
    setupMock({
      batchRows: [
        batchRow({ id: 'imp-1', import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:00Z' }),
        batchRow({ id: 'imp-2', import_batch_id: 'batch-B', timestamp_utc: '2024-03-15T10:00:31Z' }), // 31 s apart
      ],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy3WithinImport).toBe(0);
  });

  it('does NOT match across different sources', async () => {
    setupMock({
      batchRows: [
        batchRow({ id: 'imp-1', source: 'coinbase',  import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:00Z' }),
        batchRow({ id: 'imp-2', source: 'crypto.com', import_batch_id: 'batch-B', timestamp_utc: '2024-03-15T10:00:05Z' }),
      ],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy3WithinImport).toBe(0);
  });

  it('does NOT match across different directions', async () => {
    setupMock({
      batchRows: [
        batchRow({ id: 'imp-1', direction: 'in',  import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:00Z' }),
        batchRow({ id: 'imp-2', direction: 'out', import_batch_id: 'batch-B', timestamp_utc: '2024-03-15T10:00:05Z' }),
      ],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy3WithinImport).toBe(0);
  });

  it('skips rows already matched by strategy 1 or 2', async () => {
    setupMock({
      hashRows: [hashRow('imp-1', 'onc-X')], // imp-1 consumed by strategy 1
      batchRows: [
        batchRow({ id: 'imp-1', import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:00Z' }),
        batchRow({ id: 'imp-2', import_batch_id: 'batch-B', timestamp_utc: '2024-03-15T10:00:05Z' }),
      ],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy3WithinImport).toBe(0); // imp-1 is the keeper but it's already in s1ImportIds
  });

  it('handles three near-identical imports — marks only two as dupes of the first', async () => {
    setupMock({
      batchRows: [
        batchRow({ id: 'imp-1', import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:00Z' }),
        batchRow({ id: 'imp-2', import_batch_id: 'batch-B', timestamp_utc: '2024-03-15T10:00:05Z' }),
        batchRow({ id: 'imp-3', import_batch_id: 'batch-C', timestamp_utc: '2024-03-15T10:00:10Z' }),
      ],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy3WithinImport).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runDuplicateSweep — atomic batch write', () => {
  it('always includes two CLEAR statements at the start of the batch', async () => {
    setupMock({});
    await runDuplicateSweep('tenant-1');
    const stmts = mockBatch.mock.calls[0][0] as { sql: string }[];
    const clearStmts = stmts.filter((s) => s.sql.includes('SET is_duplicate = 0'));
    expect(clearStmts).toHaveLength(2); // one for import_transactions, one for transactions
  });

  it('uses write mode for the batch', async () => {
    setupMock({});
    await runDuplicateSweep('tenant-1');
    expect(mockBatch.mock.calls[0][1]).toBe('write');
  });

  it('combines all strategies into a single batch call', async () => {
    setupMock({
      hashRows:  [hashRow('imp-1', 'onc-1')],
      batchRows: [
        batchRow({ id: 'imp-10', import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:00Z' }),
        batchRow({ id: 'imp-11', import_batch_id: 'batch-B', timestamp_utc: '2024-03-15T10:00:05Z' }),
      ],
    });
    await runDuplicateSweep('tenant-1');
    // Only one batch call for the entire sweep
    expect(mockBatch).toHaveBeenCalledTimes(1);
  });

  it('returns totalMarked as sum of all three strategies', async () => {
    setupMock({
      hashRows: [hashRow('imp-1', 'onc-1'), hashRow('imp-2', 'onc-2')],
      batchRows: [
        batchRow({ id: 'imp-10', import_batch_id: 'batch-A', timestamp_utc: '2024-03-15T10:00:00Z' }),
        batchRow({ id: 'imp-11', import_batch_id: 'batch-B', timestamp_utc: '2024-03-15T10:00:05Z' }),
      ],
    });
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.totalMarked).toBe(stats.strategy1TxHash + stats.strategy2CrossTable + stats.strategy3WithinImport);
  });

  it('does NOT modify any row with is_duplicate = -1 (user override)', async () => {
    setupMock({ hashRows: [hashRow('imp-1', 'onc-1')] });
    await runDuplicateSweep('tenant-1');
    const stmts = mockBatch.mock.calls[0][0] as { sql: string }[];
    const updateStmts = stmts.filter((s) => s.sql.includes('SET is_duplicate = 1'));
    // All flag-setting statements must guard against -1 and 2
    for (const stmt of updateStmts) {
      expect(stmt.sql).toContain('NOT IN (-1, 2)');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runDuplicateSweep — DedupStats shape', () => {
  it('returns all required stat fields', async () => {
    setupMock({});
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats).toMatchObject({
      strategy1TxHash:      expect.any(Number),
      strategy2CrossTable:  expect.any(Number),
      strategy3WithinImport: expect.any(Number),
      totalMarked:          expect.any(Number),
      totalCleared:         expect.any(Number),
    });
  });

  it('returns zero for all counts when no duplicates found', async () => {
    setupMock({});
    const stats = await runDuplicateSweep('tenant-1');
    expect(stats.strategy1TxHash).toBe(0);
    expect(stats.strategy2CrossTable).toBe(0);
    expect(stats.strategy3WithinImport).toBe(0);
    expect(stats.totalMarked).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('setDuplicateOverride', () => {
  it('sets is_duplicate = 2 for "duplicate" override on import table', async () => {
    setupMock({});
    await setDuplicateOverride('tenant-1', 'import', 'tx-1', 'duplicate');
    const call = mockExecute.mock.calls.find(
      ([{ sql }]: [{ sql: string }]) => sql.includes('SET is_duplicate = ?'),
    );
    expect(call?.[0].args[0]).toBe(2);
    expect(call?.[0].sql).toContain('import_transactions');
  });

  it('sets is_duplicate = -1 for "not-duplicate" override', async () => {
    setupMock({});
    await setDuplicateOverride('tenant-1', 'import', 'tx-1', 'not-duplicate');
    const call = mockExecute.mock.calls.find(
      ([{ sql }]: [{ sql: string }]) => sql.includes('SET is_duplicate = ?'),
    );
    expect(call?.[0].args[0]).toBe(-1);
  });

  it('sets is_duplicate = 0 for "clear" override', async () => {
    setupMock({});
    await setDuplicateOverride('tenant-1', 'import', 'tx-1', 'clear');
    const call = mockExecute.mock.calls.find(
      ([{ sql }]: [{ sql: string }]) => sql.includes('SET is_duplicate = ?'),
    );
    expect(call?.[0].args[0]).toBe(0);
  });

  it('targets the transactions table for onchain sourceType', async () => {
    setupMock({});
    await setDuplicateOverride('tenant-1', 'onchain', 'tx-1', 'duplicate');
    const call = mockExecute.mock.calls.find(
      ([{ sql }]: [{ sql: string }]) => sql.includes('SET is_duplicate = ?'),
    );
    expect(call?.[0].sql).toContain('transactions');
    expect(call?.[0].sql).not.toContain('import_transactions');
  });

  it('filters by both id and tenant_id', async () => {
    setupMock({});
    await setDuplicateOverride('my-tenant', 'import', 'tx-abc', 'duplicate');
    const call = mockExecute.mock.calls.find(
      ([{ sql }]: [{ sql: string }]) => sql.includes('SET is_duplicate = ?'),
    );
    expect(call?.[0].args).toContain('tx-abc');
    expect(call?.[0].args).toContain('my-tenant');
  });

  it('NULLs duplicate_of when clearing the flag', async () => {
    setupMock({});
    await setDuplicateOverride('tenant-1', 'import', 'tx-1', 'clear');
    const call = mockExecute.mock.calls.find(
      ([{ sql }]: [{ sql: string }]) => sql.includes('SET is_duplicate = ?'),
    );
    // The SQL uses CASE WHEN ? = 0 THEN NULL ELSE duplicate_of END
    expect(call?.[0].sql).toContain('CASE WHEN');
    expect(call?.[0].sql).toContain('NULL');
  });
});
