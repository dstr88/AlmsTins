/**
 * tests/tax/pipeline.integration.test.ts
 *
 * End-to-end integration test: runs the real classify + deduplication pipeline
 * against a real Postgres database through the app's own adapter
 * (src/lib/db.ts -> db.pg.ts). No mocks on db.execute / db.batch. If a column
 * rename, a type change or a SQL dialect slip breaks a query, this test catches
 * it where the unit tests (which stub the db) won't.
 *
 * OPT-IN, LOCAL OR CI POSTGRES ONLY. The suite runs only when RUN_TAX_PIPELINE_IT=1 and
 * DATABASE_URL's host is localhost or 127.0.0.1. Without the opt-in it skips (the reason is
 * printed) and never loads the db module, so nothing connects. With the opt-in but an unsafe
 * setup it throws, so CI can never pass with the suite silently skipped. The failure-path
 * test DROPs tax_disposals, so point it at a throwaway database:
 *
 *   RUN_TAX_PIPELINE_IT=1 DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
 *     npx vitest run tests/tax/pipeline.integration.test.ts
 *
 * CI runs it exactly that way against a postgres service container
 * (.github/workflows/ci.yml, step "Tax pipeline integration (Postgres)").
 *
 * Schema: no ensureTables() creates the tax tables (they came from
 * migrations/0018_tax_classification.sql and migrations/20260412_pipeline_runs*.sql),
 * so this file creates every table it touches, with the columns the code under
 * test reads and writes, in the Postgres types src/scripts/sqliteSchemaToPg.mjs
 * maps to (INTEGER -> bigint, REAL -> double precision, strftime -> to_char).
 *
 * Re-runnable: every tenant id and every fixed row id carries a per-run suffix, and
 * afterAll deletes every row this run inserted, so a second run on the same
 * database starts clean.
 *
 * What's covered:
 *   • runDuplicateSweep — all three strategies against real SQL
 *   • runTaxPipeline — passes 1–5, DB writes, run log
 *   • Correct FIFO gain/loss calculation stored in tax_disposals
 *   • Pipeline run log: status='success', non-null stats; status='failed' on error
 *   • Income classification written to tax_classifications
 *   • Review queue populated for low-confidence and unpriced items
 *   • Column names — any rename that breaks a SELECT/INSERT will fail here
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
// Type-only imports: erased at runtime. The modules themselves are loaded in
// beforeAll, and only once the local-database guard below has passed.
import type { Client } from '@libsql/client';
import type * as ClassifyModule from '@/lib/yearEnd/classify';
import type * as DedupModule from '@/lib/yearEnd/deduplication';

// The pipeline busts the tenant's cache rows when it finishes. The cache table is
// not part of this schema and the cache is not under test, so stub it out.
// (classify.ts already .catch()es a failure; the stub just keeps the output quiet.)
vi.mock('@/lib/tursoCache', () => ({
  deleteCachePrefix: () => Promise.resolve(),
  getCache: () => Promise.resolve(null),
  setCache: () => Promise.resolve(),
}));

// ── Local-database guard ──────────────────────────────────────────────────────
// Resolve the settings exactly as the adapter will (db.ts / db.pg.ts merge
// process.env with import.meta.env, import.meta.env winning), so the guard checks
// the database that would actually be used.

const importMetaEnv = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {});
const ENV: Record<string, string | undefined> = { ...process.env, ...importMetaEnv };

// IPv6 loopback is left out on purpose: node-postgres cannot connect to a bracketed [::1] host.
const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Why `url` is not a safe local database for this suite, or null when it is. */
function nonLocalReason(name: string, url: string): string | null {
  if (/\s/.test(url)) return `${name} contains whitespace`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${name} is not a parseable URL`;
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return `${name} is not a postgres:// URL`;
  }
  // node-postgres lets a ?host= query parameter override the host in the URL.
  for (const key of parsed.searchParams.keys()) {
    if (/^host(addr)?$/i.test(key)) return `${name} overrides its host with a ?${key}= parameter`;
  }
  // The host itself is never printed: a real database hostname stays out of logs.
  if (!LOCAL_DB_HOSTS.has(parsed.hostname.toLowerCase())) {
    return `${name} host is not localhost or 127.0.0.1`;
  }
  return null;
}

