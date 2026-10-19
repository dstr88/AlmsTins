/**
 * What the live feed shows, as a page reads it from the feed's answer (src/lib/agentVault/feed.ts). A row
 * is the ledger's own row (src/lib/agentVault/ledgerView.ts, which keeps only values it recognizes) plus
 * the moment the Vault wrote it, the agent's name, the owner's label for the address and the agent's id.
 *
 * The two texts the owner wrote (the agent's name and the label) are cut to a length a card can hold and
 * are rendered as text by React, which escapes them. Pure, so every branch is a unit test.
 */
import { toLedgerRow, type LedgerRow } from '@/lib/agentVault/ledgerView';
import type { EventView } from '@/lib/agentVault/vault';

export interface FeedRow extends LedgerRow {
  /** When the Vault wrote it ("YYYY-MM-DD HH:MM:SS", UTC). `at` is when it happened. */
  writtenAt: string;
  tinId: string;
  agent: string;
  label: string | null;
}

/** The rows a page keeps in its list, newest first. Older ones are on the agent's own page. */
export const FEED_LIST_MAX = 100;
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

/** The list with `incoming` added: each id once, newest first, at most `max` rows. Returns the same array when nothing was new. */
export function mergeRows(list: readonly FeedRow[], incoming: readonly FeedRow[], max: number = FEED_LIST_MAX): FeedRow[] {
  const have = new Set(list.map((r) => r.id));
  const fresh = incoming.filter((r) => !have.has(r.id));
  if (!fresh.length) return list as FeedRow[];
  return [...list, ...fresh].sort(newestFirst).slice(0, max);
}

/** An address a card can hold: `0x1234abcd…89abcd`. A short one is shown whole. */
export function shortAddress(address: string): string {
  return address.length > 18 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}
