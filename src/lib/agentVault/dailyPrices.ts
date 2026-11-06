/**
 * Daily prices, kept once per coin and day, so a transfer is recorded the moment the chain confirms
 * it and its USD value follows.
 *
 * Bots make many small payments. Pricing each one as it is written would hold every transfer of the
 * morning back until noon UTC (the day's price is taken at noon, ./pricing.ts) and would ask for the
 * same price again and again. Instead the watcher writes a transfer whose price is not available yet
 * with its token and exact amount, no USD value, and a pending mark (`detail.price.pending`, with the
 * coin and the day). This module then:
 *
 *   - fills the price table, one row per (coin, day): after a pass over a tin, the coins and days its
 *     pending transfers need are looked up once each, as soon as noon UTC of that day has passed. A
 *     price that does not come back is asked for again on the next pass, and after the retry window
 *     (a week) the day is written as having no price, for good;
 *   - lays the price over the events as they are read: a pending transfer's USD value is its exact
 *     amount times the day's price for its coin, worked out when the event is read. The ledger row
 *     itself is never changed (it is append-only); a later read simply finds the price.
 *
 * So ten thousand transfers of one coin on one day cost one lookup and one row here. The table holds
 * public market data and nothing about any account: it has no tenant column on purpose. Every read of
 * the ledger in this file names the account and the tin.
 *
 * Schema is created lazily by ensureDailyPricesTable and mirrored in
 * migrations-pg/0068_agent_daily_prices.sql (tests/agentics/guards.test.ts keeps the two equal).
 */
import { db } from '@/lib/db';
import { pendingPriceOf } from './pricePending';
import { PRICE_RETRY_WINDOW_MS, priceMomentMs, type PricingDeps } from './pricing';

export { pendingPriceOf };

const TS_DEFAULT = `DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`;

/** The table, in creation order. The migration file holds the same statement. */
export const AGENT_DAILY_PRICES_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_daily_prices (
    coin_id    TEXT NOT NULL,
    day        TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('priced', 'none')),
    unit_usd   DOUBLE PRECISION,
    fetched_at TEXT NOT NULL ${TS_DEFAULT},
    PRIMARY KEY (coin_id, day)
  )`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates the price table if it is missing. Runs once per process; a failed run is retried by the next call. */
export function ensureDailyPricesTable(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      for (const sql of AGENT_DAILY_PRICES_DDL) await db.execute({ sql, args: [] });
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

/** One day's price for one coin: a USD price, or `none` (looked for past the retry window and not found). */
export type DailyPrice = { status: 'priced'; unitUsd: number } | { status: 'none' };

const key = (coinId: string, day: string): string => `${coinId}|${day}`;

/** The stored prices for some (coin, day) pairs, keyed `coin|day`. Pairs with no row are absent. */
export async function readDailyPrices(pairs: Iterable<{ coinId: string; day: string }>): Promise<Map<string, DailyPrice>> {
  const wanted = new Map<string, { coinId: string; day: string }>();
  for (const p of pairs) wanted.set(key(p.coinId, p.day), p);
  const out = new Map<string, DailyPrice>();
  if (!wanted.size) return out;
  await ensureDailyPricesTable();
  for (const p of wanted.values()) {
    const r = await db.execute({ sql: `SELECT status, unit_usd FROM agent_daily_prices WHERE coin_id = ? AND day = ? LIMIT 1`, args: [p.coinId, p.day] });
    const row = r.rows[0] as { status?: unknown; unit_usd?: unknown } | undefined;
    if (!row) continue;
    const unit = Number(row.unit_usd);
    if (row.status === 'priced' && Number.isFinite(unit) && unit > 0) out.set(key(p.coinId, p.day), { status: 'priced', unitUsd: unit });
    else if (row.status === 'none') out.set(key(p.coinId, p.day), { status: 'none' });
  }
  return out;
}

/** Writes one day's price for one coin, once: an existing row is kept as it is. */
export async function writeDailyPrice(coinId: string, day: string, price: DailyPrice): Promise<void> {
  await ensureDailyPricesTable();
  await db.execute({
    sql: `INSERT INTO agent_daily_prices (coin_id, day, status, unit_usd) VALUES (?, ?, ?, ?) ON CONFLICT (coin_id, day) DO NOTHING`,
    args: [coinId, day, price.status, price.status === 'priced' ? price.unitUsd : null],
  });
}

/** The most pending transfers one fill looks at for one tin, newest first. */
export const PENDING_SCAN_LIMIT = 2_000;

/** The (coin, day) pairs this tin's pending transfers still need, from the last retry window. */
async function pendingPairs(tenantId: string, tinId: string, nowMs: number): Promise<Array<{ coinId: string; day: string }>> {
  const since = new Date(nowMs - PRICE_RETRY_WINDOW_MS - 2 * 86_400_000).toISOString();
  const r = await db.execute({
    sql: `SELECT detail_json FROM agent_events
          WHERE tenant_id = ? AND tin_id = ? AND kind = 'transaction' AND usd_value IS NULL AND occurred_at >= ? AND detail_json LIKE ?
          ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    args: [tenantId, tinId, since, '%"pending":true%', PENDING_SCAN_LIMIT],
  });
  const pairs = new Map<string, { coinId: string; day: string }>();
  for (const row of r.rows as Array<{ detail_json?: unknown }>) {
    let detail: Record<string, unknown> | null = null;
    try {
      detail = typeof row.detail_json === 'string' ? (JSON.parse(row.detail_json) as Record<string, unknown>) : null;
    } catch {
      detail = null;
    }
    const p = pendingPriceOf(detail);
    if (p) pairs.set(key(p.coinId, p.day), p);
  }
  return [...pairs.values()];
}

