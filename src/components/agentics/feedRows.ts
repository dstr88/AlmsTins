/**
 * What the live feed shows, as a page reads it from the feed's answer (src/lib/agentVault/feed.ts). A row
 * is the ledger's own row (src/lib/agentVault/ledgerView.ts, which keeps only values it recognizes) plus
 * the moment the Vault wrote it, the agent's name, the owner's label for the address and the agent's id.
 *
 * The two texts the owner wrote (the agent's name and the label) are cut to a length a card can hold and
 * are rendered as text by React, which escapes them. Pure, so every branch is a unit test.
 */
import { toLedgerRow, type LedgerRow } from '@/lib/agentVault/ledgerView';
import { formatClock } from '@/lib/agentVault/reportFormat';
import type { EventView } from '@/lib/agentVault/vault';

export interface FeedRow extends LedgerRow {
  /** When the Vault wrote it ("YYYY-MM-DD HH:MM:SS", UTC). `at` is when it happened. */
  writtenAt: string;
  tinId: string;
  agent: string;
  label: string | null;
}

/** The rows the list shows, newest written first. Older ones are on the agent's own page. */
export const FEED_LIST_MAX = 100;
/** The rows kept for each agent, so one agent that is busy cannot push another's out. */
export const FEED_KEEP_PER_AGENT = 100;
/** The most rows kept for all agents together. */
export const FEED_KEEP_MAX = 1000;
/** The longest agent name or label a card shows. */
const MAX_TEXT = 120;
/** What a card calls an agent whose name did not arrive. */
const FALLBACK_AGENT = 'Agent';

const WRITTEN_AT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const clip = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT) : null);

/** One event from the feed's answer, or null when it is not one (no id, no time, an unknown kind, no writing time). */
export function toFeedRow(item: unknown): FeedRow | null {
  if (!item || typeof item !== 'object') return null;
  const e = item as Record<string, unknown>;
  const row = toLedgerRow(e as Partial<EventView>);
  if (!row) return null;
  const writtenAt = typeof e.writtenAt === 'string' && WRITTEN_AT.test(e.writtenAt) ? e.writtenAt : null;
  const tinId = typeof e.tinId === 'string' && e.tinId ? e.tinId : null;
  if (!writtenAt || !tinId) return null;
  return { ...row, writtenAt, tinId, agent: clip(e.agent) ?? FALLBACK_AGENT, label: clip(e.label) };
}

/** The events of an answer as rows, in the order given, dropping anything that is not an event. */
export function parseFeedRows(list: unknown): FeedRow[] {
  if (!Array.isArray(list)) return [];
  const rows: FeedRow[] = [];
  for (const item of list) {
    const row = toFeedRow(item);
    if (row) rows.push(row);
  }
  return rows;
}

/** Newest written first; the id breaks a tie so the order never depends on how rows arrived. */
export function newestFirst(a: Pick<FeedRow, 'writtenAt' | 'id'>, b: Pick<FeedRow, 'writtenAt' | 'id'>): number {
  if (a.writtenAt !== b.writtenAt) return a.writtenAt < b.writtenAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The list with `incoming` added: each id once, newest first. The newest FEED_KEEP_PER_AGENT rows of each agent are
 * kept (so a chatty agent never pushes a quiet one's rows out, which a single cap on the whole list did), and at
 * most FEED_KEEP_MAX in all. Returns the same array when nothing was new.
 */
export function mergeRows(list: readonly FeedRow[], incoming: readonly FeedRow[], perAgent: number = FEED_KEEP_PER_AGENT, total: number = FEED_KEEP_MAX): FeedRow[] {
  const have = new Set(list.map((r) => r.id));
  // Each id once, including within `incoming` itself.
  const fresh: FeedRow[] = [];
  for (const r of incoming) {
    if (have.has(r.id)) continue;
    have.add(r.id);
    fresh.push(r);
  }
  if (!fresh.length) return list as FeedRow[];
  const taken = new Map<string, number>();
  const kept: FeedRow[] = [];
  for (const row of [...list, ...fresh].sort(newestFirst)) {
    const n = (taken.get(row.tinId) ?? 0) + 1;
    taken.set(row.tinId, n);
    if (n <= perAgent) kept.push(row);
  }
  return kept.slice(0, total);
}

/** The rows the list shows: those of the agent chosen (all of them when none is), the newest FEED_LIST_MAX. */
export function visibleRows(rows: readonly FeedRow[], tinId: string, max: number = FEED_LIST_MAX): FeedRow[] {
  return (tinId ? rows.filter((r) => r.tinId === tinId) : [...rows]).slice(0, max);
}

/**
 * The list and the rows held back. While the cards are paused the list does not move either (rows that slide in
 * above whatever a person is reading shift it away from them, on a phone especially): new rows wait, and the
 * page says how many, until the person resumes.
 */
export interface ListState {
  rows: FeedRow[];
  held: FeedRow[];
}
export const emptyList: ListState = { rows: [], held: [] };

/** Rows that have arrived: into the list, or held while paused. */
export function addRows(state: ListState, incoming: readonly FeedRow[], paused: boolean): ListState {
  if (!incoming.length) return state;
  if (paused) {
    // A row the list already shows is not held again.
    const shown = new Set(state.rows.map((r) => r.id));
    const held = mergeRows(state.held, incoming.filter((r) => !shown.has(r.id)));
    return held === state.held ? state : { ...state, held };
  }
  const rows = mergeRows(state.rows, incoming);
  return rows === state.rows ? state : { ...state, rows };
}

/** The person resumed: what was held joins the list. */
export function releaseRows(state: ListState): ListState {
  if (!state.held.length) return state;
  return { rows: mergeRows(state.rows, state.held), held: [] };
}

/** The moment a row was recorded, as an ISO-8601 time, from "YYYY-MM-DD HH:MM:SS" (what a page shows is its clock, in UTC). */
export function writtenIso(writtenAt: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(writtenAt) ? `${writtenAt.replace(' ', 'T')}.000Z` : writtenAt;
}

/**
 * A time as a clock (`HH:MM:SS`) when it falls on the same UTC day as `ref`, and with its date (`YYYY-MM-DD HH:MM:SS`) when it does
 * not, so two times a day apart (a transfer the daily job recorded the morning after its block) are never read as one day.
 * Both are ISO-8601 UTC times; anything else is shown as it is.
 */
export function clockOrDate(iso: string, ref: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/;
  const clock = formatClock(iso);
  return day.test(iso) && day.test(ref) && iso.slice(0, 10) !== ref.slice(0, 10) ? `${iso.slice(0, 10)} ${clock}` : clock;
}