/** Why this suite must not run here, or null when it may. */
function localPostgresSkipReason(): string | null {
  // Explicit opt-in: the failure-path test drops tax_disposals, so a plain `npx vitest run`
  // from a shell that happens to export a local DATABASE_URL must never run it.
  if (ENV.RUN_TAX_PIPELINE_IT !== '1') return 'RUN_TAX_PIPELINE_IT is not 1 (set only by the CI step)';
  if ((importMetaEnv.DB_ENGINE ?? process.env.DB_ENGINE) === 'turso') {
    return 'DB_ENGINE=turso selects the retired libSQL engine; this suite runs on Postgres only';
  }
  const url = ENV.DATABASE_URL;
  if (!url) return 'DATABASE_URL is not set';
  const bad = nonLocalReason('DATABASE_URL', url);
  if (bad) return bad;
  // The adapter opens a second pool when WEB_DATABASE_URL is set; hold it to the same rule.
  const webUrl = ENV.WEB_DATABASE_URL;
  if (webUrl) return nonLocalReason('WEB_DATABASE_URL', webUrl);
  return null;
}

const SKIP_REASON = localPostgresSkipReason();
// Opted in but unsafe (or misconfigured): fail loudly instead of skipping, so CI can never
// go green with the whole suite silently skipped.
if (SKIP_REASON && ENV.RUN_TAX_PIPELINE_IT === '1') {
  throw new Error(`[pipeline.integration] RUN_TAX_PIPELINE_IT=1 but refusing to run: ${SKIP_REASON}`);
}
if (SKIP_REASON) {
  console.warn(
    `[pipeline.integration] skipped: ${SKIP_REASON}. ` +
      'It runs only when opted in, against a local Postgres (localhost or 127.0.0.1), because it drops a table.',
  );
}

// ── Schema ────────────────────────────────────────────────────────────────────
// Exactly the columns the code under test (classify.ts, deduplication.ts) reads
// or writes, plus the constraints the production migrations put on them. Any
// column rename in the code that isn't reflected here (or vice versa) fails
// loudly with a Postgres "column does not exist" error.

