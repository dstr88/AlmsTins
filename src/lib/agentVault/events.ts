/**
 * The Agent Vault ledger: a dated record of what happened on one tin, kept append-only.
 *
 * Two kinds of event. `checked` (slice 2): an agent asked, through its API key, whether it may
 * send to an address, and this is what it was answered, and when. `transaction` (slice 3): the
 * chain confirmed funds moving between the agent's own wallet and a trusted, registered
 * destination, and this is the transfer, its USD value at the time, and the verify-status it
 * inherits from the check that came before it (./link.ts). The kind column allows both because a
 * CHECK constraint is not something the web database role can change later.
 *
 * Append-only by construction: this module inserts and reads, and nothing in it rewrites or
 * removes a row. A correction is a new event. The only way a row leaves is the whole account
 * being removed (src/lib/accountDeleteTables.ts), and tests/agentics/guards.test.ts fails the day
 * any other file names this table in a write that is not an insert.
 *
 * Tenant isolation is the same rule as store.ts: every statement names tenant_id, and a row of
 * another account answers exactly like one that does not exist. Times are UTC ISO-8601 with
 * milliseconds, so two events in one second still order, and a plain string comparison sorts them.
 * A `transaction` event is stamped with the time of its block; a `checked` event with the time the
 * check was answered.
 *
 * A transfer is written at most once. Its event id is derived from the tenant, the tin, the chain,
 * the transaction hash and the leg of that transaction (transactionEventId), and the insert skips
 * an id that exists. Reading the same chain history again, after a restart or an overlapping
 * window, therefore cannot add a second row for the same movement.
 *
 * Schema is created lazily by ensureAgentEventsTable and mirrored in
 * migrations-pg/0051_agent_events.sql (tests/agentics/guards.test.ts keeps the two equal).
 */
import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { parseChain, type VaultChain } from './addresses';
import { addTransfer, emptySums, toSideTotal, type SideTotal } from './money';

export type { SideTotal };

const TS_DEFAULT = `DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS'))`;