export interface FillReport {
  /** Pairs this fill wrote a price for. */
  priced: number;
  /** Pairs written as having no price, for good. */
  none: number;
  /** Pairs still waiting (noon has not passed, or the price did not come back yet). */
  waiting: number;
}

/**
 * Looks up, once each, the day prices this tin's pending transfers need and stores them. Never asks
 * for a price before noon UTC of its day. Never throws for a single lookup; a database failure is the
 * caller's to log.
 */
export async function fillPendingPrices(tenantId: string, tinId: string, pricing: PricingDeps, nowMs: number): Promise<FillReport> {
  const report: FillReport = { priced: 0, none: 0, waiting: 0 };
  const pairs = await pendingPairs(tenantId, tinId, nowMs);
  if (!pairs.length) return report;
  const have = await readDailyPrices(pairs);
  for (const p of pairs) {
    if (have.has(key(p.coinId, p.day))) continue;
    if (priceMomentMs(p.day) > nowMs) {
      report.waiting += 1;
      continue;
    }
    const unit = await pricing.unitPriceUsd(p.coinId, p.day);
    if (unit !== null && Number.isFinite(unit) && unit > 0) {
      await writeDailyPrice(p.coinId, p.day, { status: 'priced', unitUsd: unit });
      report.priced += 1;
    } else if (priceMomentMs(p.day) < nowMs - PRICE_RETRY_WINDOW_MS) {
      await writeDailyPrice(p.coinId, p.day, { status: 'none' });
      report.none += 1;
    } else {
      report.waiting += 1;
    }
  }
  return report;
}

/** The parts of an event this file reads and fills: kept loose so every reader's own event type fits. */
interface PriceableEvent {
  tx: { amount: string; usd: number | null } | null;
  detail: Record<string, unknown> | null;
}

/**
 * Lays the stored day prices over a list of events, in place, and returns it. A pending transfer whose
 * day is priced gets its USD value (its exact amount times the day's price) and a price detail that
 * says so; one whose day has no price for good says that; one still waiting keeps its pending mark.
 * Rows that are not pending are left exactly as they are.
 */
export async function applyDailyPrices<T extends PriceableEvent>(events: T[]): Promise<T[]> {
  const wanted: Array<{ coinId: string; day: string }> = [];
  for (const e of events) {
    if (!e.tx || e.tx.usd !== null) continue;
    const p = pendingPriceOf(e.detail);
    if (p) wanted.push(p);
  }
  if (!wanted.length) return events;
  let prices: Map<string, DailyPrice>;
  try {
    prices = await readDailyPrices(wanted);
  } catch (err) {
    // The prices are an addition: an event read without them still says its price is pending, never wrong.
    const e = err as { name?: unknown; code?: unknown } | null;
    console.error('[agent-vault] daily prices not read', { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
    return events;
  }
  for (const e of events) {
    if (!e.tx || e.tx.usd !== null) continue;
    const p = pendingPriceOf(e.detail);
    if (!p) continue;
    const price = prices.get(key(p.coinId, p.day));
    if (!price) continue;
    if (price.status === 'none') {
      e.detail = { ...(e.detail ?? {}), price: { basis: null, reason: 'no_price' } };
      continue;
    }
    const usd = Number(e.tx.amount) * price.unitUsd;
    if (!Number.isFinite(usd) || usd < 0) continue;
    e.tx = { ...e.tx, usd };
    e.detail = { ...(e.detail ?? {}), price: { basis: 'daily_price', day: p.day, unitUsd: price.unitUsd, filledLater: true } };
  }
  return events;
}