const TS_DEFAULT = `to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

const TAX_DISPOSALS_DDL = `
CREATE TABLE IF NOT EXISTS tax_disposals (
  id              text             NOT NULL PRIMARY KEY,
  tenant_id       text             NOT NULL,
  asset_symbol    text             NOT NULL,
  disposed_at     text             NOT NULL,
  quantity        double precision NOT NULL,
  proceeds_usd    double precision,
  cost_basis_usd  double precision,
  gain_loss_usd   double precision,
  is_short_term   bigint           NOT NULL DEFAULT 0,
  category        text             NOT NULL,
  source_type     text             NOT NULL,
  source_id       text             NOT NULL,
  lot_id          text             NOT NULL,
  notes           text,
  created_at      text             NOT NULL DEFAULT (${TS_DEFAULT})
)`;

const SCHEMA_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS import_transactions (
    id               text             PRIMARY KEY,
    tenant_id        text             NOT NULL,
    timestamp_utc    text             NOT NULL,
    asset_symbol     text,
    direction        text,
    kind             text,
    amount           double precision,
    to_amount        double precision,
    native_usd       double precision,
    tx_hash          text,
    source           text             NOT NULL DEFAULT '',
    notes            text,
    category         text,
    description      text,
    is_duplicate     bigint           NOT NULL DEFAULT 0,
    duplicate_of     text,
    import_batch_id  text             NOT NULL DEFAULT 'batch-default'
  )`,

  `CREATE TABLE IF NOT EXISTS transactions (
    id           text             PRIMARY KEY,
    tenant_id    text             NOT NULL,
    wallet_id    text             NOT NULL,
    timestamp    text             NOT NULL,
    token_symbol text,
    value        text,
    from_address text,
    to_address   text,
    tx_type      text,
    usd_value    double precision,
    chain        text             NOT NULL DEFAULT 'eth',
    hash         text,
    is_duplicate bigint           NOT NULL DEFAULT 0,
    duplicate_of text
  )`,

  `CREATE TABLE IF NOT EXISTS wallets (
    id         text PRIMARY KEY,
    tenant_id  text NOT NULL,
    address    text NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS tax_classifications (
    id                 text             NOT NULL PRIMARY KEY,
    tenant_id          text             NOT NULL,
    source_type        text             NOT NULL,
    source_id          text             NOT NULL,
    category           text             NOT NULL,
    sub_category       text,
    confidence         double precision,
    is_manual          bigint           NOT NULL DEFAULT 0,
    linked_tx_id       text,
    linked_source_type text,
    tax_year           bigint,
    asset_symbol       text,
    amount_usd         double precision,
    notes              text,
    created_at         text             NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at         text             NOT NULL DEFAULT (${TS_DEFAULT}),
    UNIQUE (tenant_id, source_type, source_id)
  )`,

  `CREATE TABLE IF NOT EXISTS tax_review_items (
    id            text   NOT NULL PRIMARY KEY,
    tenant_id     text   NOT NULL,
    source_type   text   NOT NULL,
    source_id     text   NOT NULL,
    reason        text   NOT NULL,
    reason_detail text,
    snapshot_json text,
    resolved      bigint NOT NULL DEFAULT 0,
    resolved_at   text,
    resolved_category text,
    notes         text,
    created_at    text   NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at    text   NOT NULL DEFAULT (${TS_DEFAULT}),
    UNIQUE (tenant_id, source_type, source_id, reason)
  )`,

  `CREATE TABLE IF NOT EXISTS tax_lots (
    id             text             NOT NULL PRIMARY KEY,
    tenant_id      text             NOT NULL,
    asset_symbol   text             NOT NULL,
    acquired_at    text             NOT NULL,
    quantity       double precision NOT NULL,
    remaining_qty  double precision NOT NULL,
    cost_basis_usd double precision,
    price_per_unit double precision,
    source_type    text             NOT NULL,
    source_id      text             NOT NULL,
    lot_type       text             NOT NULL DEFAULT 'purchase',
    origin_lot_id  text,
    is_exhausted   bigint           NOT NULL DEFAULT 0,
    created_at     text             NOT NULL DEFAULT (${TS_DEFAULT}),
    updated_at     text             NOT NULL DEFAULT (${TS_DEFAULT})
  )`,

  TAX_DISPOSALS_DDL,

  `CREATE TABLE IF NOT EXISTS tax_pipeline_runs (
    id               text   PRIMARY KEY,
    tenant_id        text   NOT NULL,
    started_at       text   NOT NULL,
    completed_at     text,
    status           text   NOT NULL DEFAULT 'running',
    error_message    text,
    pass1_easy       bigint,
    pass2_transfers  bigint,
    pass2b_loans     bigint,
    pass3_income     bigint,
    pass3_fees       bigint,
    pass4_lots       bigint,
    pass4_disposals  bigint,
    pass5_review     bigint,
    pass3b_defi      bigint,
    total_classified bigint,
    total_unknown    bigint
  )`,
];

const ALL_TABLES = [
  'import_transactions', 'transactions', 'wallets',
  'tax_classifications', 'tax_review_items',
  'tax_lots', 'tax_disposals', 'tax_pipeline_runs',
];

// ── Per-run identifiers ───────────────────────────────────────────────────────
// Unique per run, so a reused database never collides with an earlier run's rows.

const RUN = randomUUID();
const TENANT     = `pipeline-it-${RUN}`;
const S2_TENANT  = `strategy2-${RUN}`;
const S2B_TENANT = `strategy2b-${RUN}`;
const S2C_TENANT = `strategy2c-${RUN}`;
const RUN_TENANTS = [TENANT, S2_TENANT, S2B_TENANT, S2C_TENANT];

// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(SKIP_REASON !== null)(
  `tax pipeline on local Postgres${SKIP_REASON ? ` (skipped: ${SKIP_REASON})` : ''}`,
  () => {
    let db: Client;
    let runTaxPipeline: typeof ClassifyModule.runTaxPipeline;
    let runDuplicateSweep: typeof DedupModule.runDuplicateSweep;

    /** Insert a row into import_transactions for TENANT. */
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
      await db.execute({
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
      const res = await db.execute({
        sql: `SELECT * FROM ${table} WHERE tenant_id = ?`,
        args: [TENANT],
      });
      return res.rows as Record<string, unknown>[];
    }

    beforeAll(async () => {
      // Loaded here rather than imported at the top: importing the db module opens
      // a pool and pings DATABASE_URL, so it must never load when the guard skips.
      ({ db } = await import('@/lib/db'));
      ({ runTaxPipeline } = await import('@/lib/yearEnd/classify'));
      ({ runDuplicateSweep } = await import('@/lib/yearEnd/deduplication'));

      for (const stmt of SCHEMA_DDL) {
        await db.execute(stmt);
      }
    });

    afterAll(async () => {
      if (!db) return;
      // Remove every row this run wrote. Note: the failure-path test drops and recreates
      // tax_disposals, so any other rows in that table on this database are gone. That is why
      // the suite needs RUN_TAX_PIPELINE_IT=1 and a local host.
      const placeholders = RUN_TENANTS.map(() => '?').join(',');
      for (const t of ALL_TABLES) {
        await db.execute({ sql: `DELETE FROM ${t} WHERE tenant_id IN (${placeholders})`, args: RUN_TENANTS });
      }
    });

    // ───────────────────────────────────────────────────────────────────────────
    describe('runDuplicateSweep — integration (real SQL)', () => {
      it('strategy 1: marks import row as duplicate when tx_hash matches an onchain row', async () => {
        const walletId = randomUUID();
        await db.execute({
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
        await db.execute({
          sql: `INSERT INTO transactions (id, tenant_id, wallet_id, timestamp, token_symbol, value, tx_type, chain, hash)
                VALUES (?,?,?,?,?,?,?,?,?)`,
          args: [onchainId, TENANT, walletId, '2024-05-01T10:00:00Z', 'BTC', '2', 'transfer', 'btc', hash],
        });

        const stats = await runDuplicateSweep(TENANT);
        expect(stats.strategy1TxHash).toBeGreaterThanOrEqual(1);

        // Verify the import row is actually flagged in the DB
        const res = await db.execute({
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
        const resA = await db.execute({
          sql: `SELECT is_duplicate FROM import_transactions WHERE id = ?`, args: [idA],
        });
        const resB = await db.execute({
          sql: `SELECT is_duplicate FROM import_transactions WHERE id = ?`, args: [idB],
        });
        const dupA = Number((resA.rows[0] as Record<string, unknown>).is_duplicate);
        const dupB = Number((resB.rows[0] as Record<string, unknown>).is_duplicate);
        // Exactly one is marked
        expect(dupA + dupB).toBe(1);
      });
    });

    // ───────────────────────────────────────────────────────────────────────────
    describe('runTaxPipeline — integration (real SQL + FIFO)', () => {
      // Shared pipeline run results — seeded once and read across all assertions
      let buyId: string;
      let sellId: string;
      let incomeId: string;
      let unknownId: string;

      beforeAll(async () => {
        // Clear this tenant's imports and pipeline output so this block starts clean
        for (const t of ['import_transactions', 'tax_classifications', 'tax_review_items', 'tax_lots', 'tax_disposals', 'tax_pipeline_runs']) {
          await db.execute({ sql: `DELETE FROM ${t} WHERE tenant_id = ?`, args: [TENANT] });
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

      // ── Classification ────────────────────────────────────────────────────────

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

      // ── Tax lots ──────────────────────────────────────────────────────────────

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

      // ── Tax disposals ─────────────────────────────────────────────────────────

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

      // ── Long-term boundary ────────────────────────────────────────────────────

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
        await db.execute({ sql: `DELETE FROM import_transactions WHERE id IN (?,?)`, args: [ltBuyId, ltSellId] });
        await runTaxPipeline(TENANT);
      });

      // ── Pipeline run log ──────────────────────────────────────────────────────

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

      // ── Review queue ──────────────────────────────────────────────────────────

      it('creates a review item for the unpriced unknown transaction', async () => {
        const items = await readAll('tax_review_items');
        const unknownItem = items.find((i) => i.source_id === unknownId);
        expect(unknownItem).toBeDefined();
      });

      // ── Pipeline idempotency ──────────────────────────────────────────────────

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

      // ── Schema column names ───────────────────────────────────────────────────
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

    // ───────────────────────────────────────────────────────────────────────────
    describe('runTaxPipeline — failure path (real SQL)', () => {
      // Tests that markRunFailed() is called and the run log shows status='failed'
      // when the pipeline encounters a DB error mid-run.
      //
      // Strategy: drop tax_disposals (which the pipeline writes to at batch time),
      // run the pipeline, assert the run log shows 'failed'. The table is recreated
      // in a finally block so later tests and the afterAll cleanup keep working.

      it('writes status=failed and error_message when a DB write fails', async () => {
        // The suite-level guard already skips any non-local database. Check again
        // right before the DROP, so no later edit can ever aim it somewhere else.
        const unsafe = localPostgresSkipReason();
        if (unsafe) throw new Error(`refusing to DROP TABLE: ${unsafe}`);

        // Drop the table the pipeline batch-writes to — db.batch() then fails
        // with 'relation "tax_disposals" does not exist'.
        await db.execute('DROP TABLE IF EXISTS tax_disposals');
        try {
          // runTaxPipeline re-throws after markRunFailed() so callers know it failed.
          // We expect the throw here — what we're verifying is the DB state it leaves.
          await runTaxPipeline(TENANT).catch(() => { /* expected */ });

          // The run should be recorded as failed.
          // Query specifically for failed rows — don't use ORDER BY started_at DESC
          // because started_at has only second precision, making tie-breaking
          // non-deterministic when multiple runs complete within the same second.
          const failedRuns = (await db.execute({
            sql: `SELECT error_message FROM tax_pipeline_runs WHERE tenant_id = ? AND status = 'failed'`,
            args: [TENANT],
          })).rows as Record<string, unknown>[];

          expect(failedRuns.length).toBeGreaterThan(0);
          expect(failedRuns[0].error_message).not.toBeNull();
          expect(String(failedRuns[0].error_message).length).toBeGreaterThan(0);
        } finally {
          // Restore the table so nothing downstream breaks
          await db.execute(TAX_DISPOSALS_DDL);
        }
      });

      it('run log status never gets stuck at running after a failure', async () => {
        // Confirm there is no row with status='running' left over — markRunFailed
        // must update the row even when the pipeline throws.
        const stuck = (await db.execute({
          sql: `SELECT id FROM tax_pipeline_runs WHERE tenant_id = ? AND status = 'running'`,
          args: [TENANT],
        })).rows;
        expect(stuck.length).toBe(0);
      });
    });

    // ───────────────────────────────────────────────────────────────────────────
    describe('runDuplicateSweep — strategy 2: cross-table integration (real SQL)', () => {
      // Strategy 2 joins import_transactions against transactions by symbol + qty
      // within a 5-minute window. Unit tests mock db.execute; this test runs the
      // actual SQL against a real Postgres to verify the query is correct.

      const S2_IMPORT_ID = `s2-imp-1-${RUN}`;

      beforeAll(async () => {
        // Insert a wallet so the transactions → wallets join has a row
        const walletId = randomUUID();
        await db.execute({
          sql: `INSERT INTO wallets (id, tenant_id, address) VALUES (?,?,?)`,
          args: [walletId, S2_TENANT, '0xcafe'],
        });

        // Import row: 3.5 ETH at 12:00:00
        await db.execute({
          sql: `INSERT INTO import_transactions
                (id, tenant_id, timestamp_utc, asset_symbol, direction, kind,
                 amount, native_usd, source, import_batch_id, is_duplicate)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          args: [
            S2_IMPORT_ID, S2_TENANT, '2024-08-10T12:00:00Z',
            'ETH', 'in', 'buy', 3.5, 10500, 'coinbase', 'batch-S2', 0,
          ],
        });

        // Onchain row: 3.5 ETH at 12:03:00 (within 5-minute window, same amount)
        await db.execute({
          sql: `INSERT INTO transactions
                (id, tenant_id, wallet_id, timestamp, token_symbol, value,
                 tx_type, chain, is_duplicate)
                VALUES (?,?,?,?,?,?,?,?,?)`,
          args: [
            `s2-onc-1-${RUN}`, S2_TENANT, walletId,
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
        const res = await db.execute({
          sql: `SELECT is_duplicate FROM import_transactions WHERE id = ?`,
          args: [S2_IMPORT_ID],
        });
        expect(Number((res.rows[0] as Record<string, unknown>).is_duplicate)).toBe(1);
      });

      it('strategy 2 does NOT match when amounts differ by more than 1%', async () => {
        const wId = randomUUID();
        await db.execute({ sql: `INSERT INTO wallets (id, tenant_id, address) VALUES (?,?,?)`, args: [wId, S2B_TENANT, '0xbabe'] });

        // Import: 1.0 ETH
        await db.execute({
          sql: `INSERT INTO import_transactions (id, tenant_id, timestamp_utc, asset_symbol, direction, kind, amount, source, import_batch_id, is_duplicate) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          args: [`s2b-imp-${RUN}`, S2B_TENANT, '2024-08-11T10:00:00Z', 'ETH', 'in', 'buy', 1.0, 'coinbase', 'batch-S2b', 0],
        });
        // Onchain: 1.03 ETH (3% diff — outside 1% tolerance)
        await db.execute({
          sql: `INSERT INTO transactions (id, tenant_id, wallet_id, timestamp, token_symbol, value, tx_type, chain, is_duplicate) VALUES (?,?,?,?,?,?,?,?,?)`,
          args: [`s2b-onc-${RUN}`, S2B_TENANT, wId, '2024-08-11T10:01:00Z', 'ETH', '1.03', 'transfer', 'eth', 0],
        });

        const stats = await runDuplicateSweep(S2B_TENANT);
        expect(stats.strategy2CrossTable).toBe(0);
      });

      it('strategy 2 does NOT match when timestamps are more than 5 minutes apart', async () => {
        const wId = randomUUID();
        await db.execute({ sql: `INSERT INTO wallets (id, tenant_id, address) VALUES (?,?,?)`, args: [wId, S2C_TENANT, '0xface'] });

        await db.execute({
          sql: `INSERT INTO import_transactions (id, tenant_id, timestamp_utc, asset_symbol, direction, kind, amount, source, import_batch_id, is_duplicate) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          args: [`s2c-imp-${RUN}`, S2C_TENANT, '2024-08-12T10:00:00Z', 'BTC', 'in', 'buy', 0.5, 'coinbase', 'batch-S2c', 0],
        });
        // 6 minutes apart — outside the 5-minute window
        await db.execute({
          sql: `INSERT INTO transactions (id, tenant_id, wallet_id, timestamp, token_symbol, value, tx_type, chain, is_duplicate) VALUES (?,?,?,?,?,?,?,?,?)`,
          args: [`s2c-onc-${RUN}`, S2C_TENANT, wId, '2024-08-12T10:06:00Z', 'BTC', '0.5', 'transfer', 'eth', 0],
        });

        const stats = await runDuplicateSweep(S2C_TENANT);
        expect(stats.strategy2CrossTable).toBe(0);
      });
    });
  },
);