export const EVENT_KINDS = ['checked', 'transaction'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** The four verify-statuses an event carries. Proven is a domain proof; the rest are about this tin. */
export const VAULT_ANSWERS = ['proven', 'consistent-with-history', 'flagged', 'unknown'] as const;
export type VaultAnswer = (typeof VAULT_ANSWERS)[number];

/** What the tin's registry says about the address: the owner's own list, never a verdict on the address itself. */
export const REGISTRY_VERDICTS = ['trusted', 'flagged', 'pending', 'none'] as const;
export type RegistryVerdict = (typeof REGISTRY_VERDICTS)[number];

/** The table and indexes, in creation order. The migration file holds the same statements. */
export const AGENT_EVENTS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS agent_events (
    id             TEXT NOT NULL PRIMARY KEY,
    tenant_id      TEXT NOT NULL,
    tin_id         TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('checked', 'transaction')),
    address        TEXT NOT NULL,
    chain          TEXT,
    answer         TEXT CHECK (answer IN ('proven', 'consistent-with-history', 'flagged', 'unknown')),
    registry       TEXT CHECK (registry IN ('trusted', 'flagged', 'pending', 'none')),
    status         TEXT,
    key_id         TEXT,
    source_ip      TEXT,
    tx_hash        TEXT,
    direction      TEXT CHECK (direction IN ('in', 'out')),
    wallet         TEXT,
    amount         TEXT,
    asset          TEXT,
    asset_contract TEXT,
    usd_value      DOUBLE PRECISION,
    block_number   INTEGER,
    detail_json    TEXT,
    occurred_at    TEXT NOT NULL,
    created_at     TEXT NOT NULL ${TS_DEFAULT},
    CHECK (kind <> 'transaction' OR (chain IS NOT NULL AND tx_hash IS NOT NULL AND direction IS NOT NULL AND wallet IS NOT NULL AND amount IS NOT NULL AND asset IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS agent_events_tin_time ON agent_events (tenant_id, tin_id, occurred_at, id)`,
  `CREATE INDEX IF NOT EXISTS agent_events_tin_address ON agent_events (tenant_id, tin_id, address, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS agent_events_tin_transactions ON agent_events (tenant_id, tin_id, occurred_at, id) WHERE kind = 'transaction'`,
];

let ensurePromise: Promise<void> | null = null;

/** Creates the ledger table if it is missing. Runs once per process; a failed run is retried by the next call. */
export function ensureAgentEventsTable(): Promise<void> {
  if (!ensurePromise) {
    const run = (async () => {
      for (const sql of AGENT_EVENTS_DDL) await db.execute({ sql, args: [] });
    })();
    ensurePromise = run;
    run.catch(() => {
      if (ensurePromise === run) ensurePromise = null;
    });
  }
  return ensurePromise;
}

/** The movement of funds a `transaction` event records, as the chain showed it. */
export interface TransactionFacts {
  hash: string;
  /** `in` is value that reached the agent's wallet (bought); `out` is value that left it (sold). */
  direction: 'in' | 'out';
  /** The agent's own wallet on this transfer. The other side is the event's `address`. */
  wallet: string;
  /** The exact amount as a decimal string, in whole units of the asset. Never a float. */
  amount: string;
  /** The asset's symbol as the explorer reported it (ETH, POL, AVAX for a chain's own coin). */
  asset: string;
  /** The token's contract, lowercase; null for the chain's own coin. */
  assetContract: string | null;
  /** USD value at the time of the transfer, or null when it could not be priced (never 0 for "unknown"). */
  usd: number | null;
  blockNumber: number | null;
}

/** One event as callers see it (never a tenant id). */
export interface LedgerEvent {
  id: string;
  tinId: string;
  kind: EventKind;
  /** When it happened, UTC ISO-8601 with milliseconds. */
  at: string;
  /** Normalized: lowercase for an EVM address, as given (trimmed) for any other chain. For a transaction, the destination. */
  address: string;
  /** The chain of the tin's registry row for this address, or null when the address is not registered. */
  chain: VaultChain | null;
  /** For a check, what it answered. For a transaction, the answer of the check that came before it (`unknown` when none did). */
  answer: VaultAnswer | null;
  registry: RegistryVerdict | null;
  /** The public check's own status (proven, mismatch, unanchored, unknown), as it answered. */
  status: string | null;
  /** The API key that asked. */
  keyId: string | null;
  /**
   * A salted one-way hash of the caller's address as the rate limiter sees it, kept as metadata only
   * (the column is still called source_ip; the address itself is never stored). Never part of an
   * export, and never sent to the owner either (the events endpoint leaves it out).
   */
  sourceIp: string | null;
  /** The funds, for a `transaction`; null for a check. */
  tx: TransactionFacts | null;
  /** The basis and the rest of what was answered. */
  detail: Record<string, unknown> | null;
}

const text = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function oneOf<T extends string>(allowed: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function parseDetail(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function txFrom(r: any): TransactionFacts | null {
  if (r.tx_hash == null) return null;
  return {
    hash: String(r.tx_hash),
    direction: r.direction === 'out' ? 'out' : 'in',
    wallet: String(r.wallet ?? ''),
    amount: String(r.amount ?? ''),
    asset: String(r.asset ?? ''),
    assetContract: text(r.asset_contract),
    usd: num(r.usd_value),
    blockNumber: num(r.block_number),
  };
}

function eventFrom(r: any): LedgerEvent {
  return {
    id: String(r.id),
    tinId: String(r.tin_id),
    kind: oneOf(EVENT_KINDS, r.kind) ?? 'checked',
    at: String(r.occurred_at),
    address: String(r.address),
    chain: parseChain(r.chain),
    answer: oneOf(VAULT_ANSWERS, r.answer),
    registry: oneOf(REGISTRY_VERDICTS, r.registry),
    status: text(r.status),
    keyId: text(r.key_id),
    sourceIp: text(r.source_ip),
    tx: txFrom(r),
    detail: parseDetail(r.detail_json),
  };
}

const EVENT_COLUMNS = `id, tin_id, kind, address, chain, answer, registry, status, key_id, source_ip, tx_hash, direction, wallet, amount, asset, asset_contract, usd_value, block_number, detail_json, occurred_at`;

/** Everything an event row can hold, as one insert takes it. */
interface EventRow {
  id: string;
  tinId: string;
  kind: EventKind;
  address: string;
  chain: VaultChain | null;
  answer: VaultAnswer | null;
  registry: RegistryVerdict | null;
  status: string | null;
  keyId: string | null;
  sourceIp: string | null;
  tx: TransactionFacts | null;
  detail: Record<string, unknown>;
  at: string;
}

/**
 * The one statement that writes the ledger, and the only INSERT INTO this table anywhere in src
 * (tests/agentics/guards.test.ts counts it). An id that already exists is skipped, which is how
 * a transfer read twice is stored once; the return value says whether a row was written.
 */
async function insertEvent(tenantId: string, row: EventRow): Promise<boolean> {
  await ensureAgentEventsTable();
  const r = await db.execute({
    sql: `INSERT INTO agent_events (id, tenant_id, tin_id, kind, address, chain, answer, registry, status, key_id, source_ip, tx_hash, direction, wallet, amount, asset, asset_contract, usd_value, block_number, detail_json, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO NOTHING`,
    args: [
      row.id, tenantId, row.tinId, row.kind, row.address, row.chain, row.answer, row.registry, row.status, row.keyId, row.sourceIp,
      row.tx?.hash ?? null, row.tx?.direction ?? null, row.tx?.wallet ?? null, row.tx?.amount ?? null, row.tx?.asset ?? null,
      row.tx?.assetContract ?? null, row.tx?.usd ?? null, row.tx?.blockNumber ?? null,
      JSON.stringify(row.detail), row.at,
    ],
  });
  return (r.rowsAffected ?? 0) > 0;
}

export interface CheckedEventInput {
  tinId: string;
  address: string;
  chain: VaultChain | null;
  answer: VaultAnswer;
  registry: RegistryVerdict;
  status: string;
  keyId: string;
  sourceIp: string | null;
  detail: Record<string, unknown>;
  /** UTC ISO-8601 with milliseconds. */
  at: string;
}

/** Appends a `checked` event. A check is never written twice, so a skipped insert is an error. */
export async function insertCheckedEvent(tenantId: string, input: CheckedEventInput): Promise<LedgerEvent> {
  const id = randomUUID();
  const written = await insertEvent(tenantId, {
    id,
    tinId: input.tinId,
    kind: 'checked',
    address: input.address,
    chain: input.chain,
    answer: input.answer,
    registry: input.registry,
    status: input.status,
    keyId: input.keyId,
    sourceIp: input.sourceIp,
    tx: null,
    detail: input.detail,
    at: input.at,
  });
  if (!written) throw new Error('agent_events: the check was not written');
  return {
    id,
    tinId: input.tinId,
    kind: 'checked',
    at: input.at,
    address: input.address,
    chain: input.chain,
    answer: input.answer,
    registry: input.registry,
    status: input.status,
    keyId: input.keyId,
    sourceIp: input.sourceIp,
    tx: null,
    detail: input.detail,
  };
}

/**
 * How many checks the agent has had written to its ledger since `sinceIso` (UTC ISO-8601 with
 * milliseconds). Only `checked` events count: the transfers the chain watcher writes are not what a
 * looping key can fill. Used by the daily limit on recorded checks (./entitlements.ts).
 */
export async function countCheckedSince(tenantId: string, tinId: string, sinceIso: string): Promise<number> {
  await ensureAgentEventsTable();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM agent_events WHERE tenant_id = ? AND tin_id = ? AND kind = 'checked' AND occurred_at >= ?`,
    args: [tenantId, tinId, sinceIso],
  });
  return Number((r.rows[0] as { n?: unknown } | undefined)?.n ?? 0);
}

/**
 * When the agent's daily limit on recorded checks was reached, for the day that starts at `sinceIso`: the
 * time of the earliest check written with the limit marker (`detail.limit.reached`), or null when none was.
 * The marker is a field of the check that filled the day, so the ledger shows the moment itself and every
 * export and report that carries the ledger carries it. Looks at one day's rows of one agent only.
 */
export async function limitMarkerSince(tenantId: string, tinId: string, sinceIso: string): Promise<string | null> {
  await ensureAgentEventsTable();
  const r = await db.execute({
    sql: `SELECT occurred_at FROM agent_events
          WHERE tenant_id = ? AND tin_id = ? AND kind = 'checked' AND occurred_at >= ? AND detail_json LIKE ?
          ORDER BY occurred_at ASC, id ASC LIMIT 1`,
    args: [tenantId, tinId, sinceIso, `%"limit":{"reached":true%`],
  });
  const at = (r.rows[0] as { occurred_at?: unknown } | undefined)?.occurred_at;
  return typeof at === 'string' ? at : null;
}

/**
 * The id of the event for one movement of funds: the same tenant, tin, chain, transaction hash and
 * leg always give the same id, and nothing else does. A hash of those parts, shaped like a UUID so
 * it fits the ledger's cursor. Hashing the tenant in keeps ids from ever being shared across accounts.
 */
export function transactionEventId(tenantId: string, tinId: string, chain: string, hash: string, leg: string): string {
  const hex = createHash('sha256').update(['agent-event', tenantId, tinId, chain, hash, leg].join('\u0000')).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface TransactionEventInput {
  tinId: string;
  /** The destination: the other side of the transfer. */
  address: string;
  chain: VaultChain;
  /** The leg of the transaction this event stands for (see transfers.ts); with the hash, it identifies the movement. */
  leg: string;
  /** The verify-status inherited from the check that came before (`unknown` when none did). */
  answer: VaultAnswer;
  /** The public status that check answered, or null. */
  status: string | null;
  tx: TransactionFacts;
  detail: Record<string, unknown>;
  /** The block's time, UTC ISO-8601 with milliseconds. */
  at: string;
}

/**
 * Appends a `transaction` event unless this movement is already in the ledger. `inserted` is false
 * when it was, so reading the chain again adds nothing. Only called for a trusted, registered
 * destination (./watcher.ts), so the registry verdict is `trusted` at the moment of writing.
 */
export async function insertTransactionEvent(
  tenantId: string,
  input: TransactionEventInput,
): Promise<{ id: string; inserted: boolean }> {
  const id = transactionEventId(tenantId, input.tinId, input.chain, input.tx.hash, input.leg);
  const inserted = await insertEvent(tenantId, {
    id,
    tinId: input.tinId,
    kind: 'transaction',
    address: input.address,
    chain: input.chain,
    answer: input.answer,
    registry: 'trusted',
    status: input.status,
    keyId: null,
    sourceIp: null,
    tx: input.tx,
    detail: { ...input.detail, leg: input.leg },
    at: input.at,
  });
  return { id, inserted };
}

/** True when the ledger of this account already holds an event with this id (see transactionEventId). */
export async function transactionEventExists(tenantId: string, id: string): Promise<boolean> {
  await ensureAgentEventsTable();
  const r = await db.execute({
    sql: `SELECT id FROM agent_events WHERE id = ? AND tenant_id = ? LIMIT 1`,
    args: [id, tenantId],
  });
  return r.rows.length > 0;
}

/** True when this tin has already been asked about this exact address (the history the answer rests on). */
export async function hasPriorCheck(tenantId: string, tinId: string, address: string): Promise<boolean> {
  await ensureAgentEventsTable();
  const r = await db.execute({
    sql: `SELECT id FROM agent_events WHERE tenant_id = ? AND tin_id = ? AND kind = 'checked' AND address = ? LIMIT 1`,
    args: [tenantId, tinId, address],
  });
  return r.rows.length > 0;
}

/** A check as the link needs it: when it was answered, what it answered, and who asked. */
export interface CheckForLink {
  id: string;
  at: string;
  answer: VaultAnswer;
  status: string | null;
  keyId: string | null;
}

/**
 * The checks of this tin about this address answered between `fromIso` and `toIso` (inclusive),
 * newest first. `limit` bounds the read: the link only needs the latest few.
 */
export async function listChecksForLink(
  tenantId: string,
  tinId: string,
  address: string,
  range: { fromIso: string; toIso: string; limit: number },
): Promise<CheckForLink[]> {
  await ensureAgentEventsTable();
  const r = await db.execute({
    sql: `SELECT id, occurred_at, answer, status, key_id FROM agent_events
          WHERE tenant_id = ? AND tin_id = ? AND kind = 'checked' AND address = ? AND occurred_at >= ? AND occurred_at <= ?
          ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    args: [tenantId, tinId, address, range.fromIso, range.toIso, range.limit],
  });
  const out: CheckForLink[] = [];
  for (const row of r.rows as any[]) {
    const answer = oneOf(VAULT_ANSWERS, row.answer);
    if (!answer) continue; // a check without a recognizable answer cannot stamp anything
    out.push({ id: String(row.id), at: String(row.occurred_at), answer, status: text(row.status), keyId: text(row.key_id) });
  }
  return out;
}

// ── Reading ──────────────────────────────────────────────────────────────────

const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([0-9a-f-]{36})$/;

/** An opaque cursor for "events older than this one". */
export const cursorOf = (e: { at: string; id: string }): string => `${e.at}|${e.id}`;

/** The time and id inside a cursor, or null when the text is not one. */
export function parseCursor(raw: unknown): { at: string; id: string } | null {
  const m = typeof raw === 'string' ? CURSOR.exec(raw) : null;
  return m ? { at: m[1], id: m[2] } : null;
}

/** One page of a tin's events, newest first. `limit` is trusted to be a small positive integer (vault.ts clamps it). */
export async function listEvents(
  tenantId: string,
  tinId: string,
  opts: { limit: number; before?: { at: string; id: string } | null },
): Promise<{ events: LedgerEvent[]; next: string | null }> {
  await ensureAgentEventsTable();
  const args: Array<string | number> = [tenantId, tinId];
  let after = '';
  if (opts.before) {
    after = ` AND (occurred_at < ? OR (occurred_at = ? AND id < ?))`;
    args.push(opts.before.at, opts.before.at, opts.before.id);
  }
  args.push(opts.limit + 1);
  const r = await db.execute({
    sql: `SELECT ${EVENT_COLUMNS} FROM agent_events WHERE tenant_id = ? AND tin_id = ?${after} ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    args,
  });
  const rows = r.rows.map(eventFrom);
  const page = rows.slice(0, opts.limit);
  return { events: page, next: rows.length > opts.limit && page.length ? cursorOf(page[page.length - 1]) : null };
}

// ── The live feed reads the ledger in the order it was WRITTEN ───────────────

/** The index the feed reads by. Migration 0062 holds the same statement. */
export const AGENT_EVENTS_FEED_INDEX = 'agent_events_tenant_written';

/**
 * Kept out of AGENT_EVENTS_DDL on purpose: that list is migration 0051 word for word (a guard test holds
 * the two together), and 0051 has already run. The feed's index is its own migration, 0062.
 */
export const AGENT_EVENTS_FEED_DDL: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS ${AGENT_EVENTS_FEED_INDEX} ON agent_events (tenant_id, created_at, id)`,
];

let feedIndexPromise: Promise<void> | null = null;

/**
 * Makes sure the feed's index exists. Runs once per process, and only when the feed is read, never for a
 * check or a transfer being written. It never throws: the feed works without the index, only slower, and
 * a keyed check must not fail because an index could not be built. CREATE INDEX takes a lock that waits
 * for every writer, so it gives up after two seconds instead of holding the table's other writers behind
 * it (a failed attempt is logged by name and code and tried again by the next read).
 */
export function ensureFeedIndex(): Promise<void> {
  if (!feedIndexPromise) {
    const attempt: Promise<void> = (async () => {
      await db.batch([{ sql: `SET LOCAL lock_timeout = '2s'`, args: [] }, ...AGENT_EVENTS_FEED_DDL.map((sql) => ({ sql, args: [] }))], 'write');
    })().catch((err) => {
      const e = err as { name?: unknown; code?: unknown } | null;
      console.error('[agent-vault] feed index not ensured', { name: String(e?.name ?? 'Error'), code: String(e?.code ?? '') });
      if (feedIndexPromise === attempt) feedIndexPromise = null;
    });
    feedIndexPromise = attempt;
  }
  return feedIndexPromise;
}

/**
 * An event with the moment the Vault wrote it. `at` is when it happened: a check is written the moment it
 * is asked, but a transfer is written minutes after its block (the watcher reads only blocks old enough to
 * keep), so a feed that followed `at` would never see a transfer. `writtenAt` is the table's own created_at,
 * UTC to the second ("YYYY-MM-DD HH:MM:SS").
 */
export interface WrittenEvent extends LedgerEvent {
  writtenAt: string;
}

const WRITTEN_COLUMNS = `${EVENT_COLUMNS}, created_at`;
const writtenFrom = (r: any): WrittenEvent => ({ ...eventFrom(r), writtenAt: String(r.created_at) });

/** The newest events written for an account (for one agent when `tinId` is given), oldest first. */
export async function latestEventsWritten(tenantId: string, opts: { limit: number; tinId?: string | null }): Promise<WrittenEvent[]> {
  await ensureAgentEventsTable();
  await ensureFeedIndex();
  const args: Array<string | number> = [tenantId];
  let tin = '';
  if (opts.tinId) {
    tin = ' AND tin_id = ?';
    args.push(opts.tinId);
  }
  args.push(opts.limit);
  const r = await db.execute({
    sql: `SELECT ${WRITTEN_COLUMNS} FROM agent_events WHERE tenant_id = ?${tin} ORDER BY created_at DESC, id DESC LIMIT ?`,
    args,
  });
  return r.rows.map(writtenFrom).reverse();
}

/**
 * Events written at or after `writtenAt`, oldest first, at most `limit` (`more` says there are others). The
 * bound is inclusive: created_at has one-second resolution, so an event written a moment after a reader saw
 * the second's others would otherwise be missed. The reader de-duplicates by id.
 */
export async function eventsWrittenSince(
  tenantId: string,
  opts: { writtenAt: string; limit: number; tinId?: string | null },
): Promise<{ events: WrittenEvent[]; more: boolean }> {
  await ensureAgentEventsTable();
  await ensureFeedIndex();
  const args: Array<string | number> = [tenantId, opts.writtenAt];
  let tin = '';
  if (opts.tinId) {
    tin = ' AND tin_id = ?';
    args.push(opts.tinId);
  }
  args.push(opts.limit + 1);
  const r = await db.execute({
    sql: `SELECT ${WRITTEN_COLUMNS} FROM agent_events WHERE tenant_id = ? AND created_at >= ?${tin} ORDER BY created_at ASC, id ASC LIMIT ?`,
    args,
  });
  const rows = r.rows.map(writtenFrom);
  return { events: rows.slice(0, opts.limit), more: rows.length > opts.limit };
}

/** Events written strictly after the (writtenAt, id) position, oldest first: the next page of a backlog. */
export async function eventsWrittenAfter(
  tenantId: string,
  opts: { writtenAt: string; id: string; limit: number; tinId?: string | null },
): Promise<{ events: WrittenEvent[]; more: boolean }> {
  await ensureAgentEventsTable();
  await ensureFeedIndex();
  const args: Array<string | number> = [tenantId, opts.writtenAt, opts.writtenAt, opts.id];
  let tin = '';
  if (opts.tinId) {
    tin = ' AND tin_id = ?';
    args.push(opts.tinId);
  }
  args.push(opts.limit + 1);
  const r = await db.execute({
    sql: `SELECT ${WRITTEN_COLUMNS} FROM agent_events WHERE tenant_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))${tin} ORDER BY created_at ASC, id ASC LIMIT ?`,
    args,
  });
  const rows = r.rows.map(writtenFrom);
  return { events: rows.slice(0, opts.limit), more: rows.length > opts.limit };
}

/** When the newest event of one kind happened on a tin (UTC ISO-8601), or null when it has none. */
export async function latestEventTime(tenantId: string, tinId: string, kind: EventKind): Promise<string | null> {
  await ensureAgentEventsTable();
  const r = await db.execute({
    sql: `SELECT occurred_at FROM agent_events WHERE tenant_id = ? AND tin_id = ? AND kind = ? ORDER BY occurred_at DESC, id DESC LIMIT 1`,
    args: [tenantId, tinId, kind],
  });
  return r.rows.length ? String((r.rows[0] as any).occurred_at) : null;
}

// ── Totals ───────────────────────────────────────────────────────────────────

/** What a tin's recorded transfers add up to. Raw value in and out, nothing netted, no price after the fact. */
export interface TinTotals {
  transactions: number;
  /** Value that reached the agent's wallet from a trusted destination. */
  bought: SideTotal;
  /** Value that left the agent's wallet for a trusted destination. */
  sold: SideTotal;
}

const TOTALS_PAGE = 1000;

/** Adds up every `transaction` event of one tin, oldest first, a page at a time. Dollar amounts are summed as whole micro-dollars so the sum is exact. */
export async function sumTransactions(tenantId: string, tinId: string): Promise<TinTotals> {
  await ensureAgentEventsTable();
  const sides = { in: emptySums(), out: emptySums() };
  let afterAt = '';
  let afterId = '';
  for (;;) {
    const r = await db.execute({
      sql: `SELECT id, occurred_at, direction, usd_value FROM agent_events
            WHERE tenant_id = ? AND tin_id = ? AND kind = 'transaction' AND (occurred_at > ? OR (occurred_at = ? AND id > ?))
            ORDER BY occurred_at ASC, id ASC LIMIT ?`,
      args: [tenantId, tinId, afterAt, afterAt, afterId, TOTALS_PAGE],
    });
    const rows = r.rows as any[];
    for (const row of rows) addTransfer(row.direction === 'out' ? sides.out : sides.in, num(row.usd_value));
    if (rows.length < TOTALS_PAGE) break;
    const last = rows[rows.length - 1];
    const nextAt = String(last.occurred_at);
    const nextId = String(last.id);
    if (nextAt === afterAt && nextId === afterId) break; // the page did not move; never loop
    afterAt = nextAt;
    afterId = nextId;
  }
  return { transactions: sides.in.count + sides.out.count, bought: toSideTotal(sides.in), sold: toSideTotal(sides.out) };
}

// ── Reading a period ─────────────────────────────────────────────────────────

/** Rows per page when a period is read. */
export const PERIOD_PAGE = 1000;

/**
 * Hands every event of one tin that happened in [fromIso, toIso) to `onEvent`, oldest first, a
 * page at a time, so a busy day never sits in memory whole. Both bounds are UTC ISO-8601 with
 * milliseconds, the form `occurred_at` is stored in, so a plain string comparison is a time
 * comparison. The end is exclusive: an event stamped at the stroke of midnight belongs to the day
 * that begins there. Returns how many events it read.
 */
export async function readEventsInRange(
  tenantId: string,
  tinId: string,
  range: { fromIso: string; toIso: string },
  onEvent: (event: LedgerEvent) => void,
  opts: { pageSize?: number } = {},
): Promise<number> {
  await ensureAgentEventsTable();
  const pageSize = opts.pageSize ?? PERIOD_PAGE;
  let afterAt = '';
  let afterId = '';
  let read = 0;
  for (;;) {
    const r = await db.execute({
      sql: `SELECT ${EVENT_COLUMNS} FROM agent_events
            WHERE tenant_id = ? AND tin_id = ? AND occurred_at >= ? AND occurred_at < ? AND (occurred_at > ? OR (occurred_at = ? AND id > ?))
            ORDER BY occurred_at ASC, id ASC LIMIT ?`,
      args: [tenantId, tinId, range.fromIso, range.toIso, afterAt, afterAt, afterId, pageSize],
    });
    const rows = r.rows as any[];
    for (const row of rows) {
      onEvent(eventFrom(row));
      read += 1;
    }
    if (rows.length < pageSize) break;
    const last = rows[rows.length - 1];
    const nextAt = String(last.occurred_at);
    const nextId = String(last.id);
    if (nextAt === afterAt && nextId === afterId) break; // the page did not move; never loop
    afterAt = nextAt;
    afterId = nextId;
  }
  return read;
}

/** How many events this tin has in [fromIso, toIso): what an export asks before it reads anything, so a range that is too large is refused cheaply. */
export async function countEventsInRange(tenantId: string, tinId: string, range: { fromIso: string; toIso: string }): Promise<number> {
  await ensureAgentEventsTable();
  const r = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM agent_events WHERE tenant_id = ? AND tin_id = ? AND occurred_at >= ? AND occurred_at < ?`,
    args: [tenantId, tinId, range.fromIso, range.toIso],
  });
  return Number((r.rows[0] as any)?.n ?? 0);
}

/** True when this tin has at least one event in [fromIso, toIso): the cheap question a daily job asks before it reads a whole day. */
export async function hasEventsInRange(tenantId: string, tinId: string, range: { fromIso: string; toIso: string }): Promise<boolean> {
  await ensureAgentEventsTable();
  const r = await db.execute({
    sql: `SELECT id FROM agent_events WHERE tenant_id = ? AND tin_id = ? AND occurred_at >= ? AND occurred_at < ? LIMIT 1`,
    args: [tenantId, tinId, range.fromIso, range.toIso],
  });
  return r.rows.length > 0;
}
