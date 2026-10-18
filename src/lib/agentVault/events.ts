/**
 * The Agent Vault ledger: a dated record of what happened on one tin, kept append-only.
 *
 * Slice 2 writes the first kind of event, `checked`: an agent asked, through its API key, whether
 * it may send to an address, and this is what it was answered, and when. The second kind,
 * `transaction`, is reserved for the slice that watches a registered destination receive the funds.
 * The table already allows it, because a CHECK constraint is not something the web database role
 * can change later.
 *
 * Append-only by construction: this module inserts and reads, and nothing in it rewrites or
 * removes a row. A correction is a new event. The only way a row leaves is the whole account
 * being removed (src/lib/accountDeleteTables.ts), and tests/agentics/guards.test.ts fails the day
 * any other file names this table in a write that is not an insert.
 *
 * Tenant isolation is the same rule as store.ts: every statement names tenant_id, and a row of
 * another account answers exactly like one that does not exist. Times are UTC ISO-8601 with
 * milliseconds, so two events in one second still order, and a plain string comparison sorts them.
 *
 * Schema is created lazily by ensureAgentEventsTable and mirrored in
 * migrations-pg/0051_agent_events.sql (tests/agentics/guards.test.ts keeps the two equal).
 */
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { parseChain, type VaultChain } from './addresses';

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
    id          TEXT NOT NULL PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    tin_id      TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('checked', 'transaction')),
    address     TEXT NOT NULL,
    chain       TEXT,
    answer      TEXT CHECK (answer IN ('proven', 'consistent-with-history', 'flagged', 'unknown')),
    registry    TEXT CHECK (registry IN ('trusted', 'flagged', 'pending', 'none')),
    status      TEXT,
    key_id      TEXT,
    source_ip   TEXT,
    detail_json TEXT,
    occurred_at TEXT NOT NULL,
    created_at  TEXT NOT NULL ${TS_DEFAULT}
  )`,
  `CREATE INDEX IF NOT EXISTS agent_events_tin_time ON agent_events (tenant_id, tin_id, occurred_at, id)`,
  `CREATE INDEX IF NOT EXISTS agent_events_tin_address ON agent_events (tenant_id, tin_id, address)`,
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

/** One event as callers see it (never a tenant id). */
export interface LedgerEvent {
  id: string;
  tinId: string;
  kind: EventKind;
  /** When it happened, UTC ISO-8601 with milliseconds. */
  at: string;
  /** Normalized: lowercase for an EVM address, as given (trimmed) for any other chain. */
  address: string;
  /** The chain of the tin's registry row for this address, or null when the address is not registered. */
  chain: VaultChain | null;
  answer: VaultAnswer | null;
  registry: RegistryVerdict | null;
  /** The public check's own status (proven, mismatch, unanchored, unknown), as it answered. */
  status: string | null;
  /** The API key that asked. */
  keyId: string | null;
  /** The caller's address as the rate limiter sees it, kept as metadata only. */
  sourceIp: string | null;
  /** The basis and the rest of what was answered. */
  detail: Record<string, unknown> | null;
}

const text = (v: unknown): string | null => (v == null ? null : String(v));

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
    detail: parseDetail(r.detail_json),
  };
}

const EVENT_COLUMNS = `id, tin_id, kind, address, chain, answer, registry, status, key_id, source_ip, detail_json, occurred_at`;

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

/** Appends a `checked` event. The only write this module has. */
export async function insertCheckedEvent(tenantId: string, input: CheckedEventInput): Promise<LedgerEvent> {
  await ensureAgentEventsTable();
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO agent_events (id, tenant_id, tin_id, kind, address, chain, answer, registry, status, key_id, source_ip, detail_json, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, tenantId, input.tinId, 'checked', input.address, input.chain, input.answer, input.registry,
      input.status, input.keyId, input.sourceIp, JSON.stringify(input.detail), input.at,
    ],
  });
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
    detail: input.detail,
  };
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
