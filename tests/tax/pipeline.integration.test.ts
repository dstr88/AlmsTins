/**
 * tests/tax/pipeline.integration.test.ts
 *
 * End-to-end integration test: seeds an in-memory libsql (SQLite) database
 * with the real schema and runs the actual classify + deduplication pipeline.
 * No mocks on db.execute / db.batch — if a column rename or type mismatch
 * happens in a migration, this test will catch it where 310 unit tests won't.
 *
 * What's covered:
 *   • Full DDL: every table the pipeline reads from or writes to
 *   • runDuplicateSweep — all three strategies against real SQL
 *   • runTaxPipeline — passes 1–5, DB writes, run log
 *   • Correct FIFO gain/loss calculation stored in tax_disposals
 *   • Pipeline run log: status='success', non-null stats
 *   • Income classification written to tax_classifications
 *   • Review queue populated for low-confidence and unpriced items
 *   • Column names — any rename that breaks a SELECT/INSERT will fail here
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';

// ── Hoist: create the in-memory DB before vi.mock factories run ───────────────
// vi.mock is hoisted before import statements execute, so we can't reference
// top-level imports inside vi.hoisted.  Use require() inside the factory to
// load @libsql/client synchronously at hoist time.
const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@libsql/client') as typeof import('@libsql/client');
  const testDb: Client = createClient({ url: 'file::memory:' });
  return { testDb };
});

// Replace the real db (which needs TURSO_DATABASE_URL env var) with the
// in-memory client for the duration of this file.
vi.mock('../../src/lib/db', () => ({ db: testDb }));

// Silence the cache-busting call — it tries to DELETE from turso_cache which
// doesn't exist in the minimal test schema. classify.ts already .catch()es it,
// but mocking avoids noise in test output.
vi.mock('../../src/lib/tursoCache', () => ({
  deleteCachePrefix: () => Promise.resolve(),
  getCache: () => Promise.resolve(null),
  setCache: () => Promise.resolve(),
}));

import { runTaxPipeline } from '../../src/lib/yearEnd/classify';
import { runDuplicateSweep } from '../../src/lib/yearEnd/deduplication';

// ── Schema ────────────────────────────────────────────────────────────────────
// Minimal DDL matching the production migrations.  Any column rename in a
// migration file that isn't reflected here (or vice-versa) will cause the
// INSERT fixtures below to fail with a schema error.

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS import_transactions (
  id               TEXT    PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  timestamp_utc    TEXT    NOT NULL,
  asset_symbol     TEXT,
  direction        TEXT,
  kind             TEXT,
  amount           REAL,
  to_amount        REAL,
  native_usd       REAL,
  tx_hash          TEXT,
  source           TEXT    NOT NULL DEFAULT '',
  notes            TEXT,
  category         TEXT,
  is_duplicate     INTEGER NOT NULL DEFAULT 0,
  duplicate_of     TEXT,
  import_batch_id  TEXT    NOT NULL DEFAULT 'batch-default'
);

CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT    PRIMARY KEY,
  tenant_id    TEXT    NOT NULL,
  wallet_id    TEXT    NOT NULL,
  timestamp    TEXT    NOT NULL,
  token_symbol TEXT,
  value        TEXT,
  from_address TEXT,
  to_address   TEXT,
  tx_type      TEXT,
  usd_value    REAL,
  chain        TEXT    NOT NULL DEFAULT 'eth',
  hash         TEXT,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  duplicate_of TEXT
);

CREATE TABLE IF NOT EXISTS wallets (
  id         TEXT    PRIMARY KEY,
  tenant_id  TEXT    NOT NULL,
  address    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_classifications (
  id           TEXT    NOT NULL PRIMARY KEY,
  tenant_id    TEXT    NOT NULL,
  source_type  TEXT    NOT NULL,
  source_id    TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  sub_category TEXT,
  confidence   REAL,
  is_manual    INTEGER NOT NULL DEFAULT 0,
  linked_tx_id       TEXT,
  linked_source_type TEXT,
  notes        TEXT,
  tax_year     INTEGER,
  asset_symbol TEXT,
  amount_usd   REAL,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (tenant_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS tax_review_items (
  id            TEXT    NOT NULL PRIMARY KEY,
  tenant_id     TEXT    NOT NULL,
  source_type   TEXT    NOT NULL,
  source_id     TEXT    NOT NULL,
  reason        TEXT    NOT NULL,
  reason_detail TEXT,
  snapshot_json TEXT,
  resolved      INTEGER NOT NULL DEFAULT 0,
  resolved_at   TEXT,
  resolved_category TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (tenant_id, source_type, source_id, reason)
);

CREATE TABLE IF NOT EXISTS tax_lots (
  id             TEXT    NOT NULL PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  asset_symbol   TEXT    NOT NULL,
  acquired_at    TEXT    NOT NULL,
  quantity       REAL    NOT NULL,
  remaining_qty  REAL    NOT NULL,
  cost_basis_usd REAL,
  price_per_unit REAL,
  source_type    TEXT    NOT NULL,
  source_id      TEXT    NOT NULL,
  lot_type       TEXT    NOT NULL DEFAULT 'purchase',
  origin_lot_id  TEXT,
  is_exhausted   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS tax_disposals (
  id              TEXT    NOT NULL PRIMARY KEY,
  tenant_id       TEXT    NOT NULL,
  asset_symbol    TEXT    NOT NULL,
  disposed_at     TEXT    NOT NULL,
  quantity        REAL    NOT NULL,
  proceeds_usd    REAL,
  cost_basis_usd  REAL,
  gain_loss_usd   REAL,
  is_short_term   INTEGER NOT NULL DEFAULT 0,
  category        TEXT    NOT NULL,
  source_type     TEXT    NOT NULL,
  source_id       TEXT    NOT NULL,
  lot_id          TEXT    NOT NULL,
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS tax_pipeline_runs (
  id               TEXT    PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  started_at       TEXT    NOT NULL,
  completed_at     TEXT,
  status           TEXT    NOT NULL DEFAULT 'running',
  error_message    TEXT,
  pass1_easy       INTEGER,
  pass2_transfers  INTEGER,
  pass2b_loans     INTEGER,
  pass3_income     INTEGER,
  pass3_fees       INTEGER,
  pass4_lots       INTEGER,
  pass4_disposals  INTEGER,
  pass5_review     INTEGER,
  pass3b_defi      INTEGER,
  total_classified INTEGER,
  total_unknown    INTEGER
);
`;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'test-tenant-integration';

/** Insert a row into import_transactions. */
async function insertImport(overrides: {
  id?: string;
  timestamp_utc?: string;
  asset_symbol?: string;
  direction?: string;
  kind?: string;
  amount?: number;
  to_amount?: number | null;
  native_usd?: number | null;
  tx_hash?: string | null;
  source?: string;
  notes?: string | null;
  import_batch_id?: string;
  is_duplicate?: number;
}) {
  const id = overrides.id ?? randomUUID();
  await testDb.execute({
    sql: `INSERT INTO import_transactions
          (id, tenant_id, timestamp_utc, asset_symbol, direction, kind,
           amount, to_amount, native_usd, tx_hash, source, notes, import_batch_id, is_duplicate)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      TENANT,
      overrides.timestamp_utc    ?? '2024-06-01T12:00:00Z',
      overrides.asset_symbol     ?? 'BTC',
      overrides.direction        ?? 'in',
      overrides.kind             ?? 'buy',
      overrides.amount           ?? 1,
      overrides.to_amount        ?? null,
      overrides.native_usd       ?? null,
      overrides.tx_hash          ?? null,
      overrides.source           ?? 'coinbase',
      overrides.notes            ?? null,
      overrides.import_batch_id  ?? 'batch-A',
      overrides.is_duplicate     ?? 0,
    ],
  });
  return id;
}

/** Read all rows from a table for TENANT. */
async function readAll(table: string): Promise<Record<string, unknown>[]> {
  const res = await testDb.execute({
    sql: `SELECT * FROM ${table} WHERE tenant_id = ?`,
    args: [TENANT],
  });
  return res.rows as Record<string, unknown>[];
}

// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Apply schema
  for (const stmt of SCHEMA_DDL.split(';').map((s) => s.trim()).filter(Boolean)) {
    await testDb.execute(stmt);
  }
  // Clear any leftover data from previous runs
  const tables = [
    'import_transactions', 'transactions', 'wallets',
    'tax_classifications', 'tax_review_items',
    'tax_lots', 'tax_disposals', 'tax_pipeline_runs',
  ];
  for (const t of tables) {
    await testDb.execute({ sql: `DELETE FROM ${t} WHERE tenant_id = ?`, args: [TENANT] });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runDuplicateSweep — integration (real SQL)', () => {
  it('strategy 1: marks import row as duplicate when tx_hash matches an onchain row', async () => {
    const walletId = randomUUID();
    await testDb.execute({
      sql: `INSERT INTO wallets (id, tenant_id, address) VALUES (?,?,?)`,
      args: [walletId, TENANT, '0xdeadbeef'],
    });

    const hash = '0xabc123def456';
    const importId = await insertImport({
      id: `dedup-imp-${randomUUID()}`,
      tx_hash: hash,
      kind: 'buy',
      direction: 'in',
      amount: 2,
      native_usd: 50000,
      timestamp_utc: '2024-05-01T10:00:00Z',
    });

    // Insert matching onchain row with same hash
    const onchainId = randomUUID();
    await testDb.execute({
      sql: `INSERT INTO transactions (id, tenant_id, wallet_id, timestamp, token_symbol, value, tx_type, chain, hash)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [onchainId, TENANT, walletId, '2024-05-01T10:00:00Z', 'BTC', '2', 'transfer', 'btc', hash],
    });

    const stats = await runDuplicateSweep(TENANT);
    expect(stats.strategy1TxHash).toBeGreaterThanOrEqual(1);

    // Verify the import row is actually flagged in the DB
    const res = await testDb.execute({
      sql: `SELECT is_duplicate FROM import_transactions WHERE id = ?`,
      args: [importId],
    });
    expect(Number((res.rows[0] as Record<string, unknown>).is_duplicate)).toBe(1);
  });

  it('strategy 3: marks newer-batch import as duplicate when same source/symbol/amount/time within 30s', async () => {
    const idA = await insertImport({
      id: `s3-imp-A-${randomUUID()}`,
      source: 'crypto.com',
      asset_symbol: 'ETH',
      direction: 'in',
      kind: 'buy',
      amount: 5,
      native_usd: 10000,
      timestamp_utc: '2024-04-10T08:00:00Z',
      import_batch_id: 'batch-X',
    });
    const idB = await insertImport({
      id: `s3-imp-B-${randomUUID()}`,
      source: 'crypto.com',
      asset_symbol: 'ETH',
      direction: 'in',
      kind: 'buy',
      amount: 5,
      native_usd: 10000,
      timestamp_utc: '2024-04-10T08:00:10Z', // 10 seconds later — within 30s window
      import_batch_id: 'batch-Y',
    });

    const stats = await runDuplicateSweep(TENANT);
    expect(stats.strategy3WithinImport).toBeGreaterThanOrEqual(1);

    // One of the two must be flagged; the other must NOT be
    const resA = await testDb.execute({
      sql: `SELECT is_duplicate FROM import_transactions WHERE id = ?`, args: [idA],
    });
    const resB = await testDb.execute({
      sql: `SELECT is_duplicate FROM import_transactions WHERE id = ?`, args: [idB],
    });
    const dupA = Number((resA.rows[0] as Record<string, unknown>).is_duplicate);
    const dupB = Number((resB.rows[0] as Record<string, unknown>).is_duplicate);
    // Exactly one is marked
    expect(dupA + dupB).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runTaxPipeline — integration (real SQL + FIFO)', () => {
  // Shared pipeline run results — seeded once and read across all assertions
  let buyId: string;
  let sellId: string;
  let incomeId: string;
  let unknownId: string;

  beforeAll(async () => {
    // Clear all pipeline output tables so this describe block starts clean
    for (const t of ['import_transactions', 'tax_classifications', 'tax_review_items', 'tax_lots', 'tax_disposals', 'tax_pipeline_runs']) {
      await testDb.execute({ sql: `DELETE FROM ${t} WHERE tenant_id = ?`, args: [TENANT] });
    }

    // Seed: one BTC buy at $30,000, one BTC sell at $40,000 (8 months later → short-term)
    buyId = await insertImport({
      id: `pipeline-buy-${randomUUID()}`,
      timestamp_utc: '2024-01-15T10:00:00Z',
      asset_symbol: 'BTC',
      direction: 'in',
      kind: 'buy',
      amount: 1,
      native_usd: 30_000,
      source: 'coinbase',
    });

    sellId = await insertImport({
      id: `pipeline-sell-${randomUUID()}`,
      timestamp_utc: '2024-09-20T10:00:00Z',
      asset_symbol: 'BTC',
      direction: 'out',
      kind: 'sell',
      amount: 1,
      native_usd: 40_000,
      source: 'coinbase',
    });

    // Seed: ETH staking income — should be classified as 'income' by pass3
    incomeId = await insertImport({
      id: `pipeline-income-${randomUUID()}`,
      timestamp_utc: '2024-03-01T00:00:00Z',
      asset_symbol: 'ETH',
      direction: 'in',
      kind: 'staking rewards',  // keyword triggers pass3 income path
      amount: 0.1,
      native_usd: 350,
      source: 'coinbase',
    });

    // Seed: unknown transaction (triggers review queue via unknown_type).
    // Kind must NOT contain any of the keywords pass1 recognises (buy, sell,
    // swap, staking, interest, earn, send, receive, deposit, transfer, etc.)
    // — otherwise pass1 classifies it and it never hits the unknown_type path.
    unknownId = await insertImport({
      id: `pipeline-unknown-${randomUUID()}`,
      timestamp_utc: '2024-07-04T00:00:00Z',
      asset_symbol: 'DOGE',
      direction: 'in',
      kind: 'ZZZUNKNOWNKINDXXX',  // no keyword matches → stays unclassified → unknown_type
      amount: 1000,
      native_usd: null,
      source: 'coinbase',
    });

    await runTaxPipeline(TENANT);
  });

  // ── Classification ──────────────────────────────────────────────────────────

  it('classifies buy transaction as category=buy', async () => {
    const rows = await readAll('tax_classifications');
    const buyRow = rows.find((r) => r.source_id === buyId);
    expect(buyRow).toBeDefined();
    expect(buyRow!.category).toBe('buy');
    expect(buyRow!.source_type).toBe('import');
  });

  it('classifies sell transaction as category=sell', async () => {
    const rows = await readAll('tax_classifications');
    const sellRow = rows.find((r) => r.source_id === sellId);
    expect(sellRow).toBeDefined();
    expect(sellRow!.category).toBe('sell');
  });

  it('classifies staking rewards as category=income', async () => {
    const rows = await readAll('tax_classifications');
    const incomeRow = rows.find((r) => r.source_id === incomeId);
    expect(incomeRow).toBeDefined();
    expect(incomeRow!.category).toBe('income');
  });

  it('sets tax_year on each classification row', async () => {
    const rows = await readAll('tax_classifications');
    for (const row of rows) {
      if (row.source_id === buyId || row.source_id === sellId || row.source_id === incomeId) {
        expect(Number(row.tax_year)).toBe(2024);
      }
    }
  });

  // ── Tax lots ────────────────────────────────────────────────────────────────

  it('creates a tax lot for the buy transaction', async () => {
    const lots = await readAll('tax_lots');
    expect(lots.length).toBeGreaterThanOrEqual(1);
    const btcLot = lots.find((l) => l.source_id === buyId);
    expect(btcLot).toBeDefined();
    expect(btcLot!.asset_symbol).toBe('BTC');
    expect(Number(btcLot!.quantity)).toBeCloseTo(1, 8);
    expect(Number(btcLot!.cost_basis_usd)).toBeCloseTo(30_000, 2);
  });

  it('marks the lot as exhausted after the sell consumes it', async () => {
    const lots = await readAll('tax_lots');
    const btcLot = lots.find((l) => l.source_id === buyId);
    expect(btcLot).toBeDefined();
    expect(Number(btcLot!.is_exhausted)).toBe(1);
    expect(Number(btcLot!.remaining_qty)).toBeCloseTo(0, 8);
  });

  it('sets lot_type=purchase for the buy lot', async () => {
    const lots = await readAll('tax_lots');
    const btcLot = lots.find((l) => l.source_id === buyId);
    expect(btcLot!.lot_type).toBe('purchase');
  });

  // ── Tax disposals ───────────────────────────────────────────────────────────

  it('creates a disposal row for the sell transaction', async () => {
    const disposals = await readAll('tax_disposals');
    const disposal = disposals.find((d) => d.source_id === sellId);
    expect(disposal).toBeDefined();
  });

  it('calculates gain_loss_usd = proceeds - cost_basis = $10,000', async () => {
    const disposals = await readAll('tax_disposals');
    const disposal = disposals.find((d) => d.source_id === sellId);
    expect(Number(disposal!.proceeds_usd)).toBeCloseTo(40_000, 2);
    expect(Number(disposal!.cost_basis_usd)).toBeCloseTo(30_000, 2);
    expect(Number(disposal!.gain_loss_usd)).toBeCloseTo(10_000, 2);
  });

  it('marks the disposal as short-term (held < 12 calendar months)', async () => {
    // Bought Jan 15 2024, sold Sep 20 2024 — clearly short-term
    const disposals = await readAll('tax_disposals');
    const disposal = disposals.find((d) => d.source_id === sellId);
    expect(Number(disposal!.is_short_term)).toBe(1);
  });

  it('sets disposal category=sell', async () => {
    const disposals = await readAll('tax_disposals');
    const disposal = disposals.find((d) => d.source_id === sellId);
    expect(disposal!.category).toBe('sell');
  });

  it('links the disposal to the correct lot via lot_id', async () => {
    const lots = await readAll('tax_lots');
    const disposals = await readAll('tax_disposals');
    const btcLot = lots.find((l) => l.source_id === buyId);
    const disposal = disposals.find((d) => d.source_id === sellId);
    expect(disposal!.lot_id).toBe(btcLot!.id);
  });

  // ── Long-term boundary ──────────────────────────────────────────────────────

  it('marks a disposal as long-term when held > 12 calendar months', async () => {
    const ltBuyId = await insertImport({
      id: `lt-buy-${randomUUID()}`,
      timestamp_utc: '2023-01-15T10:00:00Z',
      asset_symbol: 'ETH',
      direction: 'in',
      kind: 'buy',
      amount: 2,
      native_usd: 4_000,
      source: 'coinbase',
    });
    const ltSellId = await insertImport({
      id: `lt-sell-${randomUUID()}`,
      timestamp_utc: '2024-01-16T10:00:00Z', // 1 day past 12-month mark → long-term
      asset_symbol: 'ETH',
      direction: 'out',
      kind: 'sell',
      amount: 2,
      native_usd: 6_000,
      source: 'coinbase',
    });
    await runTaxPipeline(TENANT);

    const disposals = await readAll('tax_disposals');
    const ltDisposal = disposals.find((d) => d.source_id === ltSellId);
    expect(ltDisposal).toBeDefined();
    expect(Number(ltDisposal!.is_short_term)).toBe(0); // long-term
    expect(Number(ltDisposal!.gain_loss_usd)).toBeCloseTo(2_000, 2); // 6000 - 4000

    // Cleanup: remove the extra import rows AND regenerate pipeline output so
    // subsequent tests (idempotency) see a consistent baseline.
    await testDb.execute({ sql: `DELETE FROM import_transactions WHERE id IN (?,?)`, args: [ltBuyId, ltSellId] });
    await runTaxPipeline(TENANT);
  });

  // ── Pipeline run log ────────────────────────────────────────────────────────

  it('writes a tax_pipeline_runs row with status=success', async () => {
    const runs = await readAll('tax_pipeline_runs');
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const lastRun = runs.sort((a, b) =>
      String(b.started_at).localeCompare(String(a.started_at)),
    )[0];
    expect(lastRun.status).toBe('success');
    expect(lastRun.completed_at).not.toBeNull();
    expect(lastRun.error_message).toBeNull();
  });

  it('records non-null total_classified in the run log', async () => {
    const runs = await readAll('tax_pipeline_runs');
    const lastRun = runs.sort((a, b) =>
      String(b.started_at).localeCompare(String(a.started_at)),
    )[0];
    expect(Number(lastRun.total_classified)).toBeGreaterThan(0);
  });

  it('records pass4_lots and pass4_disposals counts', async () => {
    const runs = await readAll('tax_pipeline_runs');
    const lastRun = runs.sort((a, b) =>
      String(b.started_at).localeCompare(String(a.started_at)),
    )[0];
    expect(Number(lastRun.pass4_lots)).toBeGreaterThanOrEqual(1);
    expect(Number(lastRun.pass4_disposals)).toBeGreaterThanOrEqual(1);
  });

  // ── Review queue ────────────────────────────────────────────────────────────

  it('creates a review item for the unpriced unknown transaction', async () => {
    const items = await readAll('tax_review_items');
    const unknownItem = items.find((i) => i.source_id === unknownId);
    expect(unknownItem).toBeDefined();
  });

  // ── Pipeline idempotency ────────────────────────────────────────────────────

  it('produces identical results on a second pipeline run (idempotent)', async () => {
    const lotsBefore = await readAll('tax_lots');
    const disposalsBefore = await readAll('tax_disposals');

    await runTaxPipeline(TENANT);

    const lotsAfter = await readAll('tax_lots');
    const disposalsAfter = await readAll('tax_disposals');

    // Same count of lots and disposals
    expect(lotsAfter.length).toBe(lotsBefore.length);
    expect(disposalsAfter.length).toBe(disposalsBefore.length);

    // Net gain is stable across reruns
    const gainBefore = disposalsBefore.reduce((s, d) => s + Number(d.gain_loss_usd ?? 0), 0);
    const gainAfter  = disposalsAfter.reduce((s, d) => s + Number(d.gain_loss_usd ?? 0), 0);
    expect(gainAfter).toBeCloseTo(gainBefore, 2);
  });

  // ── Schema column names ─────────────────────────────────────────────────────
  // Explicit column-name assertions — if a migration renames a column these
  // will fail loudly instead of silently corrupting calculations.

  it('tax_lots has expected columns: acquired_at, remaining_qty, cost_basis_usd, is_exhausted', async () => {
    const lots = await readAll('tax_lots');
    const lot = lots[0];
    expect(lot).toHaveProperty('acquired_at');
    expect(lot).toHaveProperty('remaining_qty');
    expect(lot).toHaveProperty('cost_basis_usd');
    expect(lot).toHaveProperty('is_exhausted');
    expect(lot).toHaveProperty('lot_type');
    expect(lot).toHaveProperty('source_type');
    expect(lot).toHaveProperty('source_id');
  });

  it('tax_disposals has expected columns: disposed_at, gain_loss_usd, is_short_term, lot_id', async () => {
    const disposals = await readAll('tax_disposals');
    const d = disposals[0];
    expect(d).toHaveProperty('disposed_at');
    expect(d).toHaveProperty('gain_loss_usd');
    expect(d).toHaveProperty('is_short_term');
    expect(d).toHaveProperty('lot_id');
    expect(d).toHaveProperty('proceeds_usd');
    expect(d).toHaveProperty('cost_basis_usd');
  });

  it('tax_classifications has expected columns: category, tax_year, amount_usd, is_manual', async () => {
    const rows = await readAll('tax_classifications');
    const row = rows[0];
    expect(row).toHaveProperty('category');
    expect(row).toHaveProperty('tax_year');
    expect(row).toHaveProperty('amount_usd');
    expect(row).toHaveProperty('is_manual');
    expect(row).toHaveProperty('source_type');
    expect(row).toHaveProperty('source_id');
    expect(row).toHaveProperty('confidence');
  });

  it('tax_pipeline_runs has expected columns: pass3_fees, pass3b_defi', async () => {
    // This catches the column rename from pass3b_fees → pass3_fees and
    // pass3c_defi → pass3b_defi that was done in a previous session.
    const runs = await readAll('tax_pipeline_runs');
    const run = runs[0];
    expect(run).toHaveProperty('pass3_fees');
    expect(run).toHaveProperty('pass3b_defi');
    expect(run).toHaveProperty('pass4_lots');
    expect(run).toHaveProperty('pass4_disposals');
    expect(run).toHaveProperty('total_classified');
    expect(run).toHaveProperty('total_unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runTaxPipeline — failure path (real SQL)', () => {
  // Tests that markRunFailed() is called and the run log shows status='failed'
  // when the pipeline encounters a DB error mid-run.
  //
  // Strategy: drop tax_disposals (which the pipeline writes to at batch time),
  // run the pipeline, assert the run log shows 'failed'.  Recreate the table
  // afterwards so subsequent tests continue to work.

  it('writes status=failed and error_message when a DB write fails', async () => {
    // Drop the table the pipeline batch-writes to — this will cause db.batch()
    // to fail with "no such table: tax_disposals".
    await testDb.execute('DROP TABLE IF EXISTS tax_disposals');

    // runTaxPipeline re-throws after markRunFailed() so callers know it failed.
    // We expect the throw here — what we're verifying is the DB state it leaves.
    await runTaxPipeline(TENANT).catch(() => { /* expected */ });

    // The run should be recorded as failed.
    // Query specifically for failed rows — don't use ORDER BY started_at DESC
    // because started_at has only second precision, making tie-breaking
    // non-deterministic when multiple runs complete within the same second.
    const failedRuns = (await testDb.execute({
      sql: `SELECT error_message FROM tax_pipeline_runs WHERE tenant_id = ? AND status = 'failed'`,
      args: [TENANT],
    })).rows as Record<string, unknown>[];

    expect(failedRuns.length).toBeGreaterThan(0);
    expect(failedRuns[0].error_message).not.toBeNull();
    expect(String(failedRuns[0].error_message).length).toBeGreaterThan(0);

    // Restore the table so nothing downstream breaks
    await testDb.execute(`
      CREATE TABLE IF NOT EXISTS tax_disposals (
        id              TEXT    NOT NULL PRIMARY KEY,
        tenant_id       TEXT    NOT NULL,
        asset_symbol    TEXT    NOT NULL,
        disposed_at     TEXT    NOT NULL,
        quantity        REAL    NOT NULL,
        proceeds_usd    REAL,
        cost_basis_usd  REAL,
        gain_loss_usd   REAL,
        is_short_term   INTEGER NOT NULL DEFAULT 0,
        category        TEXT    NOT NULL,
        source_type     TEXT    NOT NULL,
        source_id       TEXT    NOT NULL,
        lot_id          TEXT    NOT NULL,
        notes           TEXT,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      )
    `);
  });

  it('run log status never gets stuck at running after a failure', async () => {
    // Confirm there is no row with status='running' left over — markRunFailed
    // must update the row even when the pipeline throws.
    const stuck = (await testDb.execute({
      sql: `SELECT id FROM tax_pipeline_runs WHERE tenant_id = ? AND status = 'running'`,
      args: [TENANT],
    })).rows;
    expect(stuck.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('runDuplicateSweep — strategy 2: cross-table integration (real SQL)', () => {
  // Strategy 2 joins import_transactions against transactions by symbol + qty
  // within a 5-minute window. Unit tests mock db.execute; this test runs the
  // actual SQL against a real in-memory DB to verify the query is correct.

  const S2_TENANT = 'strategy2-tenant';

  beforeAll(async () => {
    // Clear any leftover data for this tenant
    for (const t of ['import_transactions', 'transactions', 'wallets']) {
      await testDb.execute({ sql: `DELETE FROM ${t} WHERE tenant_id = ?`, args: [S2_TENANT] });
    }

    // Insert a wallet so the transactions table FK is satisfied
    const walletId = randomUUID();
    await testDb.execute({
      sql: `INSERT INTO wallets (id, tenant_id, address) VALUES (?,?,?)`,
      args: [walletId, S2_TENANT, '0xcafe'],
    });

    // Import row: 3.5 ETH at 12:00:00
    await testDb.execute({
      sql: `INSERT INTO import_transactions
            (id, tenant_id, timestamp_utc, asset_symbol, direction, kind,
             amount, native_usd, source, import_batch_id, is_duplicate)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        's2-imp-1', S2_TENANT, '2024-08-10T12:00:00Z',
        'ETH', 'in', 'buy', 3.5, 10500, 'coinbase', 'batch-S2', 0,
      ],
    });

    // Onchain row: 3.5 ETH at 12:03:00 (within 5-minute window, same amount)
    await testDb.execute({
      sql: `INSERT INTO transactions
            (id, tenant_id, wallet_id, timestamp, token_symbol, value,
             tx_type, chain, is_duplicate)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [
        's2-onc-1', S2_TENANT, walletId,
        '2024-08-10T12:03:00Z', 'ETH', '3.5',
        'transfer', 'eth', 0,
      ],
    });
  });

  it('strategy 2 matches import and onchain rows by symbol + amount + time window', async () => {
    const stats = await runDuplicateSweep(S2_TENANT);
    expect(stats.strategy2CrossTable).toBe(1);
    expect(stats.totalMarked).toBeGreaterThanOrEqual(1);
  });

  it('strategy 2 flags the import row as is_duplicate=1 in the DB', async () => {
    await runDuplicateSweep(S2_TENANT);
    const res = await testDb.execute({
      sql: `SELECT is_duplicate FROM import_transactions WHERE id = 's2-imp-1'`,
      args: [],
    });
    expect(Number((res.rows[0] as Record<string, unknown>).is_duplicate)).toBe(1);
  });

  it('strategy 2 does NOT match when amounts differ by more than 1%', async () => {
    const S2b = 'strategy2b-tenant';
    const wId = randomUUID();
    await testDb.execute({ sql: `INSERT INTO wallets (id, tenant_id, address) VALUES (?,?,?)`, args: [wId, S2b, '0xbabe'] });

    // Import: 1.0 ETH
    await testDb.execute({
      sql: `INSERT INTO import_transactions (id, tenant_id, timestamp_utc, asset_symbol, direction, kind, amount, source, import_batch_id, is_duplicate) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [`s2b-imp`, S2b, '2024-08-11T10:00:00Z', 'ETH', 'in', 'buy', 1.0, 'coinbase', 'batch-S2b', 0],
    });
    // Onchain: 1.03 ETH (3% diff — outside 1% tolerance)
    await testDb.execute({
      sql: `INSERT INTO transactions (id, tenant_id, wallet_id, timestamp, token_symbol, value, tx_type, chain, is_duplicate) VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [`s2b-onc`, S2b, wId, '2024-08-11T10:01:00Z', 'ETH', '1.03', 'transfer', 'eth', 0],
    });

    const stats = await runDuplicateSweep(S2b);
    expect(stats.strategy2CrossTable).toBe(0);
  });

  it('strategy 2 does NOT match when timestamps are more than 5 minutes apart', async () => {
    const S2c = 'strategy2c-tenant';
    const wId = randomUUID();
    await testDb.execute({ sql: `INSERT INTO wallets (id, tenant_id, address) VALUES (?,?,?)`, args: [wId, S2c, '0xface'] });

    await testDb.execute({
      sql: `INSERT INTO import_transactions (id, tenant_id, timestamp_utc, asset_symbol, direction, kind, amount, source, import_batch_id, is_duplicate) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [`s2c-imp`, S2c, '2024-08-12T10:00:00Z', 'BTC', 'in', 'buy', 0.5, 'coinbase', 'batch-S2c', 0],
    });
    // 6 minutes apart — outside the 5-minute window
    await testDb.execute({
      sql: `INSERT INTO transactions (id, tenant_id, wallet_id, timestamp, token_symbol, value, tx_type, chain, is_duplicate) VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [`s2c-onc`, S2c, wId, '2024-08-12T10:06:00Z', 'BTC', '0.5', 'transfer', 'eth', 0],
    });

    const stats = await runDuplicateSweep(S2c);
    expect(stats.strategy2CrossTable).toBe(0);
  });
});
